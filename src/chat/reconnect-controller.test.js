import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createReconnectController } from "./reconnect-controller.js";

// 진행 중인 promise 체인이 다 풀릴 때까지 이벤트 루프를 한 바퀴 돌린다.
const settle = () => new Promise((r) => setImmediate(r));

// 가짜 시계 + 가짜 타이머 + 가짜 wake 신호로 감독자를 구동하는 하네스.
function makeHarness(opts = {}) {
  const { noStart, ...cfg } = opts; // noStart: 만들기만 하고 켜지 않은 감독자를 시험할 때
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
    ...cfg,
  });
  if (!noStart) h.controller.start();
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
    h.controller.feedTransportState("error");
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
      h.controller.feedTransportState("error");
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

  test("연달아 실패해도 간격은 마지막 값에서 멈춘다", async () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      const h = makeHarness();
      h.impl = failing();
      h.controller.feedTransportState("error");
      await settle();
      const seen = [h.last().retryInSec];
      // 대기 만료 → 실패 → 다시 대기 를 반복하며 간격이 어떻게 커지는지 본다.
      for (let i = 0; i < 6; i++) {
        h.advance(h.last().retryInSec * 1000);
        await settle();
        seen.push(h.last().retryInSec);
      }
      assert.deepEqual(seen, [2, 5, 10, 30, 30, 30, 30]);
      assert.equal(h.calls, 7, "상한에 닿아도 재시도는 계속된다");
    } finally {
      console.error = origErr;
    }
  });

  test("대기 중 창이 앞으로 오면 기다리지 않고 즉시 시도하고 간격도 처음으로 되돌린다", async () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      const h = makeHarness();
      h.impl = failing();
      h.controller.feedTransportState("error");
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
    h.controller.feedTransportState("connected");
    h.wake();
    await settle();
    assert.equal(h.calls, 0);
  });

  test("연결된 것처럼 보여도 채널이 죽었으면(좀비) 창 복귀 시 다시 붙인다", async () => {
    const h = makeHarness();
    h.controller.feedTransportState("connected");
    h.healthy = false;
    h.wake();
    await settle();
    assert.equal(h.calls, 1);
  });

  test("forceRetry 는 연결 상태여도 재연결을 건다", async () => {
    const h = makeHarness();
    h.controller.feedTransportState("connected");
    h.controller.forceRetry();
    await settle();
    assert.equal(h.calls, 1);
  });

  test("시도가 진행 중이면 겹쳐 부르지 않는다", async () => {
    let release;
    const h = makeHarness();
    h.impl = () => new Promise((r) => (release = r));
    h.controller.feedTransportState("error");
    await settle();
    h.controller.retryNow();
    h.controller.feedTransportState("error");
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
    h.controller.feedTransportState("error");
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
      h.controller.feedTransportState("error");
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
    h.controller.feedTransportState("error"); // 첫 끊김 → 지체 없이 시도
    await settle();
    assert.equal(h.calls, 1);
    assert.equal(h.last().state, "connected");

    h.controller.feedTransportState("error"); // 붙자마자 또 끊김 → 벌점
    await settle();
    assert.equal(h.last().state, "waiting");
    assert.equal(h.last().retryInSec, 2);

    h.advance(2000);
    await settle();
    h.controller.feedTransportState("error");
    await settle();
    assert.equal(h.last().retryInSec, 5);
  });

  test("한동안 잘 붙어 있었으면 다음 끊김은 다시 즉시 시도한다", async () => {
    const h = makeHarness();
    h.controller.feedTransportState("error");
    await settle();
    h.controller.feedTransportState("error"); // 벌점 → 2초 대기
    await settle();
    h.advance(2000);
    await settle();
    assert.equal(h.calls, 2);
    assert.equal(h.last().state, "connected");

    h.advance(30000); // 30초 이상 안정 → 벌점 초기화
    await settle();
    h.controller.feedTransportState("error");
    await settle();
    assert.equal(h.calls, 3); // 대기 없이 곧바로 시도
    assert.equal(h.last().state, "connected");
  });
});

