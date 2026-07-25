// 슬래시 명령 안내 배너: 입력행 위에 잠깐 떴다 사라지는 로컬 안내. 채팅 스트림/기록과 분리된 순수 UI.
import { el } from "../../core/dom.js";

const BANNER_TTL_MS = 3500;

export function buildCommandBanner() {
  const bannerEl = el("div", { class: "room-command-banner", hidden: true });
  let timer = null;

  function clearTimer() {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
  }

  function show(text) {
    // 연속 호출 시 이전 타이머를 먼저 지워, 앞선 배너의 만료가 새 배너를 지우지 않게 한다.
    clearTimer();
    bannerEl.textContent = text; // 사용자 입력이 섞일 수 있어 textContent 로만(innerHTML 금지).
    bannerEl.hidden = false;
    timer = setTimeout(hide, BANNER_TTL_MS);
  }

  function hide() {
    clearTimer();
    bannerEl.hidden = true;
    bannerEl.textContent = "";
  }

  return { bannerEl, show, hide };
}
