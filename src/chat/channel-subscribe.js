// Supabase 채널 구독을 Promise 로 감싼다. 첫 결과(SUBSCRIBED / CHANNEL_ERROR / TIMED_OUT / CLOSED)로 확정되고,
// 그 뒤에 오는 상태 변화도 onStatus 로 계속 흘려보낸다 — 끊김·복구 표시가 이 신호를 먹고 산다.
const CHANNEL_STATUS_MAP = {
  SUBSCRIBED: "connected",
  CHANNEL_ERROR: "error",
  TIMED_OUT: "reconnecting",
  CLOSED: "closed",
};

const SUBSCRIBE_TIMEOUT_MS = 15000;

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
      // 확정은 첫 결과에서 한 번만. 알림은 그 뒤에도 계속 흘려야 한다 —
      // 끊김 표시와 좀비 감지가 이 신호를 먹고 살기 때문에 여기서 끊으면 복구가 통째로 죽는다.
      if (!settled) {
        if (status === "SUBSCRIBED") {
          settled = true;
          clearTimer(timer);
          resolve();
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
          // CLOSED 도 확정 대상이다 — 빼 두면 붙지 못한 구독이 제한 시간까지 매달렸다가
          // 뒤늦게 실패해서, 그사이 복구된 멀쩡한 연결을 도로 끊는다.
          settled = true;
          clearTimer(timer);
          reject(new Error(`subscribe failed: ${status}`));
        }
      }
      try {
        onStatus(CHANNEL_STATUS_MAP[status] || "connecting");
      } catch (e) {
        console.error("channel status handler failed:", e);
      }
    });
  });
}
