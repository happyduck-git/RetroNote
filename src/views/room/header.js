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
  // 문구·툴팁·눌림 여부는 renderConnStatus 가 상태에 맞춰 관리한다(출처를 한 곳으로).
  const statusEl = el("button", {
    class: "btn room-status",
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
