# 채팅 연결 자동 복구 + 복구 상태 표시 구현 계획

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 창을 최소화했거나 오래 방치해 채팅 연결이 끊겼을 때 앱이 스스로 다시 붙고, 그 과정을 사용자가 눈으로 볼 수 있게 한다.

**Architecture:** 재연결 규칙(언제 시도할지·얼마나 기다릴지·어떤 상태인지)을 담은 작은 감독자 모듈 하나를 만들고, 방 채널과 전역 알림 채널이 그것을 공유한다. 죽은 채널은 되살릴 수 없으므로 복구는 "기존 채널 버리고 새 채널로 구독"이다. 화면은 감독자가 방송하는 상태 4가지(`connecting / connected / recovering / waiting`)만 보고 그린다.

**Tech Stack:** 바닐라 ES 모듈(빌드 단계 없음), Supabase Realtime(`src/vendor/supabase.js`), `node:test` 단위 테스트, Tauri 2.

**작업 공간:** 격리된 워크트리 + 전용 브랜치 `feature/chat-reconnect` (Task 0). `main` 은 건드리지 않는다.

---

## Context — 왜 이 작업을 하는가

지금은 방 화면이 뜰 때 `transport.connect()`를 **한 번** 부르는 게 전부다(`src/views/room-view.js:450`). 그 뒤 연결이 끊기면 앱은 아무것도 하지 않고 Supabase 라이브러리의 내부 재시도에만 의존한다. 그 내부 재시도는 다음 경우에 끝까지 회복하지 못한다:

1. **채널이 `CLOSED`가 되면 되살아날 길이 없다.** 채널이 닫히면 스스로 소켓 목록에서 빠진다(`src/vendor/supabase.js:6074-6078`, `this.socket.remove(this)`). 나중에 소켓이 다시 열려도 재가입 대상이 아니다.
2. **창이 숨겨진 동안엔 소켓이 재접속을 포기한다.** `src/vendor/supabase.js:7034` — "Not reconnecting as page is hidden!" 하고 정리만 하고 재예약 없이 끝난다. 되살리는 건 라이브러리의 `visibilitychange` 핸들러(`:6991`)뿐인데, WebView가 최소화/복원에서 그 신호를 항상 주지는 않는다.
3. **채널 재가입은 소켓이 살아 있을 때만 예약된다**(`:6069`, `:6087`). 소켓이 죽은 순간에 난 채널 에러는 재시도 예약 자체가 안 걸린다.
4. **토큰 만료 레이스** — 오래 자고 나면 로그인 토큰이 만료돼 있고 자동 갱신도 멈춰 있다. 깨어난 직후 옛 토큰으로 재가입하면 `CHANNEL_ERROR`가 난다.
5. **배지·펫 알림용 전역 채널**(`src/chat/message-notifier.js:128`)은 상태 표시도 복구 로직도 없다. 조용히 죽으면 도크 배지·로비 초록 점·펫 반응이 전부 멈추는데 알 방법이 없다.

표시 쪽도 문제다. `error`/`offline`은 "끝났다"처럼 보이는데 실제로는 뒤에서 재시도 중일 수 있어 구분이 안 되고(`src/views/room/header.js:8`), 사용자가 직접 다시 시도할 방법은 방을 나갔다 들어오는 것뿐이다.

**결과적으로 얻는 것:** 앱을 다시 앞으로 가져오면 몇 초 안에 스스로 복구되고, 복구 중이면 그렇다고 보이고, 급하면 눌러서 즉시 시도할 수 있다.

---

## Global Constraints

- 프론트엔드는 **빌드 단계가 없다.** 새 의존성 추가 금지, ES 모듈만 사용, `src/` 파일이 그대로 서빙된다.
- **코드 주석은 한국어.** 기본은 주석 없음 — 코드 흐름만으로 파악하기 어려운 예외("왜")에만 짧게.
- 테스트 가능한 로직은 **협력자 주입(DI) factory**로 만들고, 실제 모듈로 배선한 기본 export를 함께 둔다(`makeChangeRoomNickname`/`makeMessageNotifier` 패턴).
- 새 단위 테스트 파일은 **반드시 `package.json`의 `scripts.test` 목록에 추가**한다. 목록에 없으면 CI에서 안 돌아간다.
- 뷰는 `unmount()`에서 구독·타이머를 반드시 정리한다(누수 방지 계약, `src/CLAUDE.md`).
- 사용자 입력은 `el()`의 `text`로만 넣는다(`innerHTML` 금지).
- 재연결은 **기존 채널 제거 → 새 채널 생성 → 구독** 순서다. 이미 죽은 채널을 다시 구독하려는 시도는 하지 않는다.
- 재시도 간격: `[0, 2000, 5000, 10000, 30000]`ms — 마지막 값(30초)에서 멈춘다. 성공하면 0번부터 다시.
- 재연결이 배지·안 읽음 카운터를 **지워서는 안 된다**(현재 `stop()`이 `clearAll()`을 부른다 — 그래서 분리가 필요하다).
- 모든 작업은 워크트리 안 `feature/chat-reconnect` 브랜치에서 한다. **이 계획의 승인이 각 작업 끝의 커밋 승인을 겸한다**(사용자 확인). 단 **push 와 PR 생성은 별도 승인**을 받는다 — 계획대로 다 끝난 뒤 초안을 보여 주고 기다린다.

---

## File Structure

**새로 만드는 파일**

| 파일 | 책임 |
|---|---|
| `src/chat/channel-subscribe.js` | `channel.subscribe()`를 Promise로 감싸고 라이브러리 상태 문자열을 앱 상태로 매핑 |
| `src/chat/channel-subscribe.test.js` | 위 래퍼 테스트 |
| `src/chat/reconnect-controller.js` | 재연결 감독자(언제 시도·얼마나 대기·현재 상태) |
| `src/chat/reconnect-controller.test.js` | 감독자 테스트(가짜 타이머) |
| `src/chat/notifier-connection.js` | 전역 알림 채널의 감독자 배선 + 상태 방송 |
| `src/chat/notifier-connection.test.js` | 위 배선 테스트 |
| `src/views/conn-status.js` | 상태 → 화면 문구(순수 함수) + 상태 DOM 렌더 |
| `src/views/conn-status.test.js` | 문구 테스트(순수, jsdom 불필요) |

**고치는 파일**

| 파일 | 무엇을 |
|---|---|
| `src/auth/auth.js` | `ensureFreshSession()` 추가(재연결 직전 토큰 갱신) |
| `src/chat/supabase-transport.js` | `reconnect()`·`isHealthy()` 추가, 늦은 콜백 차단 가드 |
| `src/chat/backfill.js` | 성공/실패를 boolean으로 반환(좀비 감지 신호) |
| `src/chat/message-notifier.js` | 채널 정리와 카운터 정리 분리, `reconnect()`·`isHealthy()`·`onStatus()` 추가 |
| `src/views/room-view.js` | 감독자 배선, 상태 클릭 재시도, backfill 실패 신고 |
| `src/views/room/header.js` | 상태를 버튼으로, 낡은 `STATUS_TEXT` 제거 |
| `src/views/lobby-view.js` | 전역 채널 상태 줄 |
| `src/main.js` | 알림 채널 시작/정지를 `notifier-connection` 경유로 |
| `src/styles.css` | 점 애니메이션 + 상태 버튼/로비 상태 줄 스타일 |
| `package.json` | 새 테스트 4개 등록 |
| `src/CLAUDE.md` | 재연결 구조 한 단락 |

---

### Task 0: 워크트리 + 브랜치 준비

**Files:** 없음(작업 공간 준비)

**Interfaces:**
- Consumes: 없음
- Produces: `feature/chat-reconnect` 브랜치가 걸린 격리 워크트리, 의존성 설치 완료, 통과하는 기준선(baseline)

- [ ] **Step 1: 워크트리 생성**

`EnterWorktree` 도구를 `name: "feature/chat-reconnect"` 로 호출한다. **`git worktree add` 를 직접 쓰지 않는다** — 이 도구가 위치·브랜치·정리를 함께 관리하므로 수동으로 만들면 세션이 추적하지 못하는 상태가 생긴다. 기본 base 는 `origin/main` 이다.

