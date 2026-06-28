// 통합/시나리오 테스트 — 실제 로컬 Supabase(Postgres+Auth+PostgREST+Realtime)에 대고
// 앱 모듈을 그대로 구동해 전체 사용 flow 를 검증한다.
//
// 전제: 로컬 스택이 떠 있어야 한다 →  supabase start   (Docker 필요)
// 실행:  npm run test:integration
//
// 단위 테스트(fake 주입)로는 안 잡히는 계층을 노린다:
//   - RLS 정책 평가(지난번 42P17 무한 재귀 같은 DB 레벨 버그)
//   - Auth 세션/사용자 격리
//   - PostgREST/Realtime 왕복
//   - 기기 간 동기화(alias/nickname 보존) end-to-end
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

// 앱 모듈(테스트 대상). 설정/셰임은 before() 에서 준비되므로 호출 시점엔 준비 완료.
import { signUp, signOut, getCurrentUserId, getClient } from "../../src/auth/auth.js";
import {
  openRoom,
  closeRoom,
  saveRoom,
  getSavedRooms,
  setRoomAlias,
  setRoomNickname,
  getRoomNickname,
  syncRoomsFromServer,
  removeSavedRoom,
} from "../../src/chat/session.js";
import { fetchMemberships, updateMembershipAlias, fetchRoomMembers, insertMessage, ensureMembership } from "../../src/chat/message-history.js";
import { normalize } from "../../src/chat/room-code.js";

const CODE = "ABC234";
let pool;

// --- 유틸 -------------------------------------------------------------------
async function freshUser() {
  const email = `${crypto.randomUUID()}@example.com`;
  await signUp(email, "password123"); // 이메일 확인 off → 즉시 세션
  return getCurrentUserId();
}

async function serverMembership(code) {
  const list = await fetchMemberships();
  return list.find((m) => normalize(m.code) === normalize(code)) || null;
}

async function waitFor(predicate, { timeout = 8000, interval = 100 } = {}) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await predicate()) return;
    if (Date.now() > deadline) throw new Error("waitFor: timeout");
    await new Promise((r) => setTimeout(r, interval));
  }
}

// 방을 한 번 열어 멤버십(서버 row)을 만들고, 로비 저장목록에도 등록한 뒤 닫는다.
// alias 가 서버에 영속되려면 멤버십 row 가 있어야 하므로(실제 사용도 openRoom 후 rename) 공통 전제로 둔다.
async function joinAndSave(code) {
  await openRoom(code);
  saveRoom(code);
  closeRoom(code);
}

// 갓 기동한 로컬 realtime 컨테이너는 (a) 아직 websocket 을 못 받거나(connect 실패),
// (b) 떠 있어도 첫 구독의 postgres_changes echo 를 놓친다(cold-start). 둘 다 echo 왕복이
// 성공할 때까지 재시도해 컨테이너를 데운 뒤 실제 테스트를 돌린다. 운영과 무관한 로컬 한정
// 현상이라 테스트 계층에서만 흡수한다(db/CLAUDE.md "Realtime" 참고).
async function warmUpRealtime() {
  const uid = await freshUser();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const entry = await openRoom("WARMUP");
    try {
      await entry.transport.connect("WARMUP", { nickname: "warm", clientId: entry.clientId });
      const id = crypto.randomUUID();
      const got = new Promise((res) => {
        const unsub = entry.store.subscribe((m) => { if (m.some((x) => x.id === id)) { unsub(); res(true); } });
        setTimeout(() => { unsub(); res(false); }, 2500);
      });
      await entry.transport.send({ id, clientId: entry.clientId, senderUid: uid, nickname: "warm", text: "warmup", ts: Date.now() });
      if (await got) { closeRoom("WARMUP"); return; } // echo 도착 = 컨테이너 준비 완료
    } catch { /* 컨테이너가 아직 안 뜸(connect 실패) → 잠시 후 재시도 */ }
    closeRoom("WARMUP");
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.error("[warmup] realtime 준비 확인 실패 — 실제 테스트에서 재검증됨");
}

