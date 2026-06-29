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

describe("message-store prepend (무한 스크롤)", () => {
  test("prepend: 과거 묶음을 앞에 붙이고 오름차순 유지, 신규 건수 반환", () => {
    const store = createMessageStore("me");
    store.seed([
      { id: "10", ts: 1000, senderUid: "A", nickname: "a", text: "j" },
      { id: "11", ts: 1100, senderUid: "A", nickname: "a", text: "k" },
    ]);
    const n = store.prepend([
      { id: "8", ts: 800, senderUid: "A", nickname: "a", text: "h" },
      { id: "9", ts: 900, senderUid: "A", nickname: "a", text: "i" },
    ]);
    assert.equal(n, 2);
    assert.deepEqual(store.get().map((m) => m.id), ["8", "9", "10", "11"]);
  });

  test("prepend: 이미 있는 id 는 dedup(경계 over-fetch/순서 어긋난 라이브 대비)", () => {
    const store = createMessageStore("me");
    store.seed([{ id: "10", ts: 1000, senderUid: "A", nickname: "a", text: "j" }]);
    const n = store.prepend([
      { id: "9", ts: 900, senderUid: "A", nickname: "a", text: "i" },
      { id: "10", ts: 1000, senderUid: "A", nickname: "a", text: "dup" }, // 이미 있음
    ]);
    assert.equal(n, 1);
    assert.deepEqual(store.get().map((m) => m.id), ["9", "10"]);
  });

  test("prepend: 각 메시지는 자기 박제 nickname 유지, mine 판정 적용", () => {
    const store = createMessageStore("me");
    // 박제 설계: 더 오래된 prepend 분이 기존 메시지의 표시 이름을 바꾸지 않는다.
    store.seed([{ id: "10", ts: 1000, senderUid: "me", nickname: "new", text: "j" }]);
    store.prepend([{ id: "9", ts: 900, senderUid: "me", nickname: "old", text: "i" }]);
    assert.deepEqual(store.get().map((m) => m.displayName), ["old", "new"]);
    assert.deepEqual(store.get().map((m) => m.mine), [true, true]);
  });

  test("prepend: 빈 배열/전부 중복이면 0 반환", () => {
    const store = createMessageStore("me");
    store.seed([{ id: "1", ts: 100, senderUid: "A", nickname: "a", text: "x" }]);
    assert.equal(store.prepend([]), 0);
    assert.equal(store.prepend([{ id: "1", ts: 100, senderUid: "A", nickname: "a", text: "x" }]), 0);
  });

  test("prepend 후에는 트림 유예 — 라이브 add 가 MAX 초과해도 과거를 안 버린다", () => {
    const store = createMessageStore("me");
    // MAX_MESSAGES=500. 500건 시드 후 prepend 1건 → 501.
    store.seed(Array.from({ length: 500 }, (_, i) => ({
      id: `s${i}`, ts: 1000 + i, senderUid: "A", nickname: "a", text: "x",
    })));
    store.prepend([{ id: "old", ts: 500, senderUid: "A", nickname: "a", text: "o" }]);
    assert.equal(store.get().length, 501);
    // 라이브 메시지 유입 — 유예 중이라 트림 안 함.
    store.add({ id: "live", ts: 2000, senderUid: "A", nickname: "a", text: "n" });
    assert.equal(store.get().length, 502);
    assert.equal(store.get()[0].id, "old"); // 가장 오래된 prepend 분이 남아 있다.
  });

  test("resumeTrim: 바닥 복귀 시 1회 트림 후 정상화, 제거 행 수 반환", () => {
    const store = createMessageStore("me");
    store.seed(Array.from({ length: 500 }, (_, i) => ({
      id: `s${i}`, ts: 1000 + i, senderUid: "A", nickname: "a", text: "x",
    })));
    // prepend 로 2건 과거 추가(유예) → 502.
    store.prepend([
      { id: "o0", ts: 498, senderUid: "A", nickname: "a", text: "o" },
      { id: "o1", ts: 499, senderUid: "A", nickname: "a", text: "p" },
    ]);
    assert.equal(store.get().length, 502);
    const removed = store.resumeTrim();
    assert.equal(removed, 2); // 502 - 500 = 2 제거.
    assert.equal(store.get().length, 500);
    assert.equal(store.get()[0].id, "s0"); // 가장 오래된 prepend 분이 잘려나감.
  });

  test("resumeTrim: 유예 중이 아니거나 초과분이 없으면 0(반복 호출 안전)", () => {
    const store = createMessageStore("me");
    store.seed([{ id: "1", ts: 100, senderUid: "A", nickname: "a", text: "x" }]);
    assert.equal(store.resumeTrim(), 0); // prepend 안 함 → 유예 아님.
    store.prepend([{ id: "0", ts: 50, senderUid: "A", nickname: "a", text: "z" }]);
    assert.equal(store.resumeTrim(), 0); // 2건뿐 → 초과 없음.
    assert.equal(store.resumeTrim(), 0); // 이미 해제 → no-op.
  });

  test("seed: 이전 방의 트림 유예 상태를 리셋", () => {
    const store = createMessageStore("me");
    store.seed([{ id: "1", ts: 100, senderUid: "A", nickname: "a", text: "x" }]);
    store.prepend([{ id: "0", ts: 50, senderUid: "A", nickname: "a", text: "z" }]); // 유예 ON
    // 새 방 시드(501건) → 유예 리셋되어 트림 정상 작동.
    store.seed(Array.from({ length: 501 }, (_, i) => ({
      id: `n${i}`, ts: 2000 + i, senderUid: "A", nickname: "a", text: "y",
    })));
    assert.equal(store.get().length, 500);
  });
});
