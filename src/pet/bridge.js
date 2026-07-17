// 메인 창 → 펫 창 신호 중계 + 펫 창 표시 토글.
// 펫 창은 별개 JS 컨텍스트라 messageNotifier 를 직접 못 부른다 → 메인에서 구독해 Tauri 이벤트로 넘긴다.
//
// 표시 상태의 "유일한 기준"은 펫 창의 실제 창 상태(isVisible)다. 메인은 상태를 추측/저장하지 않고,
// 버튼은 "토글해줘"(pet:toggle)만 보낸 뒤 펫이 되돌려주는 실제 상태(pet:shown)로 버튼을 맞춘다.
// 이렇게 하면 메인 창만 리로드돼(개발 중 hot-reload) 펫 창이 그대로 떠 있어도 상태가 어긋나지 않는다.
// 기본은 "숨김": 부팅 때 펫이 자동으로 뜨지 않고, 상단 [^ω^] 버튼을 눌러야 나타난다.
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
  // 버튼 표시용 상태(펫이 보고한 실제 상태로만 갱신됨).
  let petShown = false;

  function renderBtn() {
    if (!btn) return;
    btn.classList.toggle("off", !petShown);
    btn.title = petShown ? "Hide pet" : "Show pet";
  }
  renderBtn();

  if (!T?.event) return; // Tauri 아님 → 중계 배선 생략(버튼은 위에서 무해하게 표시만)

  // 1) 새 메시지 반응 중계(focus 무관, 모든 방).
  messageNotifier.onMessageArrived((code) => emitToPet("pet:message-arrived", { code }));

  // 2) 펫 안 읽음 변경 → 빨간 점.
  messageNotifier.petSubscribe(() =>
    emitToPet("pet:unread", { total: messageNotifier.getPetUnreadTotal() }),
  );

  // 3) 메인 창 포커스 변화 중계(빨간 점 게이팅: 메인이 맨 앞이 아닐 때만 점).
  const sendFocus = (focused) => emitToPet("pet:main-focus", { focused });
  const win = T?.window?.getCurrentWindow?.();
  if (win?.onFocusChanged) {
    win.onFocusChanged(({ payload }) => sendFocus(!!payload)).catch(() => {});
  }
  window.addEventListener("focus", () => sendFocus(true));
  window.addEventListener("blur", () => sendFocus(false));

  // 4) 펫 창이 알려주는 "실제" 표시 상태 → 버튼 갱신(유일한 기준).
  T.event.listen?.("pet:shown", (e) => {
    petShown = !!e?.payload?.shown;
    renderBtn();
  });

  // 5) 펫 창이 준비되면: 포커스/안읽음 초기값 전달 + 현재 실제 표시 상태 조회(버튼 동기화).
  T.event.listen?.("pet:ready", () => {
    sendFocus(typeof document !== "undefined" ? document.hasFocus() : true);
    emitToPet("pet:unread", { total: messageNotifier.getPetUnreadTotal() });
    emitToPet("pet:query");
  });

  // 6) 토글 버튼: 펫에 "토글" 명령만 보낸다. 실제 상태 반영은 pet:shown 회신으로.
  if (btn) {
    btn.addEventListener("click", () => emitToPet("pet:toggle"));
  }

  // 메인이 (재)로드된 시점에 펫이 이미 떠 있을 수 있으므로 현재 상태를 조회해 버튼을 맞춘다.
  emitToPet("pet:query");
}
