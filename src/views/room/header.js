// 채팅방 헤더: 방 코드 라벨 + 복사 버튼 + (옵션) 닉네임 에디터 + 상태 + 나가기.
import { el } from "../../core/dom.js";

const COPY_FEEDBACK_MS = 1200;

// 헤더: 방 코드 라벨 + 복사 버튼 + (옵션) 닉네임 에디터 + 상태 + 나가기.
export function buildHeader(code, { onLeave, onRetry, nicknameEditor } = {}) {
  const codeLabel = el("span", { class: "room-code", text: code });
  const copyBtn = el("button", { class: "btn room-copy", title: "Copy code", text: "[copy]" });
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      copyBtn.textContent = "[copied]";
      setTimeout(() => (copyBtn.textContent = "[copy]"), COPY_FEEDBACK_MS);
    } catch (e) {
      console.error("copy failed:", e);
    }
  });
  // 상태 표시는 버튼이다 — 끊겼을 때 눌러서 즉시 다시 시도할 수 있고,
  // button 이라 창 드래그 핸들러가 클릭을 삼키지 않는다(window-controls 의 드래그 예외).
  const statusEl = el("button", {
    class: "btn room-status",
    title: "click to retry",
    text: "connecting",
    onClick: onRetry,
  });
  const leaveBtn = el("button", { class: "btn room-leave", title: "Leave", text: "[X]", onClick: onLeave });
  const children = [codeLabel, copyBtn];
  if (nicknameEditor) children.push(nicknameEditor);
  children.push(statusEl, leaveBtn);
  const headerEl = el("div", { class: "room-header" }, children);
  return { headerEl, statusEl };
}
