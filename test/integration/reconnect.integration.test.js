// 재연결 시나리오 — 실제 로컬 Supabase(Realtime/RLS)에 대고 검증한다.
//   1. transport.reconnect() 로 채널을 갈아 끼운 뒤에도 postgres_changes echo 가 다시 온다.
//   2. 실시간이 멈춘 동안 쌓인 메시지를 backfill 이 순서대로, 중복 없이 채운다.
//   3. 알림 채널을 재연결해도 안 읽음 카운터가 지워지지 않는다.
//
// "끊김" 은 supabase_realtime publication 에서 messages 를 잠시 빼서 만든다. DB 는 살아 있고
// 실시간만 멈춘 상태가 되는데, 재연결이 실제로 감당해야 하는 상황이 정확히 이것이다.
// (네트워크를 끊으면 DB 도 같이 끊겨 backfill 을 검증할 수 없다.)
//
// 타이밍 규칙(백오프 간격·벌점·워치독)은 시계를 주입하는 reconnect-controller.test.js 쪽이
// 훨씬 정밀하고 빠르다. 여기서는 "진짜 서버에 다시 붙는가" 만 본다.
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

import { signUp, signOut, getCurrentUserId, getClient, ensureFreshSession } from "../../src/auth/auth.js";
import { openRoom, closeRoom, setRoomNickname } from "../../src/chat/session.js";
import { makeMessageNotifier } from "../../src/chat/message-notifier.js";
import { normalize } from "../../src/chat/room-code.js";

const CODE = normalize("RCN234");
const NICK = "Alice";
let pool;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function freshUser() {
  const email = `${crypto.randomUUID()}@example.com`;
  await signUp(email, "password123"); // 이메일 확인 off → 즉시 세션
  return getCurrentUserId();
}

async function waitFor(fn, timeout = 15000, interval = 100) {
  const deadline = Date.now() + timeout;
  for (;;) {
    if (await fn()) return;
    if (Date.now() > deadline) throw new Error("waitFor: timeout");
    await sleep(interval);
  }
}

// 관리자 권한(RLS 우회)으로 메시지 row 를 직접 INSERT — Realtime WAL 이벤트를 만든다.
async function adminInsertMessage(code, { id, senderUid, text, ts }) {
  await pool.query(
    `insert into public.messages (id, room_code, sender_uid, sender_client_id, sender_nickname, text, ts)
     values ($1, $2, $3, $4, $5, $6, $7)`,
    [id, normalize(code), senderUid, "cid-test", "Bob", text, ts ?? Date.now()],
  );
}

// 실시간 전달만 멈춘다(DB 는 그대로). publication 에서 빠진 뒤 커밋된 INSERT 는 WAL 에 실리지 않는다.
async function stopRealtimeDelivery() {
  await pool.query("alter publication supabase_realtime drop table public.messages;");
}

// 되돌리기. finally 에서 부르므로 이미 들어 있어도 통과해야 한다(harness.resetSchema 와 같은 가드).
async function resumeRealtimeDelivery() {
  await pool.query(`
    do $$
    begin
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'messages'
      ) then
        alter publication supabase_realtime add table public.messages;
      end if;
    end $$;
  `);
}

function idsInStore(store, ids) {
  return store.get().filter((m) => ids.includes(m.id));
}

// 갓 기동한 로컬 realtime 컨테이너는 첫 구독의 echo 를 놓친다(cold-start). 왕복이 한 번
// 성공할 때까지 데운 뒤 실제 테스트를 돌린다. flow.integration.test.js 와 같은 이유·같은 처방.
async function warmUpRealtime() {
  const uid = await freshUser();
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    const entry = await openRoom("WARMUP");
    try {
      await entry.transport.connect("WARMUP", { nickname: "warm", clientId: entry.clientId });
      const id = crypto.randomUUID();
      await adminInsertMessage("WARMUP", { id, senderUid: uid, text: "warmup" });
      await waitFor(() => idsInStore(entry.store, [id]).length === 1, 2500, 100);
      closeRoom("WARMUP");
      return;
    } catch {
      /* 컨테이너가 아직 안 뜸 → 잠시 후 재시도 */
    }
    closeRoom("WARMUP");
    await sleep(1000);
  }
  console.error("[warmup] realtime 준비 확인 실패 — 실제 테스트에서 재검증됨");
}

before(async () => {
  const env = resolveEnv();
  installBrowserGlobals();
  await configureApp(env);
  pool = adminPool(env.dbUrl);
  await resetSchema(pool);
  await warmUpRealtime();
});

after(async () => {
  // 테스트가 중간에 죽어 publication 이 빠진 채 남으면 다음 실행 전체가 조용히 깨진다.
  await resumeRealtimeDelivery().catch((e) => console.error("publication 복구 실패:", e));
  await pool?.end();
});

beforeEach(async () => {
  try { await signOut(); } catch { /* 잔여 세션 정리 */ }
  await cleanupData(pool);
  resetDevice();
});