describe("createReconnectController 깨우기 간격과 로그", () => {
  test("첫 깨우기 신호는 삼켜지지 않는다", async () => {
    // 시계가 0 에서 시작하므로 마지막 깨우기 시각을 0 으로 두면 첫 신호가 간격에 걸려 버린다.
    const h = makeHarness();
    h.wake();
    await settle();
    assert.equal(h.calls, 1);
  });

  test("짧은 간격에 몰려 온 신호는 한 번으로 합쳐진다", async () => {
    const h = makeHarness();
    h.healthy = false; // connected 조기 반환을 피해 간격만 시험한다
    h.wake();
    await settle();
    h.advance(500); h.wake();
    h.advance(500); h.wake();
    h.advance(500); h.wake();
    await settle();
    assert.equal(h.calls, 1, "알트탭 한 번에 focus/visibility/online 이 함께 온다");
    h.advance(1000); h.wake();
    await settle();
    assert.equal(h.calls, 2, "간격이 지나면 다시 시도한다");
  });

  test("사람이 누른 재시도는 간격을 무시한다", async () => {
    const h = makeHarness();
    h.wake();
    await settle();
    h.controller.retryNow();
    await settle();
    assert.equal(h.calls, 2);
  });

  test("시도 중에 들어온 재시도는 벌점을 깎지 않는다", async () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      let release;
      const h = makeHarness();
      h.impl = failing();
      h.controller.feedTransportState("error");
      await settle();
      assert.equal(h.controller.getState().attempt, 1);
      h.impl = () => new Promise((r) => (release = r));
      h.advance(2000);
      await settle(); // 두 번째 시도 진행 중
      h.controller.retryNow();
      assert.equal(h.controller.getState().attempt, 1, "시도도 못 걸면서 간격만 바닥으로 깎이면 안 된다");
      release();
      await settle();
    } finally {
      console.error = origErr;
    }
  });

  test("연속 실패는 로그를 한 번만 남긴다", async () => {
    const origErr = console.error;
    let logged = 0;
    console.error = () => logged++;
    try {
      const h = makeHarness();
      h.impl = failing();
      h.controller.feedTransportState("error");
      await settle();
      h.advance(2000); await settle();
      h.advance(5000); await settle();
      assert.equal(h.calls, 3);
      assert.equal(logged, 1, "30초마다 같은 줄이 영원히 쌓이면 진짜 문제를 못 찾는다");
    } finally {
      console.error = origErr;
    }
  });

  test("성공하면 로그 억제가 풀린다", async () => {
    const origErr = console.error;
    let logged = 0;
    console.error = () => logged++;
    try {
      const h = makeHarness();
      h.impl = failing();
      h.controller.feedTransportState("error");
      await settle();
      assert.equal(logged, 1);
      h.impl = async () => {};
      h.advance(2000); await settle(); // 성공 → 억제 해제
      h.impl = failing();
      h.controller.feedTransportState("error"); // 붙자마자 끊김이라 벌점이 더 붙는다
      await settle();
      h.advance(6000); await settle(); // 대기 만료 → 실제 시도 → 실패
      assert.equal(logged, 2, "새 장애는 다시 한 번 남아야 한다");
    } finally {
      console.error = origErr;
    }
  });
});

describe("createReconnectController 워치독", () => {
  test("켜기 전에는 어떤 신호에도 반응하지 않는다", async () => {
    const h = makeHarness({ noStart: true });
    h.controller.feedTransportState("error");
    h.controller.retryNow();
    h.controller.forceRetry();
    await settle();
    assert.equal(h.calls, 0);
  });

  test("깨우기 신호가 없어도 좀비 채널을 잡아낸다", async () => {
    const h = makeHarness();
    h.controller.feedTransportState("connected");
    await settle();
    h.healthy = false;
    for (let i = 0; i < 8; i++) { h.advance(1000); await settle(); }
    assert.ok(h.calls >= 1, "창이 계속 앞에 있으면 포커스 신호가 영영 안 온다");
  });

  test("좀비가 계속돼도 재연결이 폭주하지 않는다", async () => {
    const h = makeHarness();
    h.controller.feedTransportState("connected");
    await settle();
    h.healthy = false;
    for (let i = 0; i < 40; i++) { h.advance(1000); await settle(); }
    assert.ok(h.calls <= 5, `40초 동안 ${h.calls}회 — 매초 달라붙으면 안 된다`);
    assert.ok(h.controller.getState().attempt > 0, "반복되면 간격이 벌어져야 한다");
  });

  test("첫 연결이 잠기면 제한 시간 뒤에 끊고 다시 시도한다", async () => {
    const h = makeHarness();
    for (let i = 0; i < 19; i++) { h.advance(1000); await settle(); }
    assert.equal(h.calls, 0, "아직은 기다린다");
    for (let i = 0; i < 3; i++) { h.advance(1000); await settle(); }
    assert.equal(h.calls, 1);
  });
});
