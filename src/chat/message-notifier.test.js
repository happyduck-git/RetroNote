import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeMessageNotifier } from "./message-notifier.js";

// 호출을 기록하는 fake.
function spy(impl) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.calls = calls;
  return fn;
}

// Supabase client 모사: channel().on(...).subscribe() 흐름에서 postgres_changes 핸들러를 붙잡아
// 테스트가 직접 INSERT 이벤트를 흘려보낼 수 있게 한다.
function makeFakeClient() {
  const state = { handler: null, removed: 0 };
  const channel = {
    on(_event, _opts, cb) {
      state.handler = cb;
      return channel;
    },
    async subscribe() {
      return "SUBSCRIBED";
    },
  };
  return {
    state,
    channel: () => channel,
    async removeChannel() {
      state.removed++;
    },
  };
}

const A = "ABC234";
const B = "DEF456";

function buildNotifier(overrides = {}) {
  const fc = makeFakeClient();
  const setUnreadSpy = spy();
  const deps = {
    getClient: async () => fc,
    isAppFocused: () => false,
    setUnread: setUnreadSpy,
    ...overrides,
  };
  const notifier = makeMessageNotifier(deps);
  // setUnread 의 마지막 인자(= 현재 도크 배지 합계).
  const lastBadge = () => {
    const calls = setUnreadSpy.calls;
    return calls.length ? calls[calls.length - 1][0] : undefined;
  };
  return { notifier, fc, setUnreadSpy, lastBadge };
}

// 게이트 통과용 기본 row(남이 보낸 + 내 방 A).
function incomingRow(over = {}) {
  return { sender_uid: "other-uid", room_code: A, sender_nickname: "Bob", text: "hi", ...over };
}

describe("message-notifier 배지 게이팅", () => {
  test("남이 보낸 + 앱 비활성 + 내 방 → 그 방 카운트 증가, 배지=합계", async () => {
    const { notifier, fc, lastBadge } = buildNotifier();
    await notifier.start("me-uid");
    fc.state.handler({ new: incomingRow() });
    assert.equal(lastBadge(), 1);
    fc.state.handler({ new: incomingRow() });
    assert.equal(lastBadge(), 2);
    assert.equal(notifier.getUnreadByRoom().get(A), 2);
  });

  test("내가 보낸 메시지는 카운트 안 변함", async () => {
    const { notifier, fc } = buildNotifier();
    await notifier.start("me-uid");
    fc.state.handler({ new: incomingRow({ sender_uid: "me-uid" }) });
    assert.equal(notifier.getUnreadByRoom().size, 0);
  });

  test("앱이 포커스 상태면 카운트 안 변함", async () => {
    const { notifier, fc } = buildNotifier({ isAppFocused: () => true });
    await notifier.start("me-uid");
    fc.state.handler({ new: incomingRow() });
    assert.equal(notifier.getUnreadByRoom().size, 0);
  });

  // "내 방인지"는 클라이언트에서 거르지 않는다(RLS 가 채널 단에서 보장) — 도착한 메시지는 방과 무관하게 센다.
});

describe("message-notifier 방별 카운트 / 배지 합계", () => {
  test("방마다 따로 세고 배지는 전체 합계", async () => {
    const { notifier, fc, lastBadge } = buildNotifier();
    await notifier.start("me-uid");
    fc.state.handler({ new: incomingRow({ room_code: A }) });
    fc.state.handler({ new: incomingRow({ room_code: A }) });
    fc.state.handler({ new: incomingRow({ room_code: B }) });
    const map = notifier.getUnreadByRoom();
    assert.equal(map.get(A), 2);
    assert.equal(map.get(B), 1);
    assert.equal(lastBadge(), 3);
  });

  test("clearRoom 은 그 방만 지우고 배지 합계를 갱신한다", async () => {
    const { notifier, fc, lastBadge } = buildNotifier();
    await notifier.start("me-uid");
    fc.state.handler({ new: incomingRow({ room_code: A }) });
    fc.state.handler({ new: incomingRow({ room_code: A }) });
    fc.state.handler({ new: incomingRow({ room_code: B }) });
    notifier.clearRoom(A);
    const map = notifier.getUnreadByRoom();
    assert.equal(map.has(A), false);
    assert.equal(map.get(B), 1);
    assert.equal(lastBadge(), 1);
  });

  test("subscribe 구독자는 카운트 변경 시 호출된다", async () => {
    const { notifier, fc } = buildNotifier();
    await notifier.start("me-uid");
    const cb = spy();
    const unsub = notifier.subscribe(cb);
    fc.state.handler({ new: incomingRow() });
    assert.equal(cb.calls.length, 1);
    notifier.clearRoom(A);
    assert.equal(cb.calls.length, 2);
    unsub();
    fc.state.handler({ new: incomingRow() });
    assert.equal(cb.calls.length, 2); // 해지 후엔 호출 안 됨
  });

  test("stop 시 채널 정리 + 카운트/배지 0", async () => {
    const { notifier, fc, lastBadge } = buildNotifier();
    await notifier.start("me-uid");
    fc.state.handler({ new: incomingRow() });
    await notifier.stop();
    assert.equal(fc.state.removed, 1);
    assert.equal(notifier.getUnreadByRoom().size, 0);
    assert.equal(lastBadge(), 0);
  });
});

