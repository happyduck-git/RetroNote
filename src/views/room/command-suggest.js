// 슬래시 명령 자동완성 팝업: /를 치면 입력행 위에 후보를 띄우고 타이핑에 따라 필터링한다.
// 렌더 + 하이라이트 상태만 관리 — 실제 실행은 room-view 가 onRun/current() 로 구동한다.
import { el } from "../../core/dom.js";
import { matchCommands, suggestQuery } from "../../chat/slash-command.js";

export function buildCommandSuggest({ onRun }) {
  const listEl = el("div", { class: "room-command-suggest", hidden: true });
  let items = [];
  let active = 0;

  function render() {
    listEl.replaceChildren(
      ...items.map((it, i) =>
        el(
          "button",
          {
            class: "room-command-suggest-item" + (i === active ? " active" : ""),
            type: "button",
            dataset: { noDrag: "" },
            // mousedown 으로 실행 — click 은 input blur 뒤에 와서 팝업이 먼저 닫힐 수 있다.
            onMousedown: (e) => {
              e.preventDefault();
              onRun(it.name);
            },
          },
          [
            el("span", { class: "room-command-suggest-name", text: `/${it.name}` }),
            el("span", { class: "room-command-suggest-desc", text: it.description }),
          ],
        ),
      ),
    );
  }

  // 입력값에 맞춰 목록 갱신. 표시할 게 없으면 숨김.
  function update(text) {
    const q = suggestQuery(text);
    if (q === null) return hide();
    items = matchCommands(q);
    if (items.length === 0) return hide();
    active = 0;
    listEl.hidden = false;
    render();
  }

  function move(delta) {
    if (!isOpen()) return;
    active = (active + delta + items.length) % items.length;
    render();
  }

  function current() {
    return isOpen() ? items[active].name : null;
  }

  function isOpen() {
    return !listEl.hidden && items.length > 0;
  }

  function hide() {
    listEl.hidden = true;
    items = [];
    active = 0;
    listEl.replaceChildren();
  }

  return { listEl, update, move, current, isOpen, hide };
}
