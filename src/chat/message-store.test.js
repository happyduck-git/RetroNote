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

describe("message-store 떠난 멤버 단일 이름 폴백", () => {
  test("nicknameMap 누락 시: 같은 sender 의 모든 과거 메시지가 가장 최근 박제값으로 통일 (변경 히스토리 노출 X)", () => {
    const store = createMessageStore("me");
    // B 가 닉네임을 hs2 → hs3 → hs7 로 바꾸며 보낸 메시지 히스토리. B 는 이미 방을 떠나 nicknameMap 에 없다.
    store.setNicknameMap(new Map());
    store.seed([
      { id: "1", ts: 100, senderUid: "B", nickname: "hs2", text: "a" },
      { id: "2", ts: 200, senderUid: "B", nickname: "hs3", text: "b" },
      { id: "3", ts: 300, senderUid: "B", nickname: "hs7", text: "c" },
    ]);
    const names = store.get().map((m) => m.displayName);
    assert.deepEqual(names, ["hs7", "hs7", "hs7"]);
  });

  test("seed 가 ts 역순으로 들어와도 가장 ts 가 큰 박제값이 채택", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map());
    store.seed([
      { id: "3", ts: 300, senderUid: "B", nickname: "hs7", text: "c" },
      { id: "1", ts: 100, senderUid: "B", nickname: "hs2", text: "a" },
      { id: "2", ts: 200, senderUid: "B", nickname: "hs3", text: "b" },
    ]);
    const names = store.get().map((m) => m.displayName);
    assert.deepEqual(names, ["hs7", "hs7", "hs7"]);
  });

  test("라이브 멤버는 영향 없음 — nicknameMap 우선", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map([["B", "live-name"]]));
    store.seed([
      { id: "1", ts: 100, senderUid: "B", nickname: "hs2", text: "a" },
      { id: "2", ts: 200, senderUid: "B", nickname: "hs7", text: "b" },
    ]);
    const names = store.get().map((m) => m.displayName);
    assert.deepEqual(names, ["live-name", "live-name"]);
  });

  test("add: 더 최신 박제값이 들어오면 같은 sender 의 기존 메시지도 새 값으로 통일", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map());
    store.seed([
      { id: "1", ts: 100, senderUid: "B", nickname: "hs2", text: "a" },
      { id: "2", ts: 200, senderUid: "B", nickname: "hs3", text: "b" },
    ]);
    assert.deepEqual(store.get().map((m) => m.displayName), ["hs3", "hs3"]);

    // B 가 닉네임 바꾸고 새 메시지 → 같은 sender 의 기존 메시지도 새 박제값으로.
    store.add({ id: "3", ts: 300, senderUid: "B", nickname: "hs7", text: "c" });
    assert.deepEqual(store.get().map((m) => m.displayName), ["hs7", "hs7", "hs7"]);
  });

  test("add: 과거 ts 메시지는 latest 를 바꾸지 않음 — 기존 displayName 유지", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map());
    store.seed([
      { id: "2", ts: 200, senderUid: "B", nickname: "hs3", text: "b" },
    ]);
    assert.equal(store.get()[0].displayName, "hs3");
    // backfill 로 ts 작은 메시지가 늦게 도착 — latest 갱신 X.
    store.add({ id: "1", ts: 100, senderUid: "B", nickname: "hs2", text: "a" });
    const names = store.get().map((m) => m.displayName);
    // 두 메시지 모두 latest(hs3) 로 통일.
    assert.deepEqual(names, ["hs3", "hs3"]);
  });

  test("서로 다른 sender 는 독립적으로 추적", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map());
    store.seed([
      { id: "1", ts: 100, senderUid: "A", nickname: "alice", text: "x" },
      { id: "2", ts: 200, senderUid: "B", nickname: "bob-old", text: "y" },
      { id: "3", ts: 300, senderUid: "B", nickname: "bob-new", text: "z" },
    ]);
    const names = store.get().map((m) => m.displayName);
    assert.deepEqual(names, ["alice", "bob-new", "bob-new"]);
  });
});