- [ ] **Step 2: 의존성 설치**

워크트리에는 `node_modules` 가 없다(디렉터리별로 따로 설치된다).

Run: `npm install`
Expected: 설치 완료. 끝난 뒤 `ls -d node_modules/jsdom` 로 jsdom 이 있는지 확인한다 — 없으면 `npm install --no-save jsdom` 로 채운다(이 저장소에서 예전에 부분 설치로 빠진 적이 있다).

- [ ] **Step 3: 기준선 확인**

Run: `npm test`
Expected: 전부 통과. 여기서 실패가 있으면 **멈추고 보고한다** — 기준선이 더러우면 이후 실패가 내 변경 탓인지 알 수 없다.

커밋할 것 없음(작업 공간 준비만).

---

### Task 1: 채널 구독 → Promise 래퍼

**Files:**
- Create: `src/chat/channel-subscribe.js`
- Test: `src/chat/channel-subscribe.test.js`
- Modify: `package.json:8` (test 목록)

**Interfaces:**
- Consumes: 없음
- Produces:
  - `CHANNEL_STATUS_MAP` — `{ SUBSCRIBED:"connected", CHANNEL_ERROR:"error", TIMED_OUT:"reconnecting", CLOSED:"closed" }`
  - `SUBSCRIBE_TIMEOUT_MS = 15000`
  - `subscribeChannel(channel, onStatus, { timeoutMs, setTimer, clearTimer }) => Promise<void>` — `SUBSCRIBED`면 resolve, `CHANNEL_ERROR`/`TIMED_OUT`이면 reject. 그 뒤에 오는 상태도 `onStatus`로 계속 흘려보낸다. **아무 상태도 안 오면 제한 시간 뒤 reject** — 여기서 영원히 매달리면 감독자의 `inFlight` 가 풀리지 않아 복구가 통째로 멈춘다(이 작업이 고치려는 것과 똑같은 증상).

- [ ] **Step 1: 실패하는 테스트 작성**

`src/chat/channel-subscribe.test.js`:

```js
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
    subscribeChannel(ch, (s) => seen.push(s));
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test src/chat/channel-subscribe.test.js`
Expected: FAIL — `Cannot find module './channel-subscribe.js'`

- [ ] **Step 3: 구현**

`src/chat/channel-subscribe.js`:

```js
// Supabase 채널 구독을 Promise 로 감싼다. 첫 결과(SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT)로 확정되고,
// 그 뒤에 오는 상태 변화도 onStatus 로 계속 흘려보낸다 — 끊김·복구 표시가 이 신호를 먹고 산다.
export const CHANNEL_STATUS_MAP = {
  SUBSCRIBED: "connected",
  CHANNEL_ERROR: "error",
  TIMED_OUT: "reconnecting",
  CLOSED: "closed",
};

export const SUBSCRIBE_TIMEOUT_MS = 15000;

export function subscribeChannel(
  channel,
  onStatus = () => {},
  { timeoutMs = SUBSCRIBE_TIMEOUT_MS, setTimer = setTimeout, clearTimer = clearTimeout } = {},
) {
  return new Promise((resolve, reject) => {
    let settled = false;
    // 라이브러리가 아무 상태도 안 알려준 채 잠기는 경우가 있다. 여기서 매달리면 재연결 감독자가
    // 영원히 "시도 중"으로 굳어 버리므로 시간을 끊고 실패로 넘긴다.
    const timer = setTimer(() => {
      if (settled) return;
      settled = true;
      reject(new Error("subscribe timeout"));
    }, timeoutMs);
    channel.subscribe((status) => {
      onStatus(CHANNEL_STATUS_MAP[status] || "connecting");
      if (settled) return;
      if (status === "SUBSCRIBED") {
        settled = true;
        clearTimer(timer);
        resolve();
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        settled = true;
        clearTimer(timer);
        reject(new Error(`subscribe failed: ${status}`));
      }
    });
  });
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test src/chat/channel-subscribe.test.js`
Expected: PASS (5 tests)

- [ ] **Step 5: 테스트 목록 등록**

`package.json:8`의 `"test"` 값에서 `src/chat/backfill.test.js` 바로 앞에 `src/chat/channel-subscribe.test.js `를 끼워 넣는다.

Run: `npm test`
Expected: 전부 통과. (jsdom이 없어 DOM 테스트가 실패하면 `npm install`을 먼저 돌린다 — `jsdom`은 devDependencies에 이미 있다.)

- [ ] **Step 6: 커밋**

```bash
git add src/chat/channel-subscribe.js src/chat/channel-subscribe.test.js package.json
git commit -m "feat: 채널 구독을 Promise 로 감싸는 공용 래퍼 추가"
```

---

### Task 2: 재연결 감독자

**Files:**
- Create: `src/chat/reconnect-controller.js`
- Test: `src/chat/reconnect-controller.test.js`
- Modify: `package.json:8`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `RETRY_DELAYS_MS = [0, 2000, 5000, 10000, 30000]`
  - `defaultBindWake(onWake) => unbind` — 창 포커스/보이기/네트워크 복구 신호를 모아 준다
  - `createReconnectController({ reconnect, isHealthy, onState, bindWake, now, setTimer, clearTimer })` →
    `{ start(), stop(), onTransportState(state), retryNow(), reportUnhealthy(), getState() }`
  - 방송되는 상태 모양: `{ state: "connecting"|"connected"|"recovering"|"waiting", attempt: number, retryInSec: number }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/chat/reconnect-controller.test.js`:

```js
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
    now: () => time,
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

// 실패하는 재연결(에러 로그는 테스트 출력에서 지운다).
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test src/chat/reconnect-controller.test.js`
Expected: FAIL — `Cannot find module './reconnect-controller.js'`

- [ ] **Step 3: 구현**

`src/chat/reconnect-controller.js`:

