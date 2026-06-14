// 작은 DOM 헬퍼. 사용자 입력은 반드시 textContent로 넣어 XSS를 차단한다 (innerHTML 금지).
export function el(tag, props = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (v == null) continue;
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v; // 안전한 텍스트 삽입
    else if (k === "dataset") Object.assign(node.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") {
      node.addEventListener(k.slice(2).toLowerCase(), v);
    } else if (v === true) node.setAttribute(k, "");
    else if (v !== false) node.setAttribute(k, v);
  }
  for (const c of [].concat(children)) {
    if (c == null || c === false) continue;
    node.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return node;
}

export function pad2(n) {
  return String(n).padStart(2, "0");
}

export function onEnter(el, fn) {
  el.addEventListener("keydown", (e) => {
    // IME composition 중 Enter 는 commit 키 → 무시 (한글/일본어/중국어 입력 시 마지막 글자 중복 방지).
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      fn(e);
    }
  });
}
