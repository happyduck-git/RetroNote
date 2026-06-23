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

describe("message-store displayName 은 메시지별 박제값", () => {
  test("seed: 각 메시지는 자기 nickname(sender_nickname) 그대로 표시", () => {
    const store = createMessageStore("me");
    store.seed([
      { id: "1", ts: 100, senderUid: "alice-uid", nickname: "alice", text: "hi" },
    ]);
    const snap = lastEmit(store);
    assert.equal(snap[0].displayName, "alice");
  });

  test("같은 sender 가 다른 닉네임으로 보낸 메시지는 각각 자기 이름 유지 (통일 X)", () => {
    const store = createMessageStore("me");
    // B 가 hs2 → hs3 → hs7 로 바꾸며 보낸 히스토리. 닉네임 변경 이력이 그대로 보여야 한다.
    store.seed([
      { id: "1", ts: 100, senderUid: "B", nickname: "hs2", text: "a" },
      { id: "2", ts: 200, senderUid: "B", nickname: "hs3", text: "b" },
      { id: "3", ts: 300, senderUid: "B", nickname: "hs7", text: "c" },
    ]);
    const names = store.get().map((m) => m.displayName);
    assert.deepEqual(names, ["hs2", "hs3", "hs7"]);
  });

  test("add: 새 메시지도 자기 nickname 으로 표시 — 기존 메시지는 불변", () => {
    const store = createMessageStore("me");
    store.seed([
      { id: "1", ts: 100, senderUid: "B", nickname: "hs2", text: "a" },
    ]);
    store.add({ id: "2", ts: 200, senderUid: "B", nickname: "hs7", text: "b" });
    const names = store.get().map((m) => m.displayName);
    assert.deepEqual(names, ["hs2", "hs7"]);
  });

  test("서로 다른 sender 는 독립적으로 자기 이름 유지", () => {
    const store = createMessageStore("me");
    store.seed([
      { id: "1", ts: 100, senderUid: "A", nickname: "alice", text: "x" },
      { id: "2", ts: 200, senderUid: "B", nickname: "bob-old", text: "y" },
      { id: "3", ts: 300, senderUid: "B", nickname: "bob-new", text: "z" },
    ]);
    const names = store.get().map((m) => m.displayName);
    assert.deepEqual(names, ["alice", "bob-old", "bob-new"]);
  });
});

describe("message-store dedup / mine 판정", () => {
  test("dedup: 같은 id 는 add 로 중복 추가되지 않음 (postgres_changes echo)", () => {
    const store = createMessageStore("me");
    store.add({ id: "1", ts: 100, senderUid: "x", nickname: "a", text: "hi" });
    store.add({ id: "1", ts: 100, senderUid: "x", nickname: "a", text: "hi" });
    assert.equal(store.get().length, 1);
  });

  test("seed 안에서도 같은 id 는 한 번만", () => {
    const store = createMessageStore("me");
    store.seed([
      { id: "1", ts: 100, senderUid: "x", nickname: "a", text: "hi" },
      { id: "1", ts: 200, senderUid: "x", nickname: "a", text: "dup" },
    ]);
    assert.equal(store.get().length, 1);
  });

  test("mine 은 senderUid 로 판정 — displayName 과 무관", () => {
    const store = createMessageStore("me");
    store.seed([
      { id: "1", ts: 100, senderUid: "me", nickname: "myself", text: "hi" },
      { id: "2", ts: 200, senderUid: "other", nickname: "you", text: "yo" },
    ]);
    const snap = lastEmit(store);
    assert.equal(snap[0].mine, true);
    assert.equal(snap[1].mine, false);
    // store 는 displayName 에 박제값을 채우고, "you" 로 덮어쓰는 것은 view 레이어 책임.
    assert.equal(snap[0].displayName, "myself");
  });
});
