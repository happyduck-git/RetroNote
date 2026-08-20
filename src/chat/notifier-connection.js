// 전역 알림 채널(message-notifier)의 연결 감독 + 상태 방송.
// main.js 가 로그인/로그아웃에 맞춰 start/stop, lobby 가 상태를 구독하고 재시도를 건다.
// notifier 자체는 타이머를 갖지 않는다 — 재시도 규칙은 전부 감독자 몫.
import { messageNotifier } from "./message-notifier.js";
import { createReconnectController } from "./reconnect-controller.js";

const INITIAL_STATE = { state: "connecting", attempt: 0, retryInSec: 0 };

export function makeNotifierConnection({ notifier, createController }) {
  let controller = null;
  let unsubStatus = null;
  let startToken = 0;
  let state = INITIAL_STATE;
  const subs = new Set();

  function emit() {
    for (const fn of subs) {
      try { fn(state); } catch (e) { console.error("notifier connection subscriber failed:", e); }
    }
  }

  function teardown() {
    controller?.stop();
    controller = null;
    unsubStatus?.();
    unsubStatus = null;
    return notifier.stop();
  }

  async function start(userId) {
    // 토큰을 teardown 앞에서 잡아야 겹친 start 둘이 모두 "controller 가 null" 을 보고 통과하지 않는다.
    const myToken = ++startToken;
    await teardown();
    if (myToken !== startToken) return;
    const ctl = createController({
      reconnect: () => notifier.reconnect(),
      isHealthy: () => notifier.isHealthy(),
      onState: (s) => { state = s; emit(); },
    });
    controller = ctl;
    unsubStatus = notifier.onStatus((s) => ctl.feedTransportState(s));
    await notifier.start(userId);
    if (myToken !== startToken) { ctl.stop(); return; }
    // 감시는 notifier 가 뜬 뒤에 켠다 — 그 전에 깨우기 신호가 오면 헛시도가 나고 로비에 offline 이 깜빡인다.
    ctl.start();
    // 켜기 전에 지나간 상태(특히 첫 연결 실패)를 여기서 따라잡는다. 이게 없으면 실패가 조용히 묻힌다.
    ctl.feedTransportState(notifier.getStatus());
  }

  async function stop() {
    startToken++;
    await teardown();
    state = INITIAL_STATE;
  }

  function retryNow() {
    controller?.retryNow();
  }

  function wake() {
    controller?.wake();
  }

  function subscribe(cb) {
    subs.add(cb);
    return () => subs.delete(cb);
  }

  return { start, stop, retryNow, wake, subscribe, getState: () => state };
}

export const notifierConnection = makeNotifierConnection({
  notifier: messageNotifier,
  createController: createReconnectController,
});
