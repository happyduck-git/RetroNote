import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createMessageStore } from "./message-store.js";

// 도우미: 마지막 emit 의 messages 를 snapshot 으로 가져온다.
function lastEmit(store) {
  let snap = [];
  const unsub = store.subscribe((msgs) => {
    snap = msgs.map((m) => ({ id: m.id, senderUid: m.senderUid, displayName: m.displayName, mine: m.mine }));
  });
  unsub();
  return snap;
}

describe("message-store nicknameMap", () => {
  test("nicknameMap 우선: 라이브 lookup 이 snapshot 보다 우선", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map([["alice-uid", "alice-new"]]));
    store.seed([
      { id: "1", ts: 100, senderUid: "alice-uid", nickname: "alice-old", text: "hi" },
    ]);
    const snap = lastEmit(store);
    assert.equal(snap[0].displayName, "alice-new");
  });

  test("nicknameMap 누락 시: snapshot(sender_nickname) 으로 폴백 — 떠난 멤버 케이스", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map()); // 떠난 멤버라 map 에 없음
    store.seed([
      { id: "1", ts: 100, senderUid: "ghost-uid", nickname: "ghost-snapshot", text: "bye" },
    ]);
    const snap = lastEmit(store);
    assert.equal(snap[0].displayName, "ghost-snapshot");
  });

  test("updateNickname: 같은 senderUid 의 모든 과거 메시지가 즉시 새 이름으로 재렌더", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map([["alice-uid", "alice"]]));
    store.seed([
      { id: "1", ts: 100, senderUid: "alice-uid", nickname: "alice", text: "a" },
      { id: "2", ts: 200, senderUid: "alice-uid", nickname: "alice", text: "b" },
      { id: "3", ts: 300, senderUid: "bob-uid", nickname: "bob", text: "c" },
    ]);

    const emits = [];
    const unsub = store.subscribe((msgs) => {
      emits.push(msgs.map((m) => m.displayName));
    });

    store.updateNickname("alice-uid", "alice-renamed");
    unsub();

    // 마지막 emit 은 updateNickname 의 emit 이어야 한다.
    const final = emits[emits.length - 1];
    assert.deepEqual(final, ["alice-renamed", "alice-renamed", "bob"]);
  });

  test("setNicknameMap: 호출 후 emit 으로 구독자 재호출", () => {
    const store = createMessageStore("me");
    store.seed([
      { id: "1", ts: 100, senderUid: "x", nickname: "snap", text: "hi" },
    ]);
    let calls = 0;
    const unsub = store.subscribe(() => {
      calls++;
    });
    const before = calls;
    store.setNicknameMap(new Map([["x", "live"]]));
    unsub();
    assert.ok(calls > before, "setNicknameMap 은 emit 을 호출해야 함");
    // 마지막 표시도 라이브로 갱신되어야 한다.
    assert.equal(store.get()[0].displayName, "live");
  });

  test("add: 새 메시지에도 nicknameMap 적용 — 라이브 우선", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map([["alice-uid", "alice-new"]]));
    store.add({ id: "1", ts: 100, senderUid: "alice-uid", nickname: "alice-old", text: "hi" });
    assert.equal(store.get()[0].displayName, "alice-new");
  });

  test("mine 판정은 변하지 않는다 — displayName 과 무관", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map([["me", "myself"]]));
    store.seed([
      { id: "1", ts: 100, senderUid: "me", nickname: "old", text: "hi" },
      { id: "2", ts: 200, senderUid: "other", nickname: "you", text: "yo" },
    ]);
    const snap = lastEmit(store);
    assert.equal(snap[0].mine, true);
    assert.equal(snap[1].mine, false);
    // 본인 displayName 도 라이브로 채워지지만 view 레이어가 "you" 로 덮어쓰는 것은 별개 책임.
    assert.equal(snap[0].displayName, "myself");
  });

  test("updateNickname(uid, null): map 에서 제거 → snapshot 폴백으로 회귀", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map([["alice-uid", "alice-live"]]));
    store.seed([
      { id: "1", ts: 100, senderUid: "alice-uid", nickname: "alice-snapshot", text: "hi" },
    ]);
    assert.equal(store.get()[0].displayName, "alice-live");
    store.updateNickname("alice-uid", null);
    assert.equal(store.get()[0].displayName, "alice-snapshot");
  });
});
