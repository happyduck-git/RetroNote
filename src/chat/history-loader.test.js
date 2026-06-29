import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createMessageStore } from "./message-store.js";
import { createHistoryLoader } from "./history-loader.js";

// 호출 인자를 기록하는 가짜 fetchMessages.
function makeFetch(impl) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return Promise.resolve(impl(...args));
  };
  fn.calls = calls;
  return fn;
}

function seededStore(msgs) {
  const store = createMessageStore("me");
  store.seed(msgs);
  return store;
}

describe("createHistoryLoader", () => {
  test("커서 = 현재 최상단(가장 오래된) 메시지의 {ts,id}, sinceTs=firstJoinedAt, limit=pageSize", async () => {
    const fetchMessages = makeFetch(() => []);
    const store = seededStore([
      { id: "b", ts: 200, senderUid: "A", nickname: "a", text: "y" },
      { id: "c", ts: 300, senderUid: "A", nickname: "a", text: "z" },
    ]);
    const loadOlder = createHistoryLoader({ store, fetchMessages, firstJoinedAt: 10, code: "R", pageSize: 50 });
    await loadOlder();
    assert.deepEqual(fetchMessages.calls, [
      ["R", { sinceTs: 10, beforeTs: 200, beforeId: "b", limit: 50 }],
    ]);
  });

  test("받은 과거를 prepend, 페이지를 꽉 채우면 hasMore=true, newlyAdded 반환", async () => {
    const older = Array.from({ length: 50 }, (_, i) => ({
      id: `o${i}`, ts: 100 + i, senderUid: "A", nickname: "a", text: "x",
    }));
    const fetchMessages = makeFetch(() => older);
    const store = seededStore([{ id: "z", ts: 1000, senderUid: "A", nickname: "a", text: "j" }]);
    const loadOlder = createHistoryLoader({ store, fetchMessages, firstJoinedAt: 0, code: "R", pageSize: 50 });
    const res = await loadOlder();
    assert.equal(res.newlyAdded, 50);
    assert.equal(res.hasMore, true);
    assert.equal(store.get().length, 51);
    assert.equal(store.get()[0].id, "o0"); // 가장 오래된 게 맨 앞
  });

  test("페이지 미만이면 hasMore=false (바닥 도달)", async () => {
    const fetchMessages = makeFetch(() => [
      { id: "o", ts: 100, senderUid: "A", nickname: "a", text: "x" },
    ]);
    const store = seededStore([{ id: "z", ts: 1000, senderUid: "A", nickname: "a", text: "j" }]);
    const loadOlder = createHistoryLoader({ store, fetchMessages, firstJoinedAt: 0, code: "R", pageSize: 50 });
    const res = await loadOlder();
    assert.equal(res.hasMore, false);
    assert.equal(res.newlyAdded, 1);
  });

  test("경계가 전부 이미 store 에 있으면 newlyAdded=0 → hasMore=false (커서 정지 방지)", async () => {
    // pageSize 만큼 받았지만 전부 dedup 되는 병리적 케이스: 커서가 안 움직이므로 진행 불가로 본다.
    const dup = Array.from({ length: 2 }, (_, i) => ({
      id: `d${i}`, ts: 100 + i, senderUid: "A", nickname: "a", text: "x",
    }));
    const fetchMessages = makeFetch(() => dup);
    const store = seededStore([
      ...dup,
      { id: "z", ts: 1000, senderUid: "A", nickname: "a", text: "j" },
    ]);
    const loadOlder = createHistoryLoader({ store, fetchMessages, firstJoinedAt: 0, code: "R", pageSize: 2 });
    const res = await loadOlder();
    assert.equal(res.newlyAdded, 0);
    assert.equal(res.hasMore, false);
  });

  test("빈 store 면 fetch 없이 no-op (hasMore=false)", async () => {
    const fetchMessages = makeFetch(() => []);
    const store = createMessageStore("me");
    const loadOlder = createHistoryLoader({ store, fetchMessages, firstJoinedAt: 0, code: "R", pageSize: 50 });
    const res = await loadOlder();
    assert.equal(res.hasMore, false);
    assert.equal(fetchMessages.calls.length, 0);
  });

  test("동시 호출은 in-flight 가드로 fetch 1회만", async () => {
    let resolve;
    const pending = new Promise((r) => { resolve = r; });
    let calls = 0;
    const fetchMessages = () => { calls++; return pending; };
    const store = seededStore([{ id: "z", ts: 1000, senderUid: "A", nickname: "a", text: "j" }]);
    const loadOlder = createHistoryLoader({ store, fetchMessages, firstJoinedAt: 0, code: "R", pageSize: 50 });
    const p1 = loadOlder();
    const p2 = loadOlder(); // in-flight → 즉시 반환, fetch 호출 안 함
    resolve([]);
    await Promise.all([p1, p2]);
    assert.equal(calls, 1);
  });
});
