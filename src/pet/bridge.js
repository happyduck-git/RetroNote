// 메인 창 → 펫 창 신호 중계 + 펫 창 표시 토글.
// 펫 창은 별개 JS 컨텍스트라 messageNotifier 를 직접 못 부른다 → 메인이 구독해 Tauri 이벤트로 넘긴다.
// 표시 상태의 유일한 기준은 펫 창의 실제 isVisible: 버튼은 토글 명령만 보내고 펫이 되돌려준 상태로 맞춘다.
// (메인만 리로드돼 펫이 그대로 떠 있어도 안 어긋남.) 부팅 기본은 숨김 — 상단 버튼으로만 표시.
import { messageNotifier } from "../chat/message-notifier.js";

const T = typeof window !== "undefined" ? window.__TAURI__ : undefined;

async function emitToPet(event, payload) {
  try {
    await T?.event?.emitTo?.("pet", event, payload);
  } catch (e) {
    console.error("emitToPet failed:", e);
  }
}

// 메인 창 부트스트랩에서 1회 호출. Tauri 밖(브라우저/테스트)에선 조용히 no-op.
export function initPetBridge() {
  const btn = document.getElementById("pet-btn");
  let petShown = false; // 펫이 보고한 실제 표시 상태로만 갱신

  function renderBtn() {
    if (!btn) return;
    btn.classList.toggle("off", !petShown);
    btn.title = petShown ? "Hide pet" : "Show pet";
  }
  renderBtn();

  if (!T?.event) return; // Tauri 아님 → 중계 생략(버튼만 무해하게 표시)

  // 새 메시지 반응(모든 방) + 안 읽음 변경(빨간 점) 중계.
  messageNotifier.onMessageArrived((code) => emitToPet("pet:message-arrived", { code }));
  messageNotifier.petSubscribe(() =>
    emitToPet("pet:unread", { total: messageNotifier.getPetUnreadTotal() }),
  );

  // 메인 창 포커스 변화 중계 — 빨간 점은 메인이 맨 앞이 아닐 때만 뜬다.
  const sendFocus = (focused) => emitToPet("pet:main-focus", { focused });
  const win = T?.window?.getCurrentWindow?.();
  if (win?.onFocusChanged) {
    win.onFocusChanged(({ payload }) => sendFocus(!!payload)).catch(() => {});
  }
  window.addEventListener("focus", () => sendFocus(true));
  window.addEventListener("blur", () => sendFocus(false));

  // 펫이 보고한 실제 표시 상태로 버튼을 맞춘다(유일한 기준).
  T.event.listen?.("pet:shown", (e) => {
    petShown = !!e?.payload?.shown;
    renderBtn();
  });

  // 펫 창이 준비되면 포커스/안읽음 초기값 전달 + 표시 상태 조회.
  T.event.listen?.("pet:ready", () => {
    sendFocus(typeof document !== "undefined" ? document.hasFocus() : true);
    emitToPet("pet:unread", { total: messageNotifier.getPetUnreadTotal() });
    emitToPet("pet:query");
  });

  if (btn) btn.addEventListener("click", () => emitToPet("pet:toggle"));

  // 메인이 (재)로드된 시점에 펫이 이미 떠 있을 수 있어 현재 상태를 조회해 버튼을 맞춘다.
  emitToPet("pet:query");
}
