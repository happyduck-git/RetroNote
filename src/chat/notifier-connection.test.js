import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeNotifierConnection } from "./notifier-connection.js";

// 상태 콜백을 붙잡아 두는 가짜 notifier. order 는 감독자 대역과 공유해 호출 순서를 본다.
function makeFakeNotifier(order = []) {
  const fake = {
    started: [],
    stopped: 0,
    reconnects: 0,
    healthy: true,
    status: "connected",
    statusCb: null,
    order,
    async start(uid) { order.push("notifier.start"); fake.started.push(uid); },
    async stop() { fake.stopped++; },
    async reconnect() { fake.reconnects++; },
    isHealthy: () => fake.healthy,
    getStatus: () => fake.status,
    onStatus(cb) { fake.statusCb = cb; return () => { fake.statusCb = null; }; },
  };
  return fake;
}

// 감독자 대역 — 넘겨받은 협력자를 그대로 노출해 배선을 검사한다.
function makeFakeController(order = []) {
  const fake = { started: 0, stopped: 0, fed: [], retried: 0, woke: 0, opts: null, created: 0, order };
  return {
    fake,
    create(opts) {
      fake.opts = opts;
      fake.created++;
      return {
        start: () => { order.push("controller.start"); fake.started++; },
        stop: () => fake.stopped++,
        feedTransportState: (s) => fake.fed.push(s),
        retryNow: () => fake.retried++,
        wake: () => fake.woke++,
        forceRetry: () => {},
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
    assert.deepEqual(ctl.fake.fed, ["connected", "error"]); // 앞의 것은 start 직후 따라잡기 씨앗
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

describe("notifier-connection 시작 순서와 겹침", () => {
  test("감독자는 notifier 가 뜬 뒤에 켠다", async () => {
    const order = [];
    const notifier = makeFakeNotifier(order);
    const ctl = makeFakeController(order);
    const conn = makeNotifierConnection({ notifier, createController: ctl.create });
    await conn.start("me-uid");
    assert.deepEqual(order, ["notifier.start", "controller.start"]);
  });

  test("켜기 전에 지나간 실패를 따라잡는다", async () => {
    const notifier = makeFakeNotifier();
    const ctl = makeFakeController();
    notifier.status = "error"; // start 도중 조용히 실패한 경우
    const conn = makeNotifierConnection({ notifier, createController: ctl.create });
    await conn.start("me-uid");
    assert.deepEqual(ctl.fake.fed, ["error"], "이 씨앗이 없으면 실패가 영영 묻힌다");
  });

  test("겹친 start 에도 감독자는 하나만 살아남는다", async () => {
    const notifier = makeFakeNotifier();
    const ctl = makeFakeController();
    const waiting = [];
    notifier.stop = () => new Promise((r) => waiting.push(r)); // 정리가 한 박자 늦는 상황
    const conn = makeNotifierConnection({ notifier, createController: ctl.create });
    const first = conn.start("me-uid");
    const second = conn.start("me-uid");
    for (const r of waiting) r();
    await Promise.all([first, second]);
    assert.equal(ctl.fake.created, 1, "먼저 들어온 start 는 감독자를 만들지 않아야 한다");
    assert.equal(ctl.fake.started, 1);
  });

  test("wake 는 감독자의 깨우기 경로로 간다(간격 적용 대상)", async () => {
    const notifier = makeFakeNotifier();
    const ctl = makeFakeController();
    const conn = makeNotifierConnection({ notifier, createController: ctl.create });
    await conn.start("me-uid");
    conn.wake();
    assert.equal(ctl.fake.woke, 1);
    assert.equal(ctl.fake.retried, 0, "창 복귀는 수동 재시도가 아니다");
  });

  test("stop 뒤에는 상태가 초기값으로 돌아간다", async () => {
    const notifier = makeFakeNotifier();
    const ctl = makeFakeController();
    const conn = makeNotifierConnection({ notifier, createController: ctl.create });
    await conn.start("me-uid");
    ctl.fake.opts.onState({ state: "waiting", attempt: 3, retryInSec: 10 });
    await conn.stop();
    assert.deepEqual(conn.getState(), { state: "connecting", attempt: 0, retryInSec: 0 });
  });
});