```js
// 실시간 채널 연결 감독자. 끊긴 채널을 다시 붙이고, 그 과정을 화면이 그릴 수 있는 상태로 방송한다.
// 방 채널(room-view)과 전역 알림 채널(notifier-connection)이 이 규칙을 공유한다.
//
// 상태: connecting(첫 연결) | connected | recovering(붙이는 중) | waiting(다음 시도 대기)
// 앱이 앞으로 돌아오거나 네트워크가 복구되면 대기를 건너뛰고 즉시 시도한다(간격도 처음으로 되돌림).

export const RETRY_DELAYS_MS = [0, 2000, 5000, 10000, 30000];
const TICK_MS = 1000;
// 붙자마자 끊기는(flap) 상황을 가려내는 기준. 이만큼 버틴 연결은 "정상이었다"로 보고 벌점을 씻는다.
const STABLE_MS = 30000;

// 창이 앞으로 오거나 네트워크가 돌아오는 신호. 플랫폼마다 빠지는 신호가 있어 넷 다 듣는다
// (Tauri 최소화 복원에서 DOM focus/visibilitychange 가 안 오는 경우가 있다).
export function defaultBindWake(onWake) {
  const onVisible = () => {
    if (document.visibilityState === "visible") onWake();
  };
  window.addEventListener("focus", onWake);
  window.addEventListener("online", onWake);
  document.addEventListener("visibilitychange", onVisible);
  let unlistenTauri = null;
  const tauriWin = window.__TAURI__?.window?.getCurrentWindow?.();
  tauriWin
    ?.onFocusChanged?.(({ payload }) => {
      if (payload) onWake();
    })
    .then((un) => {
      unlistenTauri = un;
    })
    .catch(() => {});
  return () => {
    window.removeEventListener("focus", onWake);
    window.removeEventListener("online", onWake);
    document.removeEventListener("visibilitychange", onVisible);
    try {
      unlistenTauri?.();
    } catch (e) {
      console.error("unlisten focus failed:", e);
    }
  };
}

export function createReconnectController({
  reconnect,
  isHealthy = () => true,
  onState = () => {},
  bindWake = defaultBindWake,
  now = () => Date.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  let state = "connecting";
  let attempt = 0; // 벌점 = 다음 대기 간격의 인덱스
  let nextAttemptAt = null;
  let connectedAt = null; // 이번 연결이 언제 붙었는지(flap 판별용)
  let inFlight = false;
  let gen = 0; // stop() 뒤에 도착하는 늦은 결과를 무시하기 위한 세대 번호
  let timerId = null;
  let unbindWake = null;
  let last = null;

  function snapshot() {
    const retryInSec =
      state === "waiting" && nextAttemptAt != null
        ? Math.max(0, Math.ceil((nextAttemptAt - now()) / 1000))
        : 0;
    return { state, attempt, retryInSec };
  }

  function emit() {
    const s = snapshot();
    if (last && last.state === s.state && last.attempt === s.attempt && last.retryInSec === s.retryInSec) return;
    last = s;
    onState(s);
  }

  function arm() {
    clearTimer(timerId);
    timerId = setTimer(tick, TICK_MS);
  }

  function tick() {
    // 한동안 멀쩡히 붙어 있었으면 그동안 쌓인 벌점을 씻는다 → 다음 끊김은 다시 즉시 시도.
    if (state === "connected" && attempt > 0 && connectedAt != null && now() - connectedAt >= STABLE_MS) {
      attempt = 0;
    }
    if (state === "waiting" && nextAttemptAt != null && now() >= nextAttemptAt) attemptNow();
    else emit();
    arm();
  }

  function penalize() {
    attempt = Math.min(attempt + 1, RETRY_DELAYS_MS.length - 1);
  }

  // 현재 벌점에 해당하는 간격만큼 기다렸다 시도한다. 간격이 0이면 곧바로.
  function scheduleRetry() {
    if (inFlight) return;
    const delay = RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
    if (delay === 0) {
      attemptNow();
      return;
    }
    state = "waiting";
    nextAttemptAt = now() + delay;
    emit();
  }

  async function attemptNow() {
    if (inFlight) return;
    inFlight = true;
    const myGen = gen;
    state = "recovering";
    nextAttemptAt = null;
    emit();
    try {
      await reconnect();
      if (myGen !== gen) return;
      state = "connected";
      connectedAt = now();
    } catch (e) {
      console.error("reconnect failed:", e);
      if (myGen !== gen) return;
      penalize();
      state = "waiting";
      nextAttemptAt = now() + RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
    } finally {
      if (myGen === gen) {
        inFlight = false;
        emit();
      }
    }
  }

  // 사용자·OS 신호로 시작되는 재시도 — 벌점을 씻고 곧바로 시도한다.
  function requestRetry() {
    attempt = 0;
    connectedAt = null;
    scheduleRetry();
  }

  function onWake() {
    if (state === "connected" && isHealthy()) return;
    requestRetry();
  }

  // transport 가 알려주는 원시 상태를 먹인다.
  function onTransportState(next) {
    if (next === "connected") {
      if (state !== "connected") connectedAt = now();
      nextAttemptAt = null;
      state = "connected";
      emit();
      return;
    }
    if (next === "connecting") {
      if (state !== "recovering") {
        state = "connecting";
        emit();
      }
      return;
    }
    // error | closed | reconnecting — 이미 시도 중이거나 대기 중이면 그 일정을 존중한다.
    if (state !== "connected" && state !== "connecting") return;
    // 붙자마자 끊긴 경우엔 벌점을 매겨 간격을 벌린다(무한 재시도 방지).
    if (connectedAt != null && now() - connectedAt < STABLE_MS) penalize();
    connectedAt = null;
    scheduleRetry();
  }

  function start() {
    unbindWake = bindWake(onWake);
    arm();
    emit();
  }

  function stop() {
    gen++;
    inFlight = false;
    clearTimer(timerId);
    timerId = null;
    try {
      unbindWake?.();
    } catch (e) {
      console.error("unbind wake failed:", e);
    }
    unbindWake = null;
  }

  return { start, stop, onTransportState, retryNow: onWake, reportUnhealthy: requestRetry, getState: snapshot };
}
```

- [ ] **Step 4: 통과 확인**

Run: `node --test src/chat/reconnect-controller.test.js`
Expected: PASS (10 tests)

- [ ] **Step 5: 테스트 목록 등록 + 전체 실행**

`package.json:8`의 `"test"` 목록에 `src/chat/reconnect-controller.test.js `를 추가한다.

Run: `npm test`
Expected: 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add src/chat/reconnect-controller.js src/chat/reconnect-controller.test.js package.json
git commit -m "feat: 실시간 채널 재연결 감독자 추가"
```

---

### Task 3: transport 재연결 + 건강 확인

**Files:**
- Modify: `src/auth/auth.js` (`ensureFreshSession` 추가)
- Modify: `src/chat/supabase-transport.js` (전체 재작성 수준의 수정)
- Modify: `src/chat/transport.js:1-20` (계약 주석에 `reconnect`/`isHealthy` 추가)

**Interfaces:**
- Consumes: `subscribeChannel` (Task 1)
- Produces:
  - `ensureFreshSession() => Promise<void>` — 만료된 토큰이면 갱신하고, 실패는 흡수한다
  - `transport.reconnect() => Promise<void>` — 옛 채널 버리고 새 채널로 다시 구독. 실패하면 reject.
  - `transport.isHealthy() => boolean` — 채널이 실제로 `joined` 인지

**왜 `ensureFreshSession` 이 필요한가:** 오래 자고 나면 로그인 토큰이 만료돼 있고 자동 갱신도 멈춰 있다. 그 상태로 채널에 붙으면 서버가 거절해 `CHANNEL_ERROR` 가 난다(Context 의 실패 원인 4번). `client.auth.getSession()` 은 만료된 세션이면 내부에서 갱신을 돌리므로(`src/vendor/supabase.js:17399-17419`), 재연결 직전에 한 번 불러 주면 이 원인을 없앨 수 있다.

이 계층은 Supabase 클라이언트를 직접 import 하므로(`getClient`) 기존에도 단위 테스트가 없다. 여기서도 테스트를 새로 만들지 않고 **Task 10의 손 확인 절차**로 검증한다. 대신 로직은 최대한 얇게 유지한다.

- [ ] **Step 1: 세션 갱신 헬퍼 추가**

`src/auth/auth.js` 의 `getSession` 함수 바로 아래에 추가:

```js
// 재연결 직전에 토큰을 한 번 확인한다 — 만료된 토큰으로 붙으면 채널이 거절당한다.
// getSession 은 만료된 세션이면 내부에서 갱신을 돌린다. 실패는 흡수: 그래도 붙어 보고,
// 안 되면 재시도 루프가 다시 온다.
export async function ensureFreshSession() {
  try {
    await getSession();
  } catch (e) {
    console.error("session refresh failed:", e);
  }
}
```

- [ ] **Step 2: 구현**

`src/chat/supabase-transport.js` 를 아래로 교체한다(주석 유지, 변경점은 ①구독을 공용 래퍼로 ②`reconnect`/`isHealthy` 추가 ③세대 가드 ④presence 핸들러가 자기 채널을 붙잡도록 ⑤재연결 전 토큰 확인):

```js
// Supabase Realtime postgres_changes 기반 ChatTransport 구현.
// 한 채널 `room:<code>` 에서 presence(온라인 인원) + postgres_changes(messages 테이블 INSERT)를
// 함께 구독한다. 송신은 DB INSERT 한 번 — postgres_changes echo가 자기 자신에게도 돌아온다.
// 중복은 message-store의 id dedup으로 처리.
import { getClient, ensureFreshSession } from "../auth/auth.js";
import { insertMessage } from "./message-history.js";
import { rowToMsg } from "./supabase-mapper.js";
import { subscribeChannel } from "./channel-subscribe.js";

