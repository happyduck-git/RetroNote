// #56 회귀 가드: 방에 메시지가 PostgREST max_rows(로컬 1000) 를 넘으면, 재입장 시 최신이 잘려
// 사라지던 버그. fetchMessages 가 limit 으로 "최신 페이지"를 받고, loadOlder 로 firstJoinedAt
// 바닥까지 keyset 페이징하는지 실제 DB 에 대고 검증한다.
//
// 단위 테스트(fake)로는 못 잡는 계층: max_rows 잘림, RLS SELECT(first_joined_at<=ts),
// keyset 의 같은-ts 경계 처리.
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

import { signUp, signOut, getCurrentUserId } from "../../src/auth/auth.js";
import { openRoom, closeRoom, HISTORY_PAGE_SIZE } from "../../src/chat/session.js";
import { normalize } from "../../src/chat/room-code.js";

const CODE = normalize("HST567");
const TOTAL = 1100; // max_rows(1000) 를 확실히 넘겨 구버그를 재현시키는 양.
let pool;

async function freshUser() {
  const email = `${crypto.randomUUID()}@example.com`;
  await signUp(email, "password123"); // 이메일 확인 off → 즉시 세션
  return getCurrentUserId();
}

// 멤버십을 openRoom 보다 먼저 심는다(first_joined_at <= 모든 메시지 ts). 안 그러면
// ensureMembership 이 first_joined_at=now() 로 만들어 RLS SELECT 가 1100건 전부를 가린다.
async function seedMembership(uid, firstJoinedAt) {
  await pool.query(
    `insert into public.room_memberships (room_code, user_id, first_joined_at) values ($1, $2, $3)`,
    [CODE, uid, firstJoinedAt],
  );
}

// 1100건을 admin(RLS 우회)으로 대량 삽입. ts 는 base+i 로 단조 증가시키되,
// 첫 페이지 경계(인덱스 1049/1050)에 같은 ts 두 건을 끼워 keyset 의 동률 경계를 강제한다.
// 구버그(.lt("ts")) 라면 이 경계에서 한 건이 누락된다.
async function seedMessages(uid, base) {
  const ids = [];
  const ts = [];
  for (let i = 0; i < TOTAL; i++) {
    ids.push(crypto.randomUUID());
    ts.push(base + i);
  }
  ts[1049] = ts[1050]; // 첫 페이지 경계(newest 50 의 컷)에 동일 ts 두 건.
  await pool.query(
    `insert into public.messages (id, room_code, sender_uid, sender_client_id, sender_nickname, text, ts)
     select * from unnest(
       $1::uuid[], $2::text[], $3::uuid[], $4::text[], $5::text[], $6::text[], $7::bigint[]
     )`,
    [
      ids,
      Array(TOTAL).fill(CODE),
      Array(TOTAL).fill(uid),
      Array(TOTAL).fill("cid"),
      Array(TOTAL).fill("tester"),
      ids.map((_, i) => `msg-${i}`),
      ts,
    ],
  );
  return { ids, ts };
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
  resetDevice();
});

describe("history pagination (#56)", () => {
  test("재입장은 최신 페이지를 시드한다 — 최신이 잘리지 않음", async () => {
    const base = 1_700_000_000_000;
    const uid = await freshUser();
    await seedMembership(uid, base - 1000);
    const { ids } = await seedMessages(uid, base);

    const entry = await openRoom(CODE);
    try {
      const loaded = entry.store.get();
      // 정확히 한 페이지(최신 50)만 시드.
      assert.equal(loaded.length, HISTORY_PAGE_SIZE);
      const loadedIds = new Set(loaded.map((m) => m.id));
      // 구버그라면 가장 오래된 1000건만 와서 최신이 없다 → 최신 id 존재가 핵심 단언.
      assert.ok(loadedIds.has(ids[TOTAL - 1]), "최신 메시지가 시드에 있어야 한다");
      assert.ok(!loadedIds.has(ids[0]), "가장 오래된 메시지는 아직 안 와야 한다");
    } finally {
      closeRoom(CODE);
    }
  });

  test("loadOlder 로 바닥까지 끊김 없이 페이징 — 같은-ts 경계 누락 없음", async () => {
    const base = 1_700_000_000_000;
    const uid = await freshUser();
    await seedMembership(uid, base - 1000);
    const { ids } = await seedMessages(uid, base);

    const entry = await openRoom(CODE);
    try {
      // 바닥(hasMore=false)까지 반복 로드. 안전 상한으로 무한루프 차단.
      let guard = 0;
      for (;;) {
        const { hasMore } = await entry.loadOlder();
        if (!hasMore) break;
        if (++guard > TOTAL) throw new Error("loadOlder 가 수렴하지 않음");
      }
      const got = new Set(entry.store.get().map((m) => m.id));
      // 1100건 전부 복원(누락 0). keyset 이 아니면 같은-ts 경계에서 빠진다.
      assert.equal(got.size, TOTAL);
      for (let i = 0; i < TOTAL; i++) {
        assert.ok(got.has(ids[i]), `메시지 ${i} 가 누락됨`);
      }
      // 같은 ts 를 공유한 경계 두 건이 모두 존재.
      assert.ok(got.has(ids[1049]) && got.has(ids[1050]), "같은-ts 경계 두 건 모두 있어야 한다");
    } finally {
      closeRoom(CODE);
    }
  });
});
