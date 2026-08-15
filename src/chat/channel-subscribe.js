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