describe("message-notifier 펫 전용 신호(focus 무관)", () => {
  test("focus=true 에서도 onMessageArrived 발화 + petUnread 증가(배지는 focus 게이트라 불변)", async () => {
    const { notifier, fc } = buildNotifier({ isAppFocused: () => true });
    await notifier.start("me-uid");
    const arrived = spy();
    notifier.onMessageArrived(arrived);
    fc.state.handler({ new: incomingRow({ room_code: A }) });
    assert.equal(arrived.calls.length, 1);
    assert.deepEqual(arrived.calls[0], [A]); // 방 코드 전달
    assert.equal(notifier.getPetUnreadTotal(), 1); // 펫 점: focus 무관 증가
    assert.equal(notifier.getUnreadByRoom().size, 0); // 배지는 focus 라 불변
  });

  test("지금 보는 방(activeRoom)의 메시지는 펫 안읽음을 안 올린다(반응은 함), 다른 방은 올린다", async () => {
    const { notifier, fc } = buildNotifier({ isAppFocused: () => true });
    await notifier.start("me-uid");
    const arrived = spy();
    notifier.onMessageArrived(arrived);
    notifier.setActiveRoom(A);
    fc.state.handler({ new: incomingRow({ room_code: A }) });
    assert.equal(arrived.calls.length, 1); // 반응은 함
    assert.equal(notifier.getPetUnreadTotal(), 0); // 점은 안 오름(보고 있는 방)
    fc.state.handler({ new: incomingRow({ room_code: B }) });
    assert.equal(notifier.getPetUnreadTotal(), 1); // 다른 방은 오름
  });

  test("setActiveRoom(X) 는 그 방 펫 안읽음을 지우고 구독자에게 통지한다", async () => {
    const { notifier, fc } = buildNotifier({ isAppFocused: () => true });
    await notifier.start("me-uid");
    const petCb = spy();
    notifier.petSubscribe(petCb);
    fc.state.handler({ new: incomingRow({ room_code: A }) });
    assert.equal(notifier.getPetUnreadTotal(), 1);
    const before = petCb.calls.length;
    notifier.setActiveRoom(A);
    assert.equal(notifier.getPetUnreadTotal(), 0);
    assert.equal(petCb.calls.length, before + 1);
  });

  test("setActiveRoom 은 지울 게 없으면 통지하지 않는다", async () => {
    const { notifier } = buildNotifier();
    await notifier.start("me-uid");
    const petCb = spy();
    notifier.petSubscribe(petCb);
    notifier.setActiveRoom(A);
    assert.equal(petCb.calls.length, 0);
  });

  test("clearRoom 은 펫 안읽음을 건드리지 않는다(배지만 지움)", async () => {
    const { notifier, fc } = buildNotifier({ isAppFocused: () => false });
    await notifier.start("me-uid");
    fc.state.handler({ new: incomingRow({ room_code: A }) }); // 배지 + 펫 둘 다 +1
    assert.equal(notifier.getUnreadByRoom().get(A), 1);
    assert.equal(notifier.getPetUnreadTotal(), 1);
    notifier.clearRoom(A);
    assert.equal(notifier.getUnreadByRoom().has(A), false); // 배지 지워짐
    assert.equal(notifier.getPetUnreadTotal(), 1); // 펫 맵 불변
  });

  test("stop 시 펫 안읽음/activeRoom 도 정리된다", async () => {
    const { notifier, fc } = buildNotifier({ isAppFocused: () => true });
    await notifier.start("me-uid");
    fc.state.handler({ new: incomingRow({ room_code: A }) });
    assert.equal(notifier.getPetUnreadTotal(), 1);
    await notifier.stop();
    assert.equal(notifier.getPetUnreadTotal(), 0);
  });
});