export function createSupabaseTransport() {
  let client = null;
  let channel = null;
  let currentCode = null;
  let lastArgs = null; // reconnect 가 같은 방·같은 신원으로 다시 붙기 위해 보관
  let gen = 0; // 버려진 채널의 늦은 콜백이 상태를 되돌리지 못하게 한다
  const handlers = { message: new Set(), status: new Set(), presence: new Set() };

  function on(event, handler) {
    const set = handlers[event];
    if (!set) throw new Error(`unknown event: ${event}`);
    set.add(handler);
    return () => set.delete(handler);
  }

  function emit(event, payload) {
    for (const h of handlers[event]) h(payload);
  }

  async function connect(roomCode, who) {
    const myGen = ++gen;
    lastArgs = { roomCode, who };
    emit("status", { state: "connecting" });
    client = await getClient();
    currentCode = roomCode;
    const ch = client.channel(`room:${roomCode}`, {
      config: { presence: { key: who.clientId } },
    });
    channel = ch;

    ch.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `room_code=eq.${roomCode}` },
      (payload) => {
        if (myGen !== gen) return;
        emit("message", rowToMsg(payload.new));
      },
    );
    // presenceState 는 이 채널의 것을 읽는다 — 재연결 도중 새 채널의 값을 잘못 읽지 않도록.
    ch.on("presence", { event: "sync" }, () => {
      if (myGen !== gen) return;
      const state = ch.presenceState();
      emit("presence", { count: Object.keys(state).length, members: state });
    });

    await subscribeChannel(ch, (state) => {
      if (myGen !== gen) return;
      emit("status", { state });
      if (state === "connected") ch.track({ nickname: who.nickname });
    });
  }

  // 죽은 채널은 되살릴 수 없다(라이브러리가 소켓 목록에서 빼 버린다) → 새 채널로 다시 붙는다.
  // 옛 채널 제거는 기다리지 않는다 — 서버 응답이 없을 때 최대 10초까지 붙잡히기 때문.
  // 세대 가드가 옛 채널의 늦은 이벤트를 막고, 같은 topic 의 새 채널이 join 하면 라이브러리가
  // 남은 옛 채널을 알아서 정리한다(vendor `leaveOpenTopic`, supabase.js:6305).
  async function reconnect() {
    if (!lastArgs) throw new Error("not connected");
    const dying = channel;
    gen++;
    channel = null;
    if (dying && client) {
      Promise.resolve(client.removeChannel(dying)).catch((e) => console.error("removeChannel failed:", e));
    }
    await ensureFreshSession();
    await connect(lastArgs.roomCode, lastArgs.who);
  }

  // 라이브러리 상태 콜백이 오지 않은 채 죽은 경우(좀비)를 가려낸다.
  function isHealthy() {
    return !!channel && channel.state === "joined";
  }

  // DB INSERT 하나로 끝. postgres_changes 가 모든 구독자(본인 포함)에게 메시지를 전달.
  async function send(message) {
    if (!currentCode) throw new Error("not connected");
    await insertMessage(message, currentCode);
  }

  async function leave() {
    gen++;
    if (channel && client) {
      await client.removeChannel(channel);
    }
    channel = null;
    currentCode = null;
    lastArgs = null;
  }

  // presence payload 갱신. 닉네임 변경 시 호출 → 다른 멤버의 presence sync 가
  // 새 nickname 으로 즉시 갱신된다. 채널 미연결 상태에서는 no-op.
  function track(payload) {
    if (!channel) return;
    try {
      channel.track(payload);
    } catch (e) {
      console.error("track failed:", e);
    }
  }

  return { connect, reconnect, send, leave, on, track, isHealthy };
}
```

- [ ] **Step 3: 계약 주석 갱신**

`src/chat/transport.js` 의 주석 블록에서 `connect` 줄 아래에 두 줄을 추가한다:

```js
//   reconnect() -> Promise                                  // 옛 채널 버리고 새 채널로 재구독
//   isHealthy() -> boolean                                   // 채널이 실제로 살아 있는지(좀비 판별)
```

- [ ] **Step 4: 기존 테스트가 안 깨졌는지 확인**

Run: `npm test`
Expected: 전부 통과(이 파일을 직접 테스트하는 파일은 없지만 import 사슬이 깨지지 않았는지 본다)

- [ ] **Step 5: 커밋**

```bash
git add src/auth/auth.js src/chat/supabase-transport.js src/chat/transport.js
git commit -m "feat: transport 에 재연결·건강 확인 추가"
```

---

### Task 4: backfill 이 성공 여부를 알려주게

**Files:**
- Modify: `src/chat/backfill.js:6-22`
- Test: `src/chat/backfill.test.js` (테스트 추가)

**Interfaces:**
- Consumes: 없음
- Produces: `backfill() => Promise<boolean>` — 성공 `true`, 실패 `false`. 이미 진행 중이라 건너뛴 경우도 `true`(실패 신호가 아니므로).

- [ ] **Step 1: 실패하는 테스트 추가**

`src/chat/backfill.test.js` 의 `describe` 블록 끝에 추가:

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test src/chat/backfill.test.js`
Expected: FAIL — `undefined !== false`

- [ ] **Step 3: 구현**

`src/chat/backfill.js` 의 반환 함수를 아래로 바꾼다(주석 첫 줄에 반환값 설명 한 줄 추가):

```js
  // 반환값은 "이번 보충이 성공했는지" — 실패는 연결이 실제로 죽었다는 신호로 쓰인다.
  return async function backfill() {
    if (inFlight) return true;
    inFlight = true;
    try {
      const cur = store.get();
      const sinceTs = cur.length ? cur[cur.length - 1].ts : firstJoinedAt;
      const fresh = await fetchMessages(code, sinceTs);
      for (const m of fresh) store.add(m);
      return true;
    } catch (e) {
      console.error("backfill failed:", e);
      return false;
    } finally {
      inFlight = false;
    }
  };
```

- [ ] **Step 4: 통과 확인**

Run: `node --test src/chat/backfill.test.js`
Expected: PASS (7 tests)

- [ ] **Step 5: 커밋**

```bash
git add src/chat/backfill.js src/chat/backfill.test.js
git commit -m "feat: backfill 이 성공 여부를 반환"
```

---

### Task 5: 알림 채널에 재연결 붙이기 (카운터는 보존)

**Files:**
- Modify: `src/chat/message-notifier.js:128-177`
- Test: `src/chat/message-notifier.test.js` (가짜 클라이언트 수정 + 테스트 추가)

**Interfaces:**
- Consumes: `subscribeChannel` (Task 1)
- Produces:
  - `notifier.reconnect() => Promise<void>` — 채널만 새로 붙인다. **안 읽음 카운터를 지우지 않는다.** 실패하면 reject.
  - `notifier.isHealthy() => boolean`
  - `notifier.onStatus(cb) => unsubscribe` — `"connected"|"error"|"reconnecting"|"closed"|"connecting"`
  - 기존 `start(userId)` / `stop()` 동작은 그대로(단 `start` 는 이제 userId 를 기억한다)

**주의:** 기존 테스트의 가짜 채널은 `async subscribe() { return "SUBSCRIBED" }` 라 콜백을 부르지 않는다. 구독이 Promise 로 바뀌면 그 자리에서 멈춰 버리므로 **가짜를 먼저 고쳐야 한다.**

- [ ] **Step 1: 가짜 클라이언트 수정 + 실패하는 테스트 추가**

`src/chat/message-notifier.test.js:18-36` 의 `makeFakeClient` 를 교체:

```js
// Supabase client 모사: channel().on(...).subscribe(cb) 흐름에서 postgres_changes 핸들러를 붙잡아
// 테스트가 직접 INSERT 이벤트를 흘려보낼 수 있게 한다. subscribe 콜백으로 연결 상태도 흘린다.
function makeFakeClient() {
  const state = { handler: null, removed: 0, opened: 0, status: "SUBSCRIBED" };
  const channel = {
    state: "joined",
    on(_event, _opts, cb) {
      state.handler = cb;
      return channel;
    },
    subscribe(cb) {
      state.opened++;
      cb?.(state.status);
      return channel;
    },
  };
  return {
    state,
    channel: () => channel,
    async removeChannel() {
      state.removed++;
    },
  };
}
```

같은 파일 끝에 새 describe 블록 추가:

