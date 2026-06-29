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

describe("message-store prepend (무한 스크롤)", () => {
  test("prepend: 과거 묶음을 앞에 붙이고 오름차순 유지, 신규 건수 반환", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map());
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
    store.setNicknameMap(new Map());
    store.seed([{ id: "10", ts: 1000, senderUid: "A", nickname: "a", text: "j" }]);
    const n = store.prepend([
      { id: "9", ts: 900, senderUid: "A", nickname: "a", text: "i" },
      { id: "10", ts: 1000, senderUid: "A", nickname: "a", text: "dup" }, // 중복 → 스킵
    ]);
    assert.equal(n, 1);
    assert.deepEqual(store.get().map((m) => m.id), ["9", "10"]);
  });

  test("prepend: mine/displayName 적용 — 더 오래된 박제는 기존 최신 displayName 을 안 바꾼다", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map()); // 떠난 멤버 → snapshot 폴백
    store.seed([{ id: "10", ts: 1000, senderUid: "me", nickname: "new", text: "j" }]);
    store.prepend([{ id: "9", ts: 900, senderUid: "me", nickname: "old", text: "i" }]);
    const rows = store.get();
    assert.deepEqual(rows.map((m) => m.mine), [true, true]);
    // 최신 박제(new)로 둘 다 통일 — 과거 prepend 가 latest 를 끌어내리지 않음.
    assert.deepEqual(rows.map((m) => m.displayName), ["new", "new"]);
  });

  test("prepend: 빈 배열/전부 중복이면 0 반환", () => {
    const store = createMessageStore("me");
    store.seed([{ id: "1", ts: 100, senderUid: "A", nickname: "a", text: "x" }]);
    assert.equal(store.prepend([]), 0);
    assert.equal(store.prepend([{ id: "1", ts: 100, senderUid: "A", nickname: "a", text: "x" }]), 0);
  });

  test("prepend 후에는 트림 유예 — 라이브 add 가 MAX 초과해도 과거를 안 버린다", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map());
    // MAX_MESSAGES=500. 500건 시드 후 prepend 1건 → 501.
    const seedMsgs = Array.from({ length: 500 }, (_, i) => ({
      id: `s${i}`, ts: 1000 + i, senderUid: "A", nickname: "a", text: "x",
    }));
    store.seed(seedMsgs);
    assert.equal(store.get().length, 500);
    store.prepend([{ id: "old", ts: 500, senderUid: "A", nickname: "a", text: "o" }]);
    assert.equal(store.get().length, 501); // 트림 안 됨
    // 라이브 add 가 더 들어와도 유예 중이라 앞쪽(과거)을 안 자른다.
    store.add({ id: "live", ts: 9999, senderUid: "A", nickname: "a", text: "n" });
    assert.equal(store.get()[0].id, "old"); // 과거 그대로 맨 앞
    assert.equal(store.get().length, 502);
  });

  test("resumeTrim: 바닥 복귀 시 1회 트림 후 정상화, 제거 행 수 반환", () => {
    const store = createMessageStore("me");
    store.setNicknameMap(new Map());
    const seedMsgs = Array.from({ length: 500 }, (_, i) => ({
      id: `s${i}`, ts: 1000 + i, senderUid: "A", nickname: "a", text: "x",
    }));
    store.seed(seedMsgs);
    // prepend 로 2건 과거 추가(유예) → 502.
    store.prepend([
      { id: "o1", ts: 500, senderUid: "A", nickname: "a", text: "o" },
      { id: "o2", ts: 501, senderUid: "A", nickname: "a", text: "p" },
    ]);
    assert.equal(store.get().length, 502);
    const removed = store.resumeTrim();
    assert.equal(removed, 2);             // 502 → 500, 앞에서 2건 제거
    assert.equal(store.get().length, 500);
    assert.equal(store.get()[0].id, "s0"); // 가장 오래된 prepend 분이 잘려나감
    // 유예 해제 확인: 이후 add 가 다시 정상 트림.
    store.add({ id: "live", ts: 99999, senderUid: "A", nickname: "a", text: "n" });
    assert.equal(store.get().length, 500);
  });

  test("resumeTrim: 유예 중이 아니거나 초과분이 없으면 0(반복 호출 안전)", () => {
    const store = createMessageStore("me");
    store.seed([{ id: "1", ts: 100, senderUid: "A", nickname: "a", text: "x" }]);
    assert.equal(store.resumeTrim(), 0); // prepend 안 함 → 유예 아님
    store.prepend([{ id: "0", ts: 50, senderUid: "A", nickname: "a", text: "z" }]);
    assert.equal(store.resumeTrim(), 0); // 2건뿐 → 초과 없음
    assert.equal(store.resumeTrim(), 0); // 이미 해제 → no-op
  });

  test("seed: 이전 방의 트림 유예 상태를 리셋", () => {
    const store = createMessageStore("me");
    store.seed([{ id: "1", ts: 100, senderUid: "A", nickname: "a", text: "x" }]);
    store.prepend([{ id: "0", ts: 50, senderUid: "A", nickname: "a", text: "z" }]); // 유예 ON
    // 새 방 시드(501건) → 유예 리셋되어 트림 정상 작동.
    store.seed(Array.from({ length: 501 }, (_, i) => ({
      id: `n${i}`, ts: 2000 + i, senderUid: "A", nickname: "a", text: "x",
    })));
    assert.equal(store.get().length, 500); // 트림됨
  });
});