// 관리자 권한(RLS 우회)으로 메시지 row 를 직접 INSERT — Realtime postgres_changes 를 발생시킨다.
// 알림 구독의 RLS 격리만 검증하려는 목적이라, 작성자 RLS(0006)는 우회하고 WAL 이벤트만 만든다.
async function adminInsertMessage(code, { id, senderUid, text }) {
  await pool.query(
    `insert into public.messages (id, room_code, sender_uid, sender_client_id, sender_nickname, text, ts)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, normalize(code), senderUid, "cid-test", "Member", text, Date.now()],
  );
}

// messages 테이블 INSERT 를 필터 없이 구독한다(= message-notifier 의 앱 수준 채널과 동일 형태).
// RLS 가 구독자별로 평가되므로, 멤버만 자기 방 메시지를 받아야 한다.
//  - ready   : 구독 완료(SUBSCRIBED) 시 resolve
//  - hit     : predicate 를 만족하는 INSERT 도착 시 resolve(true)
//  - cleanup : 채널 제거
function subscribeMessagesUnfiltered(client, name, predicate) {
  let resolveHit, resolveReady;
  const hit = new Promise((res) => { resolveHit = res; });
  const ready = new Promise((res) => { resolveReady = res; });
  const channel = client
    .channel(name)
    .on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages" },
      (payload) => { if (predicate(payload.new)) resolveHit(true); },
    );
  channel.subscribe((status) => { if (status === "SUBSCRIBED") resolveReady(true); });
  return { ready, hit, cleanup: () => client.removeChannel(channel) };
}

// --- 수명주기 ---------------------------------------------------------------
before(async () => {
  const env = resolveEnv();
  installBrowserGlobals();
  await configureApp(env);
  pool = adminPool(env.dbUrl);
  await resetSchema(pool); // db/migrations 전체를 순서대로 적용(파일 자체 검증 포함)
  await warmUpRealtime(); // cold-start 흡수: 첫 실행도 realtime 왕복이 안정적으로 통과하도록 데운다
});

after(async () => {
  await pool?.end();
});

beforeEach(async () => {
  try { await signOut(); } catch { /* 직전 테스트의 잔여 세션 정리 */ }
  await cleanupData(pool);
  resetDevice();
});

// ---------------------------------------------------------------------------
describe("RLS / 방 입장 (지난번 42P17 재귀 회귀 가드)", () => {
  test("openRoom 은 RLS 무한재귀 없이 성공한다", async () => {
    await freshUser();
    // ensureMembership(SELECT) 를 실제 RLS 로 평가. 0003 이전의 잘못된 정책이면 42P17 로 throw.
    const entry = await openRoom(CODE);
    try {
      assert.equal(typeof entry.firstJoinedAt, "number");
      // 본인 멤버십 SELECT 경로(또 다른 RLS 분기)도 정상 동작해야 한다.
      const list = await fetchMemberships();
      assert.equal(list.length, 1);
      assert.equal(normalize(list[0].code), CODE);

      // co-member SELECT 정책(0003) 도 직접 평가 — 메시지 표시는 더 이상 이 경로를 쓰지 않지만,
      // 정책 자체가 42P17 무한재귀 없이 동작하는지를 회귀 가드로 계속 검증한다. 반환은 Map.
      const members = await fetchRoomMembers(CODE);
      assert.ok(members instanceof Map, "fetchRoomMembers 는 Map 을 반환해야 함");
    } finally {
      closeRoom(CODE);
    }
  });
});

describe("메시지 송수신 (Realtime 왕복)", () => {
  test("transport.send → postgres_changes echo 가 store 에 도착한다", { timeout: 25000 }, async () => {
    const uid = await freshUser();
    setRoomNickname(CODE, "Alice");
    const entry = await openRoom(CODE);
    try {
      const msg = {
        id: crypto.randomUUID(),
        clientId: entry.clientId,
        senderUid: uid,
        nickname: "Alice",
        text: "hello-realtime",
        ts: Date.now(),
      };
      // 낙관적 add 없이, 오직 realtime echo 로만 도착하는지 확인.
      const received = new Promise((resolve) => {
        const unsub = entry.store.subscribe((msgs) => {
          if (msgs.some((m) => m.id === msg.id)) { unsub(); resolve(true); }
        });
      });
      await entry.transport.connect(CODE, { nickname: "Alice", clientId: entry.clientId });
      await entry.transport.send(msg);
      await assert.doesNotReject(
        Promise.race([
          received,
          new Promise((_, rej) => setTimeout(() => rej(new Error("realtime echo timeout")), 20000)),
        ]),
      );
    } finally {
      closeRoom(CODE);
    }
  });
});

describe("메시지 INSERT 멤버십 정책 (0006)", () => {
  // 비멤버는 가입하지 않은 방에 메시지를 INSERT 할 수 없다(0006 정책).
  // insertMessage 는 RLS WITH CHECK 위반 시 supabase-js error 를 throw 한다.
  test("비멤버는 text 메시지를 INSERT 할 수 없다", async () => {
    const uid = await freshUser(); // 멤버십 없음 (openRoom/ensureMembership 호출 안 함)
    const msg = {
      id: crypto.randomUUID(),
      clientId: "cid-x",
      senderUid: uid,
      nickname: "Intruder",
      text: "uninvited",
      ts: Date.now(),
    };
    await assert.rejects(() => insertMessage(msg, CODE), "비멤버 INSERT 는 RLS 로 거부되어야 함");
  });

  test("비멤버는 attachment-only 메시지도 INSERT 할 수 없다", async () => {
    const uid = await freshUser();
    const msg = {
      id: crypto.randomUUID(),
      clientId: "cid-x",
      senderUid: uid,
      nickname: "Intruder",
      text: null,
      ts: Date.now(),
      // 0005 의 attachment_complete check 를 통과하는 최소 유효 값(bytes 는 NULL 허용).
      attachment: { url: "https://example.com/a.png", kind: "image", mime: "image/png", width: 200, height: 150, bytes: null },
    };
    await assert.rejects(() => insertMessage(msg, CODE), "비멤버 attachment INSERT 는 RLS 로 거부되어야 함");
  });

  test("멤버는 메시지를 INSERT 할 수 있다 (회귀)", async () => {
    const uid = await freshUser();
    await ensureMembership(CODE); // 멤버십 생성 → is_room_member(CODE) = true
    const msg = {
      id: crypto.randomUUID(),
      clientId: "cid-a",
      senderUid: uid,
      nickname: "Alice",
      text: "hello",
      ts: Date.now(),
    };
    await assert.doesNotReject(() => insertMessage(msg, CODE), "멤버 INSERT 는 성공해야 함");
  });
});

describe("기기 간 alias 보존 (이번 기능)", () => {
  test("다른 기기(같은 계정)에서 방 이름(alias)이 복원된다", async () => {
    await freshUser();
    await joinAndSave(CODE);
    setRoomAlias(CODE, "Team Sync"); // 로컬 + best-effort 서버 push
    await waitFor(async () => (await serverMembership(CODE))?.alias === "Team Sync");

    resetDevice(); // 같은 계정, 새 기기(앱 로컬 비어 있음)
    assert.equal(getSavedRooms().length, 0);

    const changed = await syncRoomsFromServer();
    assert.equal(changed, true);
    const restored = getSavedRooms().find((r) => r.code === CODE);
    assert.ok(restored, "방이 서버에서 복원되어야 함");
    assert.equal(restored.alias, "Team Sync");
  });

  test("alias reconcile: 다른 기기에서 바뀐 서버 값이 우선한다", async () => {
    await freshUser();
    await joinAndSave(CODE);
    setRoomAlias(CODE, "X");
    await waitFor(async () => (await serverMembership(CODE))?.alias === "X");

    // 다른 기기가 서버 alias 를 바꾼 상황을 모사(로컬은 여전히 "X").
    await updateMembershipAlias(CODE, "Y");
    assert.equal(getSavedRooms().find((r) => r.code === CODE)?.alias, "X");

    await syncRoomsFromServer();
    assert.equal(getSavedRooms().find((r) => r.code === CODE)?.alias, "Y");
  });
});

describe("기기 간 nickname 보존 (지난 기능 회귀 가드)", () => {
  test("다른 기기(같은 계정)에서 방 닉네임이 복원된다", async () => {
    await freshUser();
    setRoomNickname(CODE, "Alice"); // 로컬 닉네임
    await openRoom(CODE); // syncMembershipNickname: 로컬 O / 서버 NULL → 서버로 push
    saveRoom(CODE);
    closeRoom(CODE);
    await waitFor(async () => (await serverMembership(CODE))?.nickname === "Alice");

    resetDevice();
    assert.equal(getRoomNickname(CODE), null);

    await syncRoomsFromServer();
    assert.equal(getRoomNickname(CODE), "Alice");
  });
});

describe("사용자 격리", () => {
  test("다른 사용자는 내 방/alias 를 보지 못한다", async () => {
    await freshUser(); // 사용자 A
    await joinAndSave(CODE);
    setRoomAlias(CODE, "Secret");
    await waitFor(async () => (await serverMembership(CODE))?.alias === "Secret");

    await signOut();
    resetDevice();
    await freshUser(); // 사용자 B (다른 계정)

    const changed = await syncRoomsFromServer();
    assert.equal(changed, false);
    assert.equal(getSavedRooms().length, 0);
  });
});

describe("방 제거", () => {
  test("removeSavedRoom 후엔 sync 로 다시 살아나지 않는다", async () => {
    await freshUser();
    await joinAndSave(CODE);
    assert.equal(getSavedRooms().length, 1);

    await removeSavedRoom(CODE); // 로컬 제거 + 서버 멤버십 삭제
    assert.equal(getSavedRooms().length, 0);

    await syncRoomsFromServer();
    assert.equal(getSavedRooms().length, 0);
  });
});

// 앱 수준 알림 서비스(message-notifier)는 messages 를 "필터 없이" 한 채널로 구독하고,
// 내 방인지/내 메시지인지는 클라이언트측에서 거른다. 이 설계의 안전성은 "필터 없는 구독이
// 비멤버에게 남의 방 메시지를 wire 로 흘리지 않는다"(= Realtime 이 SELECT RLS 를 구독자별로 적용)에
// 달려 있다. 이 격리를 여기서 직접 증명한다. 실패하면 방별 room_code=eq 채널 폴백이 필요하다.
describe("앱 수준 알림 구독 RLS 격리 (issue #52)", () => {
  test("멤버는 필터 없는 구독으로 자기 방 메시지를 받는다", { timeout: 25000 }, async () => {
    const uid = await freshUser();
    await ensureMembership(CODE); // 멤버십 생성 → SELECT RLS 통과 대상
    const client = await getClient();
    const id = crypto.randomUUID();
    const sub = subscribeMessagesUnfiltered(client, "notify-member", (row) => row.id === id);
    try {
      await sub.ready;
      await adminInsertMessage(CODE, { id, senderUid: uid, text: "hello-member" });
      await assert.doesNotReject(
        Promise.race([
          sub.hit,
          new Promise((_, rej) => setTimeout(() => rej(new Error("realtime timeout")), 18000)),
        ]),
        "멤버는 자기 방 메시지를 수신해야 함",
      );
    } finally {
      await sub.cleanup();
    }
  });

  test("비멤버는 필터 없는 구독으로 남의 방 메시지를 받지 못한다", { timeout: 25000 }, async () => {
    const memberUid = await freshUser();
    await ensureMembership(CODE); // 메시지 작성자(멤버)
    await signOut();
    resetDevice();
    await freshUser(); // 사용자 C — CODE 비멤버
    const client = await getClient();
    const id = crypto.randomUUID();
    const sub = subscribeMessagesUnfiltered(client, "notify-nonmember", (row) => row.id === id);
    try {
      await sub.ready;
      await adminInsertMessage(CODE, { id, senderUid: memberUid, text: "secret" });
      // 일정 시간 내 도착하지 않아야(= 격리 성공) 통과. 도착하면 hit 가 먼저 resolve 되어 실패.
      const noDelivery = new Promise((resolve) => setTimeout(() => resolve("no-delivery"), 6000));
      const outcome = await Promise.race([sub.hit.then(() => "delivered"), noDelivery]);
      assert.equal(outcome, "no-delivery", "비멤버는 남의 방 메시지를 받으면 안 됨(RLS 격리)");
    } finally {
      await sub.cleanup();
    }
  });
});