```js
describe("message-notifier 연결 복구", () => {
  test("reconnect 는 채널만 새로 붙이고 안 읽음 카운터는 유지한다", async () => {
    const { notifier, fc, lastBadge } = buildNotifier();
    await notifier.start("me-uid");
    fc.state.handler({ new: incomingRow() });
    assert.equal(lastBadge(), 1);

    await notifier.reconnect();
    assert.equal(fc.state.opened, 2); // 새 채널로 다시 구독
    assert.equal(lastBadge(), 1); // 배지는 그대로
  });

  test("reconnect 뒤에도 내 uid 기준 필터가 유지된다", async () => {
    const { notifier, fc, lastBadge } = buildNotifier();
    await notifier.start("me-uid");
    await notifier.reconnect();
    fc.state.handler({ new: incomingRow({ sender_uid: "me-uid" }) }); // 내 메시지 → 무시
    assert.equal(lastBadge(), undefined);
    fc.state.handler({ new: incomingRow() });
    assert.equal(lastBadge(), 1);
  });

  test("구독 실패는 reconnect 의 reject 로 전달된다", async () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      const { notifier, fc } = buildNotifier();
      await notifier.start("me-uid");
      fc.state.status = "CHANNEL_ERROR";
      await assert.rejects(notifier.reconnect());
    } finally {
      console.error = origErr;
    }
  });

  test("상태 구독자에게 연결 상태가 전달된다", async () => {
    const { notifier } = buildNotifier();
    const seen = [];
    notifier.onStatus((s) => seen.push(s));
    await notifier.start("me-uid");
    assert.deepEqual(seen, ["connected"]);
  });

  test("stop 은 카운터까지 정리한다", async () => {
    const { notifier, fc, lastBadge } = buildNotifier();
    await notifier.start("me-uid");
    fc.state.handler({ new: incomingRow() });
    await notifier.stop();
    assert.equal(lastBadge(), 0);
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test src/chat/message-notifier.test.js`
Expected: FAIL — `notifier.reconnect is not a function`

- [ ] **Step 3: 구현**

`src/chat/message-notifier.js` 상단 import 에 추가(기존 `getClient` import 줄에 `ensureFreshSession` 을 함께 받는다):

```js
import { getClient, ensureFreshSession } from "../auth/auth.js";
import { subscribeChannel } from "./channel-subscribe.js";
```

**주의:** 이 파일은 `getClient` 를 DI 로도 받는다(`makeMessageNotifier({ getClient, ... })`). 모듈 상단 import 의 `getClient` 는 파일 맨 아래 기본 인스턴스 배선에서만 쓰이고, factory 안에서는 주입받은 것을 쓴다 — 그 구분을 깨지 않도록 `ensureFreshSession` 도 **factory 인자로 받는다**: 시그니처를 `makeMessageNotifier({ getClient, isAppFocused, setUnread, ensureFreshSession = async () => {} })` 로 바꾸고, 파일 맨 아래 기본 인스턴스에 `ensureFreshSession` 을 넘긴다. 테스트는 기본값(no-op)을 그대로 쓴다.

`makeMessageNotifier` 안의 상태 선언(`let starting = false;` 근처)에 추가:

```js
  let currentUserId = null;
  let status = "connecting";
  const statusSubs = new Set();
```

`start`/`stop` 구간(현재 `:128-177`)을 아래로 교체:

```js
  function setStatus(next) {
    if (status === next) return;
    status = next;
    for (const fn of statusSubs) {
      try { fn(status); } catch (e) { console.error("notifier status subscriber failed:", e); }
    }
  }

  // 상태 구독. unsubscribe 를 돌려준다.
  function onStatus(cb) {
    statusSubs.add(cb);
    return () => statusSubs.delete(cb);
  }

  function getStatus() {
    return status;
  }

  // 라이브러리가 상태를 안 알려준 채 죽은 경우를 가려낸다.
  function isHealthy() {
    return !!channel && channel.state === "joined";
  }

  // 채널만 연다. 실패는 호출 측으로 전달 — reconnect 가 재시도 판단에 쓴다.
  async function openChannel() {
    client = await getClient();
    const ch = client
      .channel("notify:messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => handleInsert(currentUserId, payload.new),
      );
    channel = ch;
    await subscribeChannel(ch, setStatus);
  }

  async function start(userId) {
    // 이미 떠 있으면(또는 사용자 전환으로 재호출) 먼저 깨끗이 정리 → 이중 채널 방지.
    await stop();
    if (starting) return;
    starting = true;
    currentUserId = userId;
    try {
      await openChannel();
    } catch (e) {
      console.error("message notifier start failed:", e);
      await teardownChannel();
    } finally {
      starting = false;
    }
  }

  // 채널만 갈아 끼운다 — 안 읽음 카운터는 건드리지 않는다(재연결이 배지를 지우면 안 된다).
  // start 와 겹치면 실패로 알린다 — 조용히 통과시키면 감독자가 "붙었다"고 잘못 판단한다.
  async function reconnect() {
    if (!currentUserId) throw new Error("not started");
    if (starting) throw new Error("busy");
    starting = true;
    try {
      await teardownChannel();
      await ensureFreshSession();
      await openChannel();
    } finally {
      starting = false;
    }
  }

  function handleInsert(userId, row) {
    // (기존 본문 그대로)
  }

  // 채널만 정리. 카운터는 그대로 둔다.
  async function teardownChannel() {
    try {
      if (channel && client) await client.removeChannel(channel);
    } catch (e) {
      console.error("notifier removeChannel failed:", e);
    } finally {
      channel = null;
    }
  }

  async function stop() {
    await teardownChannel();
    currentUserId = null;
    setStatus("connecting");
    clearAll();
  }
```

반환 객체에 추가:

```js
    reconnect,
    isHealthy,
    onStatus,
    getStatus,
```

- [ ] **Step 4: 통과 확인**

Run: `node --test src/chat/message-notifier.test.js`
Expected: PASS (기존 테스트 + 새 5개)

- [ ] **Step 5: 커밋**

```bash
git add src/chat/message-notifier.js src/chat/message-notifier.test.js
git commit -m "feat: 알림 채널 재연결 지원, 채널 정리와 카운터 정리 분리"
```

---

### Task 6: 알림 채널 감독 배선

**Files:**
- Create: `src/chat/notifier-connection.js`
- Test: `src/chat/notifier-connection.test.js`
- Modify: `src/main.js:22,107,117,125`
- Modify: `package.json:8`

**Interfaces:**
- Consumes: `createReconnectController` (Task 2), `messageNotifier.{start,stop,reconnect,isHealthy,onStatus}` (Task 5)
- Produces (기본 export 인스턴스 `notifierConnection`):
  - `start(userId) => Promise<void>` / `stop() => Promise<void>`
  - `retryNow() => void`
  - `subscribe(cb) => unsubscribe` — `{ state, attempt, retryInSec }`
  - `getState() => { state, attempt, retryInSec }`

- [ ] **Step 1: 실패하는 테스트 작성**

`src/chat/notifier-connection.test.js`:

```js
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
```

- [ ] **Step 2: 실패 확인**

Run: `node --test src/chat/notifier-connection.test.js`
Expected: FAIL — `Cannot find module './notifier-connection.js'`

- [ ] **Step 3: 구현**

`src/chat/notifier-connection.js`:

```js
// 전역 알림 채널(message-notifier)의 연결 감독 + 상태 방송.
// main.js 가 로그인/로그아웃에 맞춰 start/stop, lobby 가 상태를 구독하고 재시도를 건다.
// notifier 자체는 타이머를 갖지 않는다 — 재시도 규칙은 전부 감독자 몫.
import { messageNotifier } from "./message-notifier.js";
import { createReconnectController } from "./reconnect-controller.js";

export function makeNotifierConnection({ notifier, createController }) {
  let controller = null;
  let unsubStatus = null;
  let state = { state: "connecting", attempt: 0, retryInSec: 0 };
  const subs = new Set();

  function emit() {
    for (const fn of subs) {
      try { fn(state); } catch (e) { console.error("notifier connection subscriber failed:", e); }
    }
  }

  async function start(userId) {
    await stop();
    controller = createController({
      reconnect: () => notifier.reconnect(),
      isHealthy: () => notifier.isHealthy(),
      onState: (s) => { state = s; emit(); },
    });
    unsubStatus = notifier.onStatus((s) => controller?.onTransportState(s));
    controller.start();
    await notifier.start(userId);
  }

  async function stop() {
    controller?.stop();
    controller = null;
    unsubStatus?.();
    unsubStatus = null;
    await notifier.stop();
  }

  function retryNow() {
    controller?.retryNow();
  }

  function subscribe(cb) {
    subs.add(cb);
    return () => subs.delete(cb);
  }

  return { start, stop, retryNow, subscribe, getState: () => state };
}

export const notifierConnection = makeNotifierConnection({
  notifier: messageNotifier,
  createController: createReconnectController,
});
```

