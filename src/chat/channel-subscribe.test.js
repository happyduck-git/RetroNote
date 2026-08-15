import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { subscribeChannel, CHANNEL_STATUS_MAP } from "./channel-subscribe.js";

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
    assert.equal(CHANNEL_STATUS_MAP.SUBSCRIBED, "connected");
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
