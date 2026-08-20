// 실시간 채널 연결 감독자. 끊긴 채널을 다시 붙이고, 그 과정을 화면이 그릴 수 있는 상태로 방송한다.
// 방 채널(room-view)과 전역 알림 채널(notifier-connection)이 이 규칙을 공유한다.
//
// 상태: connecting(첫 연결) | connected | recovering(붙이는 중) | waiting(다음 시도 대기)
// 앱이 앞으로 돌아오거나 네트워크가 복구되면 대기를 건너뛰고 즉시 시도한다(간격도 처음으로 되돌림).
import { bindWakeSignals } from "../platform/wake.js";

export const RETRY_DELAYS_MS = [0, 2000, 5000, 10000, 30000];
const TICK_MS = 1000;
// 붙자마자 끊기는(flap) 상황을 가려내는 기준. 이만큼 버틴 연결은 "정상이었다"로 보고 벌점을 씻는다.
const STABLE_MS = 30000;
// 막 붙은 직후에는 채널이 아직 joined 가 아닐 수 있어 그동안은 좀비 검사를 미룬다.
const HEALTH_GRACE_MS = 3000;
// 첫 연결이 아무 상태도 못 받은 채 잠긴 경우의 상한. 구독 자체 제한(15초)보다 뒤에 둔다.
const CONNECTING_TIMEOUT_MS = 20000;
// OS 신호로 시작되는 재시도의 최소 간격. 알트탭 한 번에 focus/visibility/online/Tauri 가 한꺼번에 오고,
// 방을 열고 있으면 감독자가 둘이라 그대로 두면 신호 수만큼 요청이 나간다. 사람이 누른 재시도는 예외.
const WAKE_MIN_GAP_MS = 2000;