// ---------------------------------------------------------------------------
describe("방 채널 재연결", () => {
  test("reconnect 뒤에도 postgres_changes echo 가 다시 도착한다", { timeout: 40000 }, async () => {
    const uid = await freshUser();
    setRoomNickname(CODE, NICK);
    const entry = await openRoom(CODE);
    try {
      await entry.transport.connect(CODE, { nickname: NICK, clientId: entry.clientId });

      // 기준선: 재연결 전에 한 번 왕복한다(채널이 살아 있음을 확인).
      const before = crypto.randomUUID();
      await entry.transport.send({
        id: before, clientId: entry.clientId, senderUid: uid, nickname: NICK, text: "before-reconnect", ts: Date.now(),
      });
      await waitFor(() => idsInStore(entry.store, [before]).length === 1);

      // 옛 채널을 버리고 새 채널로 다시 붙는다(감독자가 복구할 때 부르는 바로 그 경로).
      await entry.transport.reconnect();
      await waitFor(() => entry.transport.isHealthy(), 10000);

      const after = crypto.randomUUID();
      await entry.transport.send({
        id: after, clientId: entry.clientId, senderUid: uid, nickname: NICK, text: "after-reconnect", ts: Date.now(),
      });
      await waitFor(() => idsInStore(entry.store, [after]).length === 1);
    } finally {
      closeRoom(CODE);
    }
  });
});

describe("끊긴 동안 놓친 메시지 보충 (backfill)", () => {
  test("실시간이 멈춘 동안 쌓인 메시지를 순서대로, 중복 없이 채운다", { timeout: 40000 }, async () => {
    const uid = await freshUser();
    setRoomNickname(CODE, NICK);
    const entry = await openRoom(CODE);
    try {
      await entry.transport.connect(CODE, { nickname: NICK, clientId: entry.clientId });

      // 기준선: 붙어 있는 동안에는 실시간으로 들어온다.
      const liveId = crypto.randomUUID();
      await adminInsertMessage(CODE, { id: liveId, senderUid: uid, text: "live" });
      await waitFor(() => idsInStore(entry.store, [liveId]).length === 1);

      await stopRealtimeDelivery();
      await sleep(500); // DDL 반영 여유

      const gapIds = [crypto.randomUUID(), crypto.randomUUID(), crypto.randomUUID()];
      const base = Date.now();
      for (let i = 0; i < gapIds.length; i++) {
        await adminInsertMessage(CODE, { id: gapIds[i], senderUid: uid, text: `gap-${i}`, ts: base + i });
      }

      // 실시간이 멈춘 동안에는 화면에 안 들어와야 한다(= 갭이 실제로 생겼다는 증거).
      await sleep(2000);
      assert.equal(idsInStore(entry.store, gapIds).length, 0, "실시간이 멈춘 동안에는 도착하면 안 된다");

      await resumeRealtimeDelivery();
      assert.equal(await entry.backfill(), true, "backfill 은 성공을 알려야 한다");

      const got = idsInStore(entry.store, gapIds);
      assert.deepEqual(
        got.map((m) => m.text),
        ["gap-0", "gap-1", "gap-2"],
        "놓친 메시지가 보낸 순서대로 채워져야 한다",
      );

      // 두 번 채워도 늘어나지 않는다(backfill 은 마지막 ts 부터 다시 훑으므로 겹치는 구간이 있다).
      const total = entry.store.get().length;
      assert.equal(await entry.backfill(), true);
      assert.equal(entry.store.get().length, total, "다시 채워도 중복이 생기면 안 된다");
    } finally {
      await resumeRealtimeDelivery();
      closeRoom(CODE);
    }
  });
});

describe("알림 채널 재연결", () => {
  test("재연결해도 안 읽음 카운터가 지워지지 않는다", { timeout: 40000 }, async () => {
    // 메시지 작성자로 쓸 uid 를 먼저 만든다(sender_uid 는 auth.users FK). 멤버일 필요는 없다.
    const senderUid = await freshUser();
    await signOut();
    resetDevice();

    const myUid = await freshUser();
    // 알림 채널은 RLS 로 걸러진다 — 내가 멤버인 방의 메시지만 애초에 도착한다.
    const entry = await openRoom(CODE);
    closeRoom(CODE);
    const joinedAt = entry.firstJoinedAt;

    const notifier = makeMessageNotifier({
      getClient,
      isAppFocused: () => false, // 앱이 비활성일 때만 배지를 올린다 → 그 경로를 열어 둔다
      setUnread: () => {},       // Tauri 배지 API 는 Node 에 없다
      ensureFreshSession,        // 재연결 직전의 토큰 확인 경로도 실제로 태운다
    });
    try {
      await notifier.start(myUid);

      const first = [crypto.randomUUID(), crypto.randomUUID()];
      for (let i = 0; i < first.length; i++) {
        await adminInsertMessage(CODE, { id: first[i], senderUid, text: `m-${i}`, ts: joinedAt + 1 + i });
      }
      await waitFor(() => notifier.getUnreadByRoom().get(CODE) === 2);

      await notifier.reconnect();

      assert.equal(
        notifier.getUnreadByRoom().get(CODE),
        2,
        "재연결이 안 읽음 카운터를 지우면 안 된다(채널 정리와 카운터 정리는 분리돼 있다)",
      );

      // 갈아 낀 채널이 실제로 살아 있는지 — 재연결 뒤 새 메시지도 세어야 한다.
      await adminInsertMessage(CODE, {
        id: crypto.randomUUID(), senderUid, text: "after-reconnect", ts: joinedAt + 10,
      });
      await waitFor(() => notifier.getUnreadByRoom().get(CODE) === 3);
    } finally {
      await notifier.stop();
    }
  });
});
