// 연결 상태(감독자 방송값) → 화면 문구. 방 헤더와 로비가 함께 쓴다.
// 문구 결정은 순수 함수로 떼어 두어 DOM 없이 테스트한다.
import { el } from "../core/dom.js";
import { RETRY_DELAYS_MS } from "../chat/reconnect-controller.js";

// 간격이 상한까지 밀렸다 = 여러 번 연달아 실패했다. 잠깐 끊긴 것과 구분해 준다
// (로그인 만료·방에서 제외 같은 건 기다린다고 낫지 않는다).
const STUCK_ATTEMPT = RETRY_DELAYS_MS.length - 1;

export function connStatusLabel({ state, attempt = 0, retryInSec = 0, onlineCount = null } = {}) {
  if (state === "connected") {
    // 0 은 "내 track 이 아직 서버에 안 닿은 순간" — 숫자를 보여 줄 게 아니다.
    return { text: onlineCount > 0 ? `● ${onlineCount} online` : "● online", dots: false, error: false, retry: false, stuck: false, idle: true };
  }
  if (state === "connecting") return { text: "connecting", dots: true, error: false, retry: false, stuck: false, idle: false };
  if (state === "recovering") return { text: "reconnecting", dots: true, error: false, retry: false, stuck: false, idle: false };
  const stuck = attempt >= STUCK_ATTEMPT;
  const head = stuck ? "can't connect" : "offline";
  return {
    text: retryInSec > 0 ? `${head} · ${retryInSec}s` : head,
    dots: false,
    error: true,
    retry: true,
    stuck,
    idle: false,
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
  target.classList.toggle("conn-stuck", !!label.stuck);
  // 아무 문제 없을 때는 눌러도 아무 일이 없어야 한다 — 누르면 멀쩡한 채널을 뜯고 다시 붙는다.
  target.disabled = !!label.idle;
  target.title = label.idle ? "" : "click to retry";
}
