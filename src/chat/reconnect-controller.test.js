import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createReconnectController, RETRY_DELAYS_MS } from "./reconnect-controller.js";

// 진행 중인 promise 체인이 다 풀릴 때까지 이벤트 루프를 한 바퀴 돌린다.
const settle = () => new Promise((r) => setImmediate(r));

// 가짜 시계 + 가짜 타이머 + 가짜 wake 신호로 감독자를 구동하는 하네스.
function makeHarness(opts = {}) {
  let time = 0;
  let nextId = 1;
  const timers = new Map();
  const states = [];
  let wake = null;
  const h = {
    states,
    calls: 0,
    healthy: true,
    impl: async () => {},
    advance(ms) {
      time += ms;
      for (const [id, t] of [...timers]) {
        if (t.at <= time) {
          timers.delete(id);
          t.fn();
        }
      }
    },
    wake: () => wake && wake(),
    last: () => states[states.length - 1],
  };
  h.controller = createReconnectController({
    reconnect: () => {
      h.calls++;
      return h.impl();
    },
    isHealthy: () => h.healthy,
    onState: (s) => states.push(s),
    bindWake: (fn) => {
      wake = fn;
      return () => {
        wake = null;
      };
    },
    now: () => time,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.set(id, { fn, at: time + ms });
      return id;
    },
    clearTimer: (id) => timers.delete(id),
    ...opts,
  });
  h.controller.start();
  return h;
}

// 실패하는 재연결.
function failing() {
  return async () => {
    throw new Error("boom");
  };
}

describe("createReconnectController", () => {
  test("끊김 신호를 받으면 곧바로 한 번 재연결한다", async () => {
    const h = makeHarness();
    h.controller.onTransportState("error");
    await settle();
    assert.equal(h.calls, 1);
    assert.equal(h.last().state, "connected");
  });

  test("실패하면 2초 → 5초 순으로 간격을 늘려 다시 시도한다", async () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      const h = makeHarness();
      h.impl = failing();
      h.controller.onTransportState("error");
      await settle();
      assert.equal(h.calls, 1);
      assert.equal(h.last().state, "waiting");
      assert.equal(h.last().retryInSec, 2);

      h.advance(2000); // 대기 만료 → 두 번째 시도
      await settle();
      assert.equal(h.calls, 2);
      assert.equal(h.last().retryInSec, 5);

      h.advance(5000);
      await settle();
      assert.equal(h.calls, 3);
      assert.equal(h.last().retryInSec, 10);
    } finally {
      console.error = origErr;
    }
  });

  test("간격은 마지막 값에서 멈춘다", () => {
    assert.equal(RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1], 30000);
  });

  test("대기 중 창이 앞으로 오면 기다리지 않고 즉시 시도하고 간격도 처음으로 되돌린다", async () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      const h = makeHarness();
      h.impl = failing();
      h.controller.onTransportState("error");
      await settle();
      h.advance(2000);
      await settle();
      assert.equal(h.calls, 2); // 여기까지 두 번 실패, 다음 대기는 5초

      h.impl = async () => {};
      h.wake();
      await settle();
      assert.equal(h.calls, 3);
      assert.equal(h.last().state, "connected");
      assert.equal(h.last().attempt, 0);
    } finally {
      console.error = origErr;
    }
  });

  test("정상 연결 중에 창이 앞으로 오면 아무것도 하지 않는다", async () => {
    const h = makeHarness();
    h.controller.onTransportState("connected");
    h.wake();
    await settle();
    assert.equal(h.calls, 0);
  });

  test("연결된 것처럼 보여도 채널이 죽었으면(좀비) 창 복귀 시 다시 붙인다", async () => {
    const h = makeHarness();
    h.controller.onTransportState("connected");
    h.healthy = false;
    h.wake();
    await settle();
    assert.equal(h.calls, 1);
  });

  test("reportUnhealthy 는 연결 상태여도 재연결을 건다", async () => {
    const h = makeHarness();
    h.controller.onTransportState("connected");
    h.controller.reportUnhealthy();
    await settle();
    assert.equal(h.calls, 1);
  });

  test("시도가 진행 중이면 겹쳐 부르지 않는다", async () => {
    let release;
    const h = makeHarness();
    h.impl = () => new Promise((r) => (release = r));
    h.controller.onTransportState("error");
    await settle();
    h.controller.retryNow();
    h.controller.onTransportState("error");
    await settle();
    assert.equal(h.calls, 1);
    release();
    await settle();
    assert.equal(h.last().state, "connected");
  });

  test("stop 이후 늦게 끝난 시도는 상태를 바꾸지 않는다", async () => {
    let release;
    const h = makeHarness();
    h.impl = () => new Promise((r) => (release = r));
    h.controller.onTransportState("error");
    await settle();
    const before = h.states.length;
    h.controller.stop();
    release();
    await settle();
    assert.equal(h.states.length, before);
  });

  test("대기 중에는 남은 초가 줄어드는 것이 방송된다", async () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      const h = makeHarness();
      h.impl = failing();
      h.controller.onTransportState("error");
      await settle();
      assert.equal(h.last().retryInSec, 2);
      h.advance(1000); // tick — 아직 만료 전
      await settle();
      assert.equal(h.last().retryInSec, 1);
      assert.equal(h.calls, 1);
    } finally {
      console.error = origErr;
    }
  });

  test("붙자마자 끊기는 일이 반복되면 간격이 늘어난다(무한 재시도 방지)", async () => {
    const h = makeHarness();
    h.controller.onTransportState("error"); // 첫 끊김 → 지체 없이 시도
    await settle();
    assert.equal(h.calls, 1);
    assert.equal(h.last().state, "connected");

    h.controller.onTransportState("error"); // 붙자마자 또 끊김 → 벌점
    await settle();
    assert.equal(h.last().state, "waiting");
    assert.equal(h.last().retryInSec, 2);

    h.advance(2000);
    await settle();
    h.controller.onTransportState("error");
    await settle();
    assert.equal(h.last().retryInSec, 5);
  });

  test("한동안 잘 붙어 있었으면 다음 끊김은 다시 즉시 시도한다", async () => {
    const h = makeHarness();
    h.controller.onTransportState("error");
    await settle();
    h.controller.onTransportState("error"); // 벌점 → 2초 대기
    await settle();
    h.advance(2000);
    await settle();
    assert.equal(h.calls, 2);
    assert.equal(h.last().state, "connected");

    h.advance(30000); // 30초 이상 안정 → 벌점 초기화
    await settle();
    h.controller.onTransportState("error");
    await settle();
    assert.equal(h.calls, 3); // 대기 없이 곧바로 시도
    assert.equal(h.last().state, "connected");
  });
});
