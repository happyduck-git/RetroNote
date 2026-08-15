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
