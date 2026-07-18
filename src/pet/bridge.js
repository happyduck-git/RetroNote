// 메인 창 → 펫 창 신호 중계. 펫 창은 별개 JS 컨텍스트라 messageNotifier·pet-cat 을 직접 못 읽어
// 메인이 대신 구독/저장하고 Tauri 이벤트로 넘긴다. 표시 색(pet-cat pref)이 SSOT — 펫은 그대로 투영.
import { messageNotifier } from "../chat/message-notifier.js";
import { onPetCatChange, getPetCat, setPetCat } from "../platform/pet-cat.js";

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
  if (!T?.event) return;

  // 새 메시지 반응 + 안 읽음(빨간 점) 중계.
  messageNotifier.onMessageArrived((code) => emitToPet("pet:message-arrived", { code }));
  messageNotifier.petSubscribe(() =>
    emitToPet("pet:unread", { total: messageNotifier.getPetUnreadTotal() }),
  );

  // 포커스 중계 — 빨간 점은 메인이 맨 앞이 아닐 때만 뜬다.
  const sendFocus = (focused) => emitToPet("pet:main-focus", { focused });
  const win = T?.window?.getCurrentWindow?.();
  if (win?.onFocusChanged) {
    win.onFocusChanged(({ payload }) => sendFocus(!!payload)).catch(() => {});
  }
  window.addEventListener("focus", () => sendFocus(true));
  window.addEventListener("blur", () => sendFocus(false));

  onPetCatChange((id) => emitToPet("pet:set-cat", { catId: id }));

  // 펫이 준비되면 초기값 전달 + 현재 색 복원(펫이 늦게 떠도 맞춰진다).
  T.event.listen?.("pet:ready", () => {
    sendFocus(typeof document !== "undefined" ? document.hasFocus() : true);
    emitToPet("pet:unread", { total: messageNotifier.getPetUnreadTotal() });
    emitToPet("pet:set-cat", { catId: getPetCat() });
  });

  // 우클릭 "Remove pet" → pref 를 none 으로(onPetCatChange 가 pet:set-cat(none) 을 되돌려 숨김).
  T.event.listen?.("pet:removed", () => setPetCat("none"));

  // 메인 (재)로드 시 펫이 이미 떠 있을 수 있어 현재 색을 즉시 한 번 보낸다(양방향 kick).
  emitToPet("pet:set-cat", { catId: getPetCat() });
}
