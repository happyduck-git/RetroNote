import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { subscribeChannel } from "./channel-subscribe.js";

// subscribe(cb) 를 붙잡아 테스트가 원하는 순서로 상태를 흘려보내는 가짜 채널.
function makeFakeChannel() {
  const fake = { cb: null, subscribe(cb) { fake.cb = cb; return fake; } };
  return fake;
}

describe("subscribeChannel", () => {
  test("SUBSCRIBED 면 resolve 하고 connected 를 알린다", async () => {
    const ch = makeFakeChannel();
    const seen = [];
    const p = subscribeChannel(ch, (s) => seen.push(s));
    ch.cb("SUBSCRIBED");
    await p;
    assert.deepEqual(seen, ["connected"]);
  });

  test("CHANNEL_ERROR 면 reject 하고 error 를 알린다", async () => {
    const ch = makeFakeChannel();
    const seen = [];
    const p = subscribeChannel(ch, (s) => seen.push(s));
    ch.cb("CHANNEL_ERROR");
    await assert.rejects(p, /CHANNEL_ERROR/);
    assert.deepEqual(seen, ["error"]);
  });

  test("TIMED_OUT 도 reject 대상", async () => {
    const ch = makeFakeChannel();
    const p = subscribeChannel(ch, () => {});
    ch.cb("TIMED_OUT");
    await assert.rejects(p, /TIMED_OUT/);
  });

  test("이미 확정된 뒤 오는 상태는 promise 를 다시 건드리지 않고 알림만 계속한다", async () => {
    const ch = makeFakeChannel();
    const seen = [];
    const p = subscribeChannel(ch, (s) => seen.push(s));
    ch.cb("SUBSCRIBED");
    await p;
    ch.cb("CLOSED");
    ch.cb("SUBSCRIBED");
    assert.deepEqual(seen, ["connected", "closed", "connected"]);
  });

  test("모르는 상태는 connecting 으로 본다", async () => {
    const ch = makeFakeChannel();
    const seen = [];
    // 확정되지 않은 채 끝나는 테스트라 진짜 타이머를 걸면 테스트 종료 후 timeout 거부가 튄다.
    subscribeChannel(ch, (s) => seen.push(s), { setTimer: () => 1, clearTimer: () => {} });
    ch.cb("JOINING");
    assert.deepEqual(seen, ["connecting"]);
  });

  test("아무 상태도 오지 않으면 제한 시간 뒤에 끊는다", async () => {
    const ch = { subscribe() { return ch; } }; // 콜백을 영영 부르지 않는 채널
    let fire = null;
    const p = subscribeChannel(ch, () => {}, {
      timeoutMs: 1000,
      setTimer: (fn) => { fire = fn; return 1; },
      clearTimer: () => {},
    });
    fire();
    await assert.rejects(p, /timeout/);
  });
});

describe("subscribeChannel 예외 방어", () => {
  test("onStatus 가 던져도 promise 는 확정된다", async () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      const ch = makeFakeChannel();
      const p = subscribeChannel(ch, () => { throw new Error("boom"); }, { setTimer: () => 1, clearTimer: () => {} });
      ch.cb("SUBSCRIBED");
      await p; // 던지는 구독자 때문에 제한 시간까지 매달리면 안 된다
    } finally {
      console.error = origErr;
    }
  });

  test("onStatus 가 던져도 그 뒤 상태 알림은 계속된다", async () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      const seen = [];
      let first = true;
      const ch = makeFakeChannel();
      const p = subscribeChannel(ch, (s) => {
        if (first) { first = false; throw new Error("boom"); }
        seen.push(s);
      }, { setTimer: () => 1, clearTimer: () => {} });
      ch.cb("SUBSCRIBED");
      await p;
      ch.cb("CLOSED");
      assert.deepEqual(seen, ["closed"]);
    } finally {
      console.error = origErr;
    }
  });
});