- [ ] **Step 4: main.js 배선**

`src/main.js:22` 의 import 아래에 추가:

```js
import { notifierConnection } from "./chat/notifier-connection.js";
```

세 군데를 바꾼다:
- `:107` `if (session?.user?.id) messageNotifier.start(session.user.id);` → `if (session?.user?.id) notifierConnection.start(session.user.id);`
- `:117` `messageNotifier.stop(); // 알림 구독 정리` → `notifierConnection.stop(); // 알림 구독 + 감독자 정리`
- `:125` `if (session?.user?.id) messageNotifier.start(session.user.id);` → `if (session?.user?.id) notifierConnection.start(session.user.id);`

`messageNotifier` import(`:22`)는 다른 곳에서 안 쓰면 지운다(현재 main.js 에서는 start/stop 용도뿐이므로 제거).

- [ ] **Step 5: 통과 확인**

`package.json:8` 목록에 `src/chat/notifier-connection.test.js `를 추가한 뒤:

Run: `npm test`
Expected: 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add src/chat/notifier-connection.js src/chat/notifier-connection.test.js src/main.js package.json
git commit -m "feat: 전역 알림 채널에 연결 감독자 배선"
```

---

### Task 7: 상태 문구 + 렌더 + 스타일

**Files:**
- Create: `src/views/conn-status.js`
- Test: `src/views/conn-status.test.js`
- Modify: `src/styles.css:301-305`(position 예외 목록), `:562-574`(상태 스타일 + 에러 규칙 교체)
- Modify: `package.json:8`

**Interfaces:**
- Consumes: 없음
- Produces:
  - `connStatusLabel({ state, retryInSec, onlineCount }) => { text, dots, error, retry }`
  - `renderConnStatus(el, label)` — `el` 의 자식을 문구/점/`[↻]` 로 갈아 끼운다

- [ ] **Step 1: 실패하는 테스트 작성**

`src/views/conn-status.test.js`:

```js
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { connStatusLabel } from "./conn-status.js";

describe("connStatusLabel", () => {
  test("연결 상태 + 인원 수", () => {
    assert.deepEqual(connStatusLabel({ state: "connected", onlineCount: 3 }), {
      text: "● 3 online", dots: false, error: false, retry: false,
    });
  });

  test("인원 수를 모르면 숫자 없이", () => {
    assert.equal(connStatusLabel({ state: "connected", onlineCount: null }).text, "● online");
  });

  test("첫 연결 중에는 점이 흐른다", () => {
    const l = connStatusLabel({ state: "connecting" });
    assert.equal(l.text, "connecting");
    assert.equal(l.dots, true);
  });

  test("복구 중에는 reconnecting + 점", () => {
    const l = connStatusLabel({ state: "recovering" });
    assert.equal(l.text, "reconnecting");
    assert.equal(l.dots, true);
    assert.equal(l.error, false);
  });

  test("대기 중에는 남은 초와 재시도 표시", () => {
    assert.deepEqual(connStatusLabel({ state: "waiting", retryInSec: 5 }), {
      text: "offline · 5s", dots: false, error: true, retry: true,
    });
  });

  test("남은 초가 0이면 초 표기를 뺀다", () => {
    assert.equal(connStatusLabel({ state: "waiting", retryInSec: 0 }).text, "offline");
  });
});
```

- [ ] **Step 2: 실패 확인**

Run: `node --test src/views/conn-status.test.js`
Expected: FAIL — `Cannot find module './conn-status.js'`

- [ ] **Step 3: 구현**

`src/views/conn-status.js`:

```js
// 연결 상태(감독자 방송값) → 화면 문구. 방 헤더와 로비가 함께 쓴다.
// 문구 결정은 순수 함수로 떼어 두어 DOM 없이 테스트한다.
import { el } from "../core/dom.js";

export function connStatusLabel({ state, retryInSec = 0, onlineCount = null } = {}) {
  if (state === "connected") {
    return { text: onlineCount != null ? `● ${onlineCount} online` : "● online", dots: false, error: false, retry: false };
  }
  if (state === "connecting") return { text: "connecting", dots: true, error: false, retry: false };
  if (state === "recovering") return { text: "reconnecting", dots: true, error: false, retry: false };
  return {
    text: retryInSec > 0 ? `offline · ${retryInSec}s` : "offline",
    dots: false,
    error: true,
    retry: true,
  };
}

export function renderConnStatus(target, label) {
  const children = [label.text];
  if (label.dots) {
    for (let i = 0; i < 3; i++) children.push(el("span", { class: "conn-dot", text: "·" }));
  }
  if (label.retry) children.push(el("span", { class: "conn-retry", text: " [↻]" }));
  target.replaceChildren();
  for (const c of children) target.append(c.nodeType ? c : document.createTextNode(c));
  // 빨간 강조는 방 헤더와 로비가 함께 쓰는 클래스로 — 방 전용 이름(room-status--error)이면 로비에서 안 먹는다.
  target.classList.toggle("conn-error", label.error);
}
```

- [ ] **Step 4: 스타일 교체/추가**

(1) `src/styles.css:569-574` 의 방 전용 에러 규칙을 방·로비가 함께 쓰는 규칙으로 바꾼다. 기존:

```css
/* connState === "error" 일 때만 적용 — .msg.failed 와 톤 통일(#ff5a5a). */
.room-status.room-status--error {
  color: #ff5a5a;
  text-shadow: 0 0 4px rgba(255, 90, 90, 0.7);
  opacity: 1;
}
```

새 내용(에러 색 + 복구 중 점 애니메이션):

```css
/* 끊긴 상태 강조 — .msg.failed 와 톤 통일(#ff5a5a). 방 헤더·로비가 공유한다. */
.conn-error {
  color: #ff5a5a;
  text-shadow: 0 0 4px rgba(255, 90, 90, 0.7);
  opacity: 1;
}

/* 복구 중 점 3개가 차례로 밝아진다 — 뒤에서 뭔가 하고 있다는 신호. */
@keyframes conn-dot {
  0%, 60% { opacity: 0.2; }
  30% { opacity: 1; }
}

.conn-dot {
  animation: conn-dot 1.2s infinite;
}

.conn-dot:nth-of-type(2) { animation-delay: 0.2s; }
.conn-dot:nth-of-type(3) { animation-delay: 0.4s; }

