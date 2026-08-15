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
