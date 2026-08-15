// 연결 상태(감독자 방송값) → 화면 문구. 방 헤더와 로비가 함께 쓴다.
// 문구 결정은 순수 함수로 떼어 두어 DOM 없이 테스트한다.
import { el } from "../core/dom.js";

export function connStatusLabel({ state, retryInSec = 0, onlineCount = null } = {}) {
  if (state === "connected") {
    return { text: onlineCount != null ? `● ${onlineCount} online` : "● online", dots: false, error: false, retry: false };
  }
  if (state === "connecting") return { text: "connecting", dots: true, error: false, retry: false };
  if (state === "recovering") return { text: "reconnecting", dots: true, error: false, retry: false };
  return {
    text: retryInSec > 0 ? `offline · ${retryInSec}s` : "offline",
    dots: false,
    error: true,
    retry: true,
  };
}

export function renderConnStatus(target, label) {
  const children = [label.text];
  if (label.dots) {
    for (let i = 0; i < 3; i++) children.push(el("span", { class: "conn-dot", text: "·" }));
  }
  if (label.retry) children.push(el("span", { class: "conn-retry", text: " [↻]" }));
  target.replaceChildren();
  for (const c of children) target.append(c.nodeType ? c : document.createTextNode(c));
  // 빨간 강조는 방 헤더와 로비가 함께 쓰는 클래스로 — 방 전용 이름이면 로비에서 안 먹는다.
  target.classList.toggle("conn-error", label.error);
}