.conn-retry {
  opacity: 0.9;
}
```

(2) `.room-copy, .room-leave, .room-send { position: static; }` (`:301-305`) 에 `.room-status` 를 추가한다 — 상태가 `<button class="btn room-status">` 가 되므로 `.btn` 의 `position: absolute` 를 덮어야 한다:

```css
.room-copy,
.room-leave,
.room-send,
.room-status {
  position: static;
}
```

(3) `.room-status` 규칙(`:562-567`)에 `padding: 0;` 을 한 줄 넣는다 — `.btn` 의 `padding: 0.2em 0.4em` 이 헤더 간격을 밀어내지 않도록. (글자 크기는 `.room-status` 가 `.btn` 보다 뒤에 있어 그대로 이긴다.)

- [ ] **Step 5: 통과 확인 + 목록 등록**

`package.json:8` 목록에 `src/views/conn-status.test.js `를 추가한 뒤:

Run: `npm test`
Expected: 전부 통과

- [ ] **Step 6: 커밋**

```bash
git add src/views/conn-status.js src/views/conn-status.test.js src/styles.css package.json
git commit -m "feat: 연결 상태 문구·렌더 공용화와 복구 중 점 애니메이션"
```

---

### Task 8: 방 화면에 감독자 붙이기

**Files:**
- Modify: `src/views/room/header.js` (상태를 버튼으로, `STATUS_TEXT` 제거)
- Modify: `src/views/room-view.js:13, 84-93, 137-139, 226-236, 321-345, 450-460, 462-480`

**Interfaces:**
- Consumes: `createReconnectController`(Task 2), `transport.reconnect/isHealthy`(Task 3), `backfill()` 반환값(Task 4), `connStatusLabel/renderConnStatus`(Task 7)
- Produces: 없음(화면 배선)

- [ ] **Step 1: 헤더에서 상태를 버튼으로**

`src/views/room/header.js` 의 `:6-14`(주석 2줄 + `STATUS_TEXT` export 전체)를 통째로 지운다 — 문구 결정은 이제 `views/conn-status.js` 몫이다. 그리고 함수 시그니처가 `onRetry` 를 받게 하고, `statusEl` 생성 줄(`:29`)을 바꾼다:

```js
export function buildHeader(code, { onLeave, onRetry, nicknameEditor } = {}) {
```

```js
  // 상태 표시는 버튼이다 — 끊겼을 때 눌러서 즉시 다시 시도할 수 있고,
  // button 이라 창 드래그 핸들러가 클릭을 삼키지 않는다(window-controls 의 드래그 예외).
  const statusEl = el("button", {
    class: "btn room-status",
    title: "click to retry",
    text: "connecting",
    onClick: onRetry,
  });
```

- [ ] **Step 2: room-view import 교체**

`src/views/room-view.js:13` 의

```js
import { buildHeader, STATUS_TEXT } from "./room/header.js";
```

를

```js
import { buildHeader } from "./room/header.js";
import { connStatusLabel, renderConnStatus } from "./conn-status.js";
import { createReconnectController } from "../chat/reconnect-controller.js";
```

로 바꾼다.

- [ ] **Step 3: 상태 렌더 교체**

`room-view.js:226-236` 의 `renderStatus` 블록을 아래로 교체:

```js
    // --- 상태 렌더링: 감독자가 방송한 연결 상태 + 온라인 인원 ---
    let conn = { state: "connecting", attempt: 0, retryInSec: 0 };
    let onlineCount = null;
    function renderStatus() {
      renderConnStatus(statusEl, connStatusLabel({ ...conn, onlineCount }));
      const ok = conn.state === "connected";
      // 송신만 게이팅 — input/emoji picker 는 local 동작이라 끊긴 동안에도 작성은 허용한다.
      sendBtn.disabled = !ok;
      syncMediaBtn();
    }
```

`syncMediaBtn`(`:137-139`)이 참조하던 `connState` 도 함께 바꾼다:

```js
    function syncMediaBtn() {
      mediaBtn.disabled = conn.state !== "connected" || !!pendingAttachment || uploading;
    }
```

`syncMediaBtn` 은 `conn` 선언보다 위에 있지만 문제없다 — 호출은 전부 사용자 조작 콜백과 `renderStatus` 안이라 `conn` 이 만들어진 뒤에 일어난다(지금 `connState` 도 똑같은 구조다). 선언 위치를 옮기지 말 것.

- [ ] **Step 4: 감독자 생성 + transport 이벤트 배선**

`room-view.js:321-345`(transport 이벤트 wiring ~ `window.addEventListener("focus", onWinFocus)`) 구간을 아래로 교체:

```js
    // --- transport 이벤트 wiring ---
    // 첫 connected는 openRoom의 seed가 이미 처리했으므로 backfill 생략. 이후 재진입(재연결)에서만 호출.
    let hadConnectedOnce = false;
    // controller 는 Step 5 에서 헤더보다 먼저 선언해 둔 변수에 담는다(선언 없이 여기서 const 로 만들지 않는다).
    controller = createReconnectController({
      reconnect: () => transport.reconnect(),
      isHealthy: () => transport.isHealthy(),
      onState: (s) => {
        conn = s;
        renderStatus();
      },
    });
    const unsubStatus = transport.on("status", ({ state }) => {
      controller.onTransportState(state);
      if (state === "connected") {
        if (hadConnectedOnce) backfill();
        hadConnectedOnce = true;
      }
    });
    // 채널이 자신의 죽음을 모르는 경우 보강: 창이 다시 보이면 갭필하고,
    // 그 갭필이 실패하면 연결이 실제로 죽은 것으로 보고 감독자에게 재연결을 맡긴다.
    const onVisibility = async () => {
      if (document.visibilityState !== "visible") return;
      const ok = await backfill();
      if (!ok) controller.reportUnhealthy();
    };
    document.addEventListener("visibilitychange", onVisibility);
    // 이 방을 보는 중 앱이 다시 포커스되면(다른 앱 갔다 옴) 그 사이 쌓인 이 방의 안 읽은 표시를 지운다.
    const onWinFocus = () => messageNotifier.clearRoom(code);
    window.addEventListener("focus", onWinFocus);
```

- [ ] **Step 5: 헤더 생성 시 재시도 연결**

`buildHeader` 호출(`:90-93`)보다 위, `// --- DOM 구성 ---`(`:84`) 바로 아래에 선언 한 줄을 추가한다. 헤더가 감독자보다 먼저 만들어지므로 클릭 시점에 읽도록 `let` 으로 잡아 둔다(`const` 로 아래에서 선언하면 클릭 시 초기화 전 참조 오류가 난다):

```js
    // 헤더가 감독자보다 먼저 만들어진다 — 클릭 시점에 읽도록 미리 잡아 둔다.
    let controller = null;
```

`buildHeader` 호출에 `onRetry` 를 넘긴다:

```js
    const { headerEl, statusEl } = buildHeader(code, {
      onLeave: () => ctx.navigate("lobby"),
      onRetry: () => controller?.retryNow(),
      nicknameEditor,
    });
```

- [ ] **Step 6: 첫 연결 시작 + 실패 처리 + 정리**

`room-view.js:450-460` 의 `transport.connect(...)` 블록을 아래로 바꾼다. **`controller.start()` 는 `connect()` 바로 앞**이어야 한다 — 더 일찍 켜면 `connect()` 가 아직 방 정보를 기억하기 전(`lastArgs === null`)에 창 포커스 신호가 들어와 "not connected" 실패가 한 번 뜬다. `connect()` 는 첫 `await` 전에 그 정보를 채우므로, 두 줄을 붙여 두면 그 틈이 사라진다:

```js
    controller.start();
    transport
      .connect(code, { nickname, clientId })
      .then(() => setTimeout(() => input.focus(), 0))
      .catch((e) => {
        console.error("connect failed:", e);
        // status 구독이 상태를 못 받은 경로에서도 감독자가 재시도를 잡도록 명시적으로 먹인다.
        controller.onTransportState("error");
      });
```

`this._cleanup` (`:462-480`) 에 `controller.stop();` 를 `unsubStatus();` 바로 앞에 추가한다.

- [ ] **Step 7: 확인**

Run: `npm test`
Expected: 전부 통과 (`STATUS_TEXT` 를 참조하는 다른 파일이 없는지 `grep -rn "STATUS_TEXT" src` 로 확인 — 0건이어야 한다)

- [ ] **Step 8: 커밋**

```bash
git add src/views/room-view.js src/views/room/header.js
git commit -m "feat: 방 화면 연결 자동 복구와 복구 중 표시"
```

---

### Task 9: 로비에 전역 채널 상태 줄

**Files:**
- Modify: `src/views/lobby-view.js:7, 66-89`
- Modify: `src/styles.css` (`.saved-rooms-header` 근처)

**Interfaces:**
- Consumes: `notifierConnection.{subscribe,getState,retryNow}` (Task 6), `connStatusLabel/renderConnStatus` (Task 7)
- Produces: 없음

**배치 주의:** 승인된 그림은 `— CHAT ROOMS —` 헤더와 같은 줄 오른쪽이었지만, 그 헤더는 안 읽음이 바뀔 때마다 `renderSavedRooms` 가 통째로 다시 그리고 **저장된 방이 하나도 없으면 아예 안 만든다**. 그래서 상태 줄은 목록 바로 위의 독립된 오른쪽 정렬 한 줄로 둔다 — 보이는 위치는 사실상 같고, 방이 없을 때도 살아남는다.

- [ ] **Step 1: 구현**

`src/views/lobby-view.js:7` 아래에 import 추가:

```js
import { notifierConnection } from "../chat/notifier-connection.js";
import { connStatusLabel, renderConnStatus } from "./conn-status.js";
```

`mount` 안, `const savedSection = ...` 바로 앞에 추가:

```js
    // 배지·알림용 전역 채널 상태. 정상일 땐 숨기고, 끊겼을 때만 한 줄 띄운다(클릭하면 즉시 재시도).
    const connEl = el("button", {
      class: "btn lobby-conn",
      title: "click to retry",
      hidden: true,
      onClick: () => notifierConnection.retryNow(),
    });
    function renderConn(s) {
      const connected = s.state === "connected";
      connEl.hidden = connected;
      if (!connected) renderConnStatus(connEl, connStatusLabel(s));
    }
    renderConn(notifierConnection.getState());
```

`screenEl.append(...)`(`:69`) 의 자식 배열에서 `err` 다음에 `connEl` 을 끼운다:

```js
    screenEl.append(el("div", { class: "lobby" }, [createBtn, sep, input, joinBtn, err, connEl, savedSection]));
```

`mount` 끝의 구독 옆에 추가:

```js
    this._unsubConn = notifierConnection.subscribe((s) => {
      if (connEl.isConnected) renderConn(s);
    });
```

`unmount` 를 바꾼다:

```js
  unmount() {
    this._unsub?.();
    this._unsub = null;
    this._unsubConn?.();
    this._unsubConn = null;
  },
```

- [ ] **Step 2: 스타일**

`src/styles.css` 의 `.saved-rooms-header` 규칙(`:1178-1183`) 바로 위에 추가:

```css
/* 로비 전역 채널 상태 — 끊겼을 때만 보인다. */
.lobby-conn {
  position: static;
  align-self: flex-end;
  font-size: calc(var(--computer-width) / 50);
  opacity: 0.9;
}
```

- [ ] **Step 3: 확인**

Run: `npm test`
Expected: 전부 통과

- [ ] **Step 4: 커밋**

```bash
git add src/views/lobby-view.js src/styles.css
git commit -m "feat: 로비에 알림 채널 연결 상태 표시"
```

---

### Task 10: 문서 + 손으로 확인

**Files:**
- Modify: `src/CLAUDE.md` ("Transport abstraction" 절 뒤)

- [ ] **Step 1: 문서 추가**

`src/CLAUDE.md` 의 "## Transport abstraction" 절 바로 뒤에 새 절을 넣는다:

```markdown
## 연결 복구 (reconnect)

실시간 채널은 창을 오래 숨겨 두면 조용히 죽고, 라이브러리 혼자서는 못 살아나는 경우가 있다
(채널이 `CLOSED` 되면 스스로 소켓 목록에서 빠지고, 숨은 동안에는 소켓이 재접속을 포기한다).
그래서 복구는 앱이 소유한다: `chat/reconnect-controller.js` 가 **언제 다시 붙을지**를 결정하고,
복구는 항상 **옛 채널 버리고 새 채널로 재구독**(`transport.reconnect()` / `messageNotifier.reconnect()`)이다.

- 시도 시점: 창 포커스·보이기·`online` 이벤트(넷 다 듣는다 — 플랫폼마다 빠지는 게 있다),
  transport 의 error/closed/timeout, 1초 tick 워치독, 사용자가 상태를 클릭했을 때.
- 간격: `RETRY_DELAYS_MS = [0, 2s, 5s, 10s, 30s]` — 30초에서 멈춘다. 창이 앞으로 오면 처음으로 되돌린다.
- 좀비 판별: 상태가 `connected` 여도 `isHealthy()`(채널이 실제로 `joined`)가 거짓이거나
  복귀 시 `backfill()` 이 실패하면 죽은 것으로 보고 다시 붙인다.
- 화면 상태 4가지(`connecting/connected/recovering/waiting`)는 `views/conn-status.js` 가 문구로 바꾼다.
- 전역 알림 채널은 `chat/notifier-connection.js` 가 감독한다. **재연결이 안 읽음 카운터를 지우면 안 되므로**
  `message-notifier` 의 채널 정리(`teardownChannel`)와 카운터 정리(`stop`)는 분리돼 있다.
```

- [ ] **Step 2: 전체 테스트**

Run: `npm test`
Expected: 전부 통과. (jsdom 미설치로 DOM 테스트가 깨지면 `npm install` 먼저.)

- [ ] **Step 3: 앱으로 손 확인**

**먼저 준비:** `src/config.local.js` 는 gitignore 대상이라 워크트리에 **없다**. 원래 체크아웃에서 복사해 온다:

```bash
cp /Users/happyduck/Documents/Programming/retro-note/src/config.local.js src/config.local.js
```

(펫 스프라이트 PNG 도 저장소에 없어 펫은 안 보인다 — 이번 확인과는 무관하다. 그리고 워크트리는 Rust 빌드 캐시가 비어 있어 첫 `tauri dev` 는 몇 분 걸린다.)

Run: `npm run tauri dev`

아래를 순서대로 확인한다:
1. 방 입장 → 헤더에 `● 1 online`.
2. Wi‑Fi 끄기 → 몇 초 안에 `reconnecting···`(점이 흐름) → `offline · Ns [↻]` 로 바뀐다.
3. `offline` 표시를 클릭 → 곧바로 `reconnecting···` 로 바뀐다(대기 안 함).
4. Wi‑Fi 켜기 → 스스로 `● N online` 복귀 + 끊긴 동안 온 메시지가 채워진다.
5. 창 최소화 → 5분 이상 방치 → 복원 → 몇 초 안에 `● N online` 복귀.
6. 로비로 나가서 Wi‑Fi 끄기 → 오른쪽에 상태 줄이 뜬다. 켜면 사라진다.
7. 다른 계정에서 메시지를 보내 도크 배지를 1 이상으로 만든 뒤 Wi‑Fi 껐다 켜기 → **배지 숫자가 0으로 리셋되지 않아야 한다**(카운터 보존 확인).

- [ ] **Step 4: 커밋**

```bash
git add src/CLAUDE.md
git commit -m "docs: 연결 복구 구조 설명 추가"
```

---

## Verification (전체)

| 무엇 | 어떻게 |
|---|---|
| 단위 테스트 | `npm test` — 새 파일 4개(`channel-subscribe`, `reconnect-controller`, `notifier-connection`, `conn-status`) 포함, 기존 테스트 전부 통과 |
| 재시도 규칙 | `node --test src/chat/reconnect-controller.test.js` — 간격·백오프 리셋·좀비 감지·중복 방지·정지 후 무시 |
| 배지 보존 | `node --test src/chat/message-notifier.test.js` — 재연결 후 카운터 유지 |
| 실제 복구 | Task 10 Step 3 의 7가지 손 확인(Wi‑Fi 토글 / 최소화 후 방치) |

**통합 테스트는 이번에 추가하지 않는다.** 끊김·재연결은 실제 소켓 수명주기라 로컬 Supabase 스택으로도 재현이 어렵고, 이 환경은 Docker가 꺼져 있어 검증 자체가 안 된다. 대신 위 손 확인 절차를 문서로 남긴다.

## 이번에 하지 않는 것

- 끊긴 동안 쓴 메시지를 모아 두는 전송 대기열 — 지금처럼 SEND 버튼이 잠기는 방식 유지
- 앱 전역 커넥션 매니저로의 리팩터
- 홈/노트 화면의 연결 표시등

## 실행 시작 시 함께 할 일

계획 모드라 `docs/` 아래에 문서를 만들 수 없었다. Task 0 으로 워크트리에 들어간 뒤 이 계획을
`docs/superpowers/plans/2026-08-13-chat-reconnect.md` 로 복사해 Task 1 커밋에 함께 넣는다.

## 다 끝난 뒤 (별도 승인 필요)

Task 10 까지 끝나면 **push 하지 않고** 아래를 준비해 보여 주고 기다린다:

1. `git log --oneline main..feature/chat-reconnect` 로 커밋 목록 정리
2. PR 제목·본문 초안 (제목에 이슈 번호를 넣지 않는다 — 저장소 규칙)
3. 손 확인 결과 요약(Task 10 Step 3 의 7가지 중 무엇을 실제로 해 봤는지, 못 해 본 것은 못 했다고 명시)

사용자가 "push", "PR 만들어" 라고 명시적으로 말한 뒤에만 실행한다.
