import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createMessageStore } from "./message-store.js";
import { createBackfiller, createBackfillGate } from "./backfill.js";

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

describe("createBackfiller", () => {
  test("store가 비어있으면 firstJoinedAt을 sinceTs로 사용", async () => {
    const fetchMessages = makeFetch(() => []);
    const store = createMessageStore("user-1");
    const backfill = createBackfiller({
      store,
      fetchMessages,
      firstJoinedAt: 1000,
      code: "ROOM1",
    });
    await backfill();
    assert.deepEqual(fetchMessages.calls, [["ROOM1", 1000]]);
  });

  test("store에 메시지가 있으면 마지막 메시지 ts를 sinceTs로 사용", async () => {
    const fetchMessages = makeFetch(() => []);
    const store = createMessageStore("user-1");
    store.seed([
      { id: "1", ts: 100, senderUid: "other", nickname: "a", text: "hi" },
      { id: "2", ts: 200, senderUid: "other", nickname: "b", text: "yo" },
    ]);
    const backfill = createBackfiller({
      store,
      fetchMessages,
      firstJoinedAt: 50,
      code: "ROOM1",
    });
    await backfill();
    assert.deepEqual(fetchMessages.calls, [["ROOM1", 200]]);
  });

  test("fetch 결과를 store에 주입, 기존 id는 dedup", async () => {
    const fetchMessages = makeFetch(() => [
      { id: "2", ts: 200, senderUid: "other", nickname: "b", text: "yo" }, // 중복
      { id: "3", ts: 300, senderUid: "other", nickname: "c", text: "new" },
    ]);
    const store = createMessageStore("user-1");
    store.seed([
      { id: "2", ts: 200, senderUid: "other", nickname: "b", text: "yo" },
    ]);
    const backfill = createBackfiller({
      store,
      fetchMessages,
      firstJoinedAt: 0,
      code: "ROOM1",
    });
    await backfill();
    assert.deepEqual(
      store.get().map((m) => m.id),
      ["2", "3"],
    );
  });

  test("동시 호출은 in-flight 가드로 fetch 1회만 수행", async () => {
    let resolve;
    const pending = new Promise((r) => {
      resolve = r;
    });
    let callCount = 0;
    const fetchMessages = () => {
      callCount++;
      return pending;
    };
    const store = createMessageStore("user-1");
    const backfill = createBackfiller({
      store,
      fetchMessages,
      firstJoinedAt: 0,
      code: "ROOM1",
    });
    const p1 = backfill();
    const p2 = backfill();
    assert.equal(callCount, 1);
    resolve([]);
    await Promise.all([p1, p2]);
    assert.equal(callCount, 1);
  });

  test("성공하면 true, 실패하면 false 를 돌려준다", async () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      let i = 0;
      const fetchMessages = () => {
        i++;
        return i === 1 ? Promise.reject(new Error("network down")) : Promise.resolve([]);
      };
      const store = createMessageStore("user-1");
      const backfill = createBackfiller({ store, fetchMessages, firstJoinedAt: 0, code: "ROOM1" });
      assert.equal(await backfill(), false);
      assert.equal(await backfill(), true);
    } finally {
      console.error = origErr;
    }
  });

  test("이미 진행 중이라 건너뛴 호출은 실패로 보지 않는다", async () => {
    let resolve;
    const pending = new Promise((r) => (resolve = r));
    const store = createMessageStore("user-1");
    const backfill = createBackfiller({
      store,
      fetchMessages: () => pending,
      firstJoinedAt: 0,
      code: "ROOM1",
    });
    const p1 = backfill();
    assert.equal(await backfill(), true);
    resolve([]);
    await p1;
  });

  test("fetch 실패는 catch로 흡수되고 다음 호출은 정상 동작", async () => {
    const origErr = console.error;
    console.error = () => {}; // 테스트 출력 노이즈 차단
    try {
      let i = 0;
      const fetchMessages = () => {
        i++;
        if (i === 1) return Promise.reject(new Error("network down"));
        return Promise.resolve([
          { id: "1", ts: 100, senderUid: "x", nickname: "a", text: "ok" },
        ]);
      };
      const store = createMessageStore("user-1");
      const backfill = createBackfiller({
        store,
        fetchMessages,
        firstJoinedAt: 0,
        code: "ROOM1",
      });
      await backfill(); // 첫 호출: 실패, store 그대로
      assert.equal(store.get().length, 0);
      await backfill(); // 두 번째 호출: 성공, in-flight 가 해제되어 정상 진행
      assert.equal(store.get().length, 1);
    } finally {
      console.error = origErr;
    }
  });
});

describe("createBackfillGate", () => {
  test("방에 들어온 직후의 첫 연결은 건너뛴다(seed 가 이미 채웠다)", () => {
    const gate = createBackfillGate();
    assert.equal(gate.onStatus("connecting"), false);
    assert.equal(gate.onStatus("connected"), false);
  });

  test("한 번 붙었다가 다시 붙으면 보충한다", () => {
    const gate = createBackfillGate();
    gate.onStatus("connected");
    assert.equal(gate.onStatus("closed"), false);
    assert.equal(gate.onStatus("connected"), true);
  });

  test("첫 연결이 실패한 뒤 재연결로 처음 붙어도 보충한다", () => {
    const gate = createBackfillGate();
    assert.equal(gate.onStatus("connecting"), false);
    assert.equal(gate.onStatus("error"), false);
    assert.equal(gate.onStatus("connected"), true, "그 사이 온 메시지를 놓치면 안 된다");
  });

  test("connecting 은 끊김으로 세지 않는다", () => {
    const gate = createBackfillGate();
    gate.onStatus("connecting");
    gate.onStatus("connecting");
    assert.equal(gate.onStatus("connected"), false);
  });

  test("markFailed 도 다음 연결에서 보충을 부른다", () => {
    const gate = createBackfillGate();
    gate.markFailed();
    assert.equal(gate.onStatus("connected"), true);
  });

  test("보충하고 나면 표시가 지워진다", () => {
    const gate = createBackfillGate();
    gate.onStatus("error");
    assert.equal(gate.onStatus("connected"), true);
    assert.equal(gate.hasConnected(), true);
  });
});
