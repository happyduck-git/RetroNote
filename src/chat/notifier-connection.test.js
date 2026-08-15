import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeNotifierConnection } from "./notifier-connection.js";

// 상태 콜백을 붙잡아 두는 가짜 notifier.
function makeFakeNotifier() {
  const fake = {
    started: [],
    stopped: 0,
    reconnects: 0,
    healthy: true,
    statusCb: null,
    async start(uid) { fake.started.push(uid); },
    async stop() { fake.stopped++; },
    async reconnect() { fake.reconnects++; },
    isHealthy: () => fake.healthy,
    onStatus(cb) { fake.statusCb = cb; return () => { fake.statusCb = null; }; },
  };
  return fake;
}

// 감독자 대역 — 넘겨받은 협력자를 그대로 노출해 배선을 검사한다.
function makeFakeController() {
  const fake = { started: 0, stopped: 0, fed: [], retried: 0, opts: null };
  return {
    fake,
    create(opts) {
      fake.opts = opts;
      return {
        start: () => fake.started++,
        stop: () => fake.stopped++,
        onTransportState: (s) => fake.fed.push(s),
        retryNow: () => fake.retried++,
        reportUnhealthy: () => {},
        getState: () => ({ state: "connected", attempt: 0, retryInSec: 0 }),
      };
    },
  };
}

describe("notifier-connection", () => {
  test("start 는 감독자를 띄우고 notifier 를 시작한다", async () => {
    const notifier = makeFakeNotifier();
    const ctl = makeFakeController();
    const conn = makeNotifierConnection({ notifier, createController: ctl.create });
    await conn.start("me-uid");
    assert.equal(ctl.fake.started, 1);
    assert.deepEqual(notifier.started, ["me-uid"]);
  });

  test("notifier 의 상태가 감독자에게 전달된다", async () => {
    const notifier = makeFakeNotifier();
    const ctl = makeFakeController();
    const conn = makeNotifierConnection({ notifier, createController: ctl.create });
    await conn.start("me-uid");
    notifier.statusCb("error");
    assert.deepEqual(ctl.fake.fed, ["error"]);
  });

  test("감독자의 재연결은 notifier.reconnect 로 이어진다", async () => {
    const notifier = makeFakeNotifier();
    const ctl = makeFakeController();
    const conn = makeNotifierConnection({ notifier, createController: ctl.create });
    await conn.start("me-uid");
    await ctl.fake.opts.reconnect();
    assert.equal(notifier.reconnects, 1);
    assert.equal(ctl.fake.opts.isHealthy(), true);
  });

  test("상태 변화가 구독자에게 방송된다", async () => {
    const notifier = makeFakeNotifier();
    const ctl = makeFakeController();
    const conn = makeNotifierConnection({ notifier, createController: ctl.create });
    const seen = [];
    conn.subscribe((s) => seen.push(s));
    await conn.start("me-uid");
    ctl.fake.opts.onState({ state: "waiting", attempt: 2, retryInSec: 5 });
    assert.deepEqual(seen, [{ state: "waiting", attempt: 2, retryInSec: 5 }]);
    assert.deepEqual(conn.getState(), { state: "waiting", attempt: 2, retryInSec: 5 });
  });

  test("retryNow 는 감독자로 넘어간다", async () => {
    const notifier = makeFakeNotifier();
    const ctl = makeFakeController();
    const conn = makeNotifierConnection({ notifier, createController: ctl.create });
    await conn.start("me-uid");
    conn.retryNow();
    assert.equal(ctl.fake.retried, 1);
  });

  test("stop 은 감독자와 notifier 를 함께 정리한다", async () => {
    const notifier = makeFakeNotifier();
    const ctl = makeFakeController();
    const conn = makeNotifierConnection({ notifier, createController: ctl.create });
    await conn.start("me-uid");
    await conn.stop();
    assert.equal(ctl.fake.stopped, 1);
    assert.equal(notifier.stopped, 2); // start 안에서 1회 + stop 에서 1회
    assert.equal(notifier.statusCb, null);
  });
});
