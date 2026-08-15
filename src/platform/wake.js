// 창이 앞으로 오거나 네트워크가 돌아오는 신호를 한곳에서 모은다.
// 플랫폼마다 빠지는 신호가 있어 넷 다 듣는다 — Tauri 최소화 복원에서 DOM focus/visibilitychange 가
// 안 오는 경우가 있다. 이 앱은 번들러가 없어 @tauri-apps/* 대신 전역(window.__TAURI__)을 쓴다.
// Tauri 가 아닌 환경(브라우저 단독·단위 테스트)에서는 전역이 없으므로 조용히 넘어간다.

function getWin() {
  return typeof window !== "undefined" ? window.__TAURI__?.window?.getCurrentWindow?.() : undefined;
}

// onWake 를 여러 신호에 물리고, 전부 해제하는 함수를 돌려준다.
export function bindWakeSignals(onWake) {
  if (typeof window === "undefined" || typeof document === "undefined") return () => {};
  const onVisible = () => {
    if (document.visibilityState === "visible") onWake();
  };
  window.addEventListener("focus", onWake);
  window.addEventListener("online", onWake);
  document.addEventListener("visibilitychange", onVisible);
  let unlistenTauri = null;
  let unbound = false;
  getWin()
    ?.onFocusChanged?.(({ payload }) => {
      if (payload) onWake();
    })
    // 해제 함수가 unbind 보다 늦게 도착할 수 있다 — 그때는 받자마자 끊는다(안 그러면 영영 남는다).
    .then((un) => {
      if (unbound) un();
      else unlistenTauri = un;
    })
    .catch(() => {});
  return () => {
    unbound = true;
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