export function createReconnectController({
  reconnect,
  isHealthy = () => true,
  onState = () => {},
  bindWake = bindWakeSignals,
  // 벽시계가 아니라 단조 시계를 쓴다 — 절전에서 깨어난 뒤 NTP 가 시계를 뒤로 돌리면
  // 대기 마감이 미래로 밀려 재시도가 통째로 멈춘다(여기 시각들은 서로 간의 차이로만 쓰인다).
  now = () => performance.now(),
  setTimer = (fn, ms) => setTimeout(fn, ms),
  clearTimer = (id) => clearTimeout(id),
}) {
  let state = "connecting";
  let attempt = 0; // 벌점 = 다음 대기 간격의 인덱스
  let nextAttemptAt = null;
  let connectedAt = null; // 이번 연결이 언제 붙었는지(flap 판별용)
  let inFlight = false;
  let gen = 0; // stop() 뒤에 도착하는 늦은 결과를 무시하기 위한 세대 번호
  // 세대 번호는 "이미 시작된" 시도만 막는다 — 정지 뒤 새로 들어오는 신호는 이 표시로 막는다.
  // start() 전에도 참이라, 만들어만 두고 아직 켜지 않은 감독자는 아무 신호에도 반응하지 않는다.
  let stopped = true;
  let connectingSince = null; // 첫 연결이 잠겼는지 재는 기준 시각
  let lastWakeAt = null; // null 이어야 첫 신호가 간격에 걸리지 않는다(시계가 0 부터 시작한다)
  let failStreak = 0;
  let timerId = null;
  let unbindWake = null;
  let lastEmitted = null; // 같은 값을 매초 다시 방송하지 않으려고 직전 것을 들고 있는다

  function snapshot() {
    const retryInSec =
      state === "waiting" && nextAttemptAt != null
        ? Math.max(0, Math.ceil((nextAttemptAt - now()) / 1000))
        : 0;
    return { state, attempt, retryInSec };
  }

  function emit() {
    const s = snapshot();
    const p = lastEmitted;
    if (p && p.state === s.state && p.attempt === s.attempt && p.retryInSec === s.retryInSec) return;
    lastEmitted = s;
    onState(s);
  }

  function arm() {
    clearTimer(timerId);
    timerId = setTimer(tick, TICK_MS);
  }

  function tick() {
    if (stopped) return;
    // 붙었다고 알고 있는데 채널이 실제로는 죽은 경우(좀비). 창이 계속 앞에 있으면 깨우기 신호가
    // 영영 안 오므로, 여기서 직접 확인하지 않으면 아무도 못 잡는다.
    // 끊김 신호와 같은 경로로 흘린다 — 벌점을 씻지 않아야 계속 좀비인 채널에 매초 달라붙지 않는다.
    if (state === "connected" && connectedAt != null && now() - connectedAt >= HEALTH_GRACE_MS && !isHealthy()) {
      feedTransportState("closed");
      arm();
      return;
    }
    // 첫 연결이 아무 상태도 못 받은 채 잠긴 경우. 그냥 두면 재시도 일정이 아예 안 잡힌다.
    if (state === "connecting" && !inFlight && connectingSince != null && now() - connectingSince >= CONNECTING_TIMEOUT_MS) {
      feedTransportState("closed");
      arm();
      return;
    }
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

  function currentDelay() {
    return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
  }

  function scheduleRetry() {
    if (stopped || inFlight) return;
    const delay = currentDelay();
    if (delay === 0) {
      attemptNow();
      return;
    }
    state = "waiting";
    nextAttemptAt = now() + delay;
    emit();
  }

  async function attemptNow() {
    if (stopped || inFlight) return;
    inFlight = true;
    const myGen = gen;
    state = "recovering";
    nextAttemptAt = null;
    emit();
    try {
      await reconnect();
      if (myGen !== gen) return;
      failStreak = 0;
      state = "connected";
      connectedAt = now();
    } catch (e) {
      // 영구 실패(로그인 만료·권한 없음)면 30초마다 같은 줄이 영원히 쌓인다 → 연속 실패는 첫 건만 남긴다.
      if (failStreak === 0) console.error("reconnect failed:", e);
      failStreak++;
      if (myGen !== gen) return;
      penalize();
      state = "waiting";
      nextAttemptAt = now() + currentDelay();
    } finally {
      // 세대가 바뀌었으면 inFlight 를 일부러 그대로 둔다 — 이미 stop() 이 되돌렸고,
      // 여기서 또 만지면 새로 시작된 시도의 값을 덮어쓴다.
      if (myGen === gen) {
        inFlight = false;
        emit();
      }
    }
  }

  // 벌점을 씻고 곧바로 시도한다. 실제로 시도를 걸 수 없는 상황이면 벌점도 건드리지 않는다 —
  // 안 그러면 시도 없이 간격만 바닥으로 깎여 백오프가 무의미해진다.
  function requestRetry() {
    if (stopped || inFlight) return;
    attempt = 0;
    connectedAt = null;
    scheduleRetry();
  }

  function wake() {
    if (stopped) return;
    if (state === "connected" && isHealthy()) return;
    if (lastWakeAt != null && now() - lastWakeAt < WAKE_MIN_GAP_MS) return;
    lastWakeAt = now();
    requestRetry();
  }

  // 간격을 무시하되 기준 시각은 갱신한다 — 뒤따라올 OS 신호까지 겹쳐 나가지 않도록.
  function retryNow() {
    if (stopped) return;
    lastWakeAt = now();
    requestRetry();
  }

  function feedTransportState(next) {
    if (stopped) return;
    if (next === "connected") {
      if (state !== "connected") connectedAt = now();
      nextAttemptAt = null;
      state = "connected";
      emit();
      return;
    }
    if (next === "connecting") {
      if (state !== "recovering") {
        // 이미 connecting 이면 기준 시각을 유지한다 — 갱신하면 잠긴 연결이 영영 시간 초과가 안 된다.
        if (state !== "connecting") connectingSince = now();
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
    stopped = false;
    connectingSince = now();
    lastWakeAt = null;
    failStreak = 0;
    unbindWake = bindWake(wake);
    arm();
    emit();
  }

  function stop() {
    stopped = true;
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

  return { start, stop, feedTransportState, wake, retryNow, forceRetry: requestRetry, getState: snapshot };
}
