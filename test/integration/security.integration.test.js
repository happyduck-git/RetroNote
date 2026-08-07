// 보안 픽스 회귀 가드 — 실제 로컬 Supabase(RLS/트리거)에 대고 검증한다.
//   - H1(0008): chat-uploads 열거(list)는 방 멤버만. 비멤버/익명은 남의 방 업로드를 못 본다.
//   - M2(0009): first_joined_at 을 낮추거나(UPDATE) 삭제 후 낮은 값으로 재삽입해도 가입 전
//               히스토리가 노출되지 않는다.
//
// 전제: 로컬 스택 (supabase start). 실행: npm run test:integration
import { test, before, after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";

import { resolveEnv } from "./env.mjs";
import {
  installBrowserGlobals,
  resetDevice,
  configureApp,
  adminPool,
  resetSchema,
  cleanupData,
} from "./harness.mjs";

import { signUp, signOut, getCurrentUserId, getClient } from "../../src/auth/auth.js";
import { openRoom, closeRoom } from "../../src/chat/session.js";
import { ensureMembership, fetchMessages } from "../../src/chat/message-history.js";
import { normalize } from "../../src/chat/room-code.js";

const CODE = normalize("SEC234");
let pool;

async function freshUser() {
  const email = `${crypto.randomUUID()}@example.com`;
  await signUp(email, "password123"); // 이메일 확인 off → 즉시 세션
  return getCurrentUserId();
}

async function myFirstJoinedAt(client, code) {
  const { data, error } = await client
    .from("room_memberships")
    .select("first_joined_at")
    .eq("room_code", code)
    .maybeSingle();
  if (error) throw error;
  return data ? Number(data.first_joined_at) : null;
}

before(async () => {
  const env = resolveEnv();
  installBrowserGlobals();
  await configureApp(env);
  pool = adminPool(env.dbUrl);
  await resetSchema(pool);
});

after(async () => {
  await pool?.end();
});

beforeEach(async () => {
  try { await signOut(); } catch { /* 잔여 세션 정리 */ }
  await cleanupData(pool);
  // storage.objects 는 직접 DELETE 가 트리거로 금지돼 있어 정리하지 않는다.
  // H1 단언(멤버는 list 로 봄 / 비멤버는 0)은 이전 실행의 잔여 객체가 있어도 성립한다.
  resetDevice();
});

describe("H1: 첨부 스토리지 열거는 멤버만 (0008)", () => {
  test("멤버는 자기 방 업로드를 list 로 보고, 비멤버는 못 본다", async () => {
    // 멤버 A 가 업로드
    await freshUser();
    await ensureMembership(CODE);
    const a = await getClient();
    const path = `${CODE}/${crypto.randomUUID()}.png`;
    const bytes = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]); // PNG 시그니처
    const up = await a.storage
      .from("chat-uploads")
      .upload(path, new Blob([bytes], { type: "image/png" }), { contentType: "image/png" });
    assert.equal(up.error, null, `업로드 실패: ${up.error?.message}`);

    const listA = await a.storage.from("chat-uploads").list(CODE);
    assert.equal(listA.error, null);
    assert.ok(listA.data.length >= 1, "멤버는 자기 방 업로드를 list 로 봐야 한다");

    // 비멤버 B 로 전환
    await signOut();
    resetDevice();
    await freshUser();
    const b = await getClient();
    const listB = await b.storage.from("chat-uploads").list(CODE);
    assert.equal(listB.error, null); // RLS 는 에러가 아니라 빈 결과로 나타난다
    assert.equal(listB.data.length, 0, "비멤버는 남의 방 업로드를 열거할 수 없어야 한다");
  });
});

describe("M2: first_joined_at 낮추기/백데이트 차단 (0009)", () => {
  test("UPDATE 로 낮추려 해도 값이 유지된다", async () => {
    await freshUser();
    await openRoom(CODE);
    try {
      const client = await getClient();
      const tJoin = await myFirstJoinedAt(client, CODE);
      assert.ok(tJoin > 0);

      const upd = await client.from("room_memberships").update({ first_joined_at: 0 }).eq("room_code", CODE);
      assert.equal(upd.error, null); // 에러가 아니라 트리거가 값만 되돌린다
      assert.equal(await myFirstJoinedAt(client, CODE), tJoin, "first_joined_at 이 낮춰지면 안 된다");
    } finally {
      closeRoom(CODE);
    }
  });

  test("삭제 후 낮은 값으로 재삽입해도 서버 시각으로 고정된다", async () => {
    await freshUser();
    await openRoom(CODE);
    try {
      const client = await getClient();
      const tJoin = await myFirstJoinedAt(client, CODE);

      await client.from("room_memberships").delete().eq("room_code", CODE);
      const ins = await client.from("room_memberships").insert({ room_code: CODE, first_joined_at: 0 });
      assert.equal(ins.error, null);

      const after = await myFirstJoinedAt(client, CODE);
      assert.notEqual(after, 0, "백데이트한 0 이 그대로 저장되면 안 된다");
      assert.ok(after >= tJoin - 1000, "서버 시각(가입 시각 근방)으로 고정되어야 한다");
    } finally {
      closeRoom(CODE);
    }
  });

  test("가입 전 메시지는 우회 시도 후에도 여전히 안 보인다", async () => {
    const uid = await freshUser();
    await openRoom(CODE);
    try {
      const client = await getClient();
      const tJoin = await myFirstJoinedAt(client, CODE);

      // 가입 전(오래된) 메시지를 admin(RLS 우회)으로 심는다.
      const oldId = crypto.randomUUID();
      await pool.query(
        `insert into public.messages (id, room_code, sender_uid, sender_client_id, sender_nickname, text, ts)
         values ($1,$2,$3,$4,$5,$6,$7)`,
        [oldId, CODE, uid, "cid", "old", "before-join", tJoin - 100000],
      );

      // 우회 시도(UPDATE 낮추기) — 트리거가 무력화한다.
      await client.from("room_memberships").update({ first_joined_at: 0 }).eq("room_code", CODE);

      // 앱 조회 경로: RLS 게이트가 여전히 가입 전 메시지를 가려야 한다.
      const msgs = await fetchMessages(CODE, { sinceTs: 0 });
      assert.ok(!msgs.some((m) => m.id === oldId), "가입 전 메시지가 우회로 노출되면 안 된다");
    } finally {
      closeRoom(CODE);
    }
  });
});
