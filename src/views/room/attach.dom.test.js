import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { buildAttachMenu } from "./attach.js";

// buildAttachMenu 의 DOM 배선을 jsdom 위에서 구동한다.
// [+] 메뉴는 [img]/[gif]/[sticker] 세 항목을 띄우고, 항목을 누르면 스스로 닫힌 뒤 콜백을 부른다.

let dom;
let win;
let saved;

const items = (menu) => [...menu.popupEl.querySelectorAll(".room-attach-menu-item")];
const itemLabels = (menu) => items(menu).map((b) => b.textContent);
const itemTitles = (menu) => items(menu).map((b) => b.getAttribute("title"));
const itemByLabel = (menu, label) => items(menu).find((b) => b.textContent === label);

// 눌린 항목을 순서대로 기록하는 메뉴. 어떤 버튼이 어떤 콜백에 걸렸는지 확인용.
function fire(target, type) {
  target.dispatchEvent(new win.Event(type, { bubbles: true, cancelable: true }));
}

// 팝업 바깥에 두고 mousedown 대상으로 쓸 요소. className 으로 [+] 버튼 여부가 갈린다.
function appendOutside(className = "outside") {
  const node = win.document.createElement("button");
  node.className = className;
  win.document.body.append(node);
  return node;
}

function buildSpyMenu() {
  const picked = [];
  const menu = buildAttachMenu({
    onPickImage: () => picked.push("image"),
    onPickGif: () => picked.push("gif"),
    onPickSticker: () => picked.push("sticker"),
  });
  win.document.body.append(menu.popupEl);
  return { menu, picked };
}

beforeEach(() => {
  dom = new JSDOM(`<!doctype html><html><body></body></html>`);
  win = dom.window;
  saved = { window: globalThis.window, document: globalThis.document };
  globalThis.window = win;
  globalThis.document = win.document;
});

afterEach(() => {
  globalThis.window = saved.window;
  globalThis.document = saved.document;
  win.close();
});

describe("buildAttachMenu 배선", () => {
  test("항목은 [img]/[gif]/[sticker] 세 개가 이 순서로 렌더된다", () => {
    const { menu } = buildSpyMenu();
    assert.deepEqual(itemLabels(menu), ["[img]", "[gif]", "[sticker]"]);
  });

  test("각 항목의 툴팁이 제 자리에 들어간다", () => {
    // menuItem(text, title, onPick) 위치인자라 text 와 title 을 바꿔 써도 textContent 만으로는 안 잡힌다.
    const { menu } = buildSpyMenu();
    assert.deepEqual(itemTitles(menu), ["Attach image", "Find a GIF", "Find a sticker"]);
  });

  test("처음엔 닫혀 있고 toggle 로 열고 닫힌다", () => {
    const { menu } = buildSpyMenu();
    assert.equal(menu.popupEl.hidden, true);
    menu.toggle();
    assert.equal(menu.popupEl.hidden, false);
    menu.toggle();
    assert.equal(menu.popupEl.hidden, true);
  });

  test("각 항목 클릭 → 대응 콜백 1회 + 메뉴 자동 닫힘", () => {
    for (const [label, expected] of [["[img]", "image"], ["[gif]", "gif"], ["[sticker]", "sticker"]]) {
      const { menu, picked } = buildSpyMenu();
      menu.toggle();
      itemByLabel(menu, label).click();
      assert.deepEqual(picked, [expected], `${label} 이 다른 콜백에 걸렸다`);
      assert.equal(menu.popupEl.hidden, true, `${label} 클릭 후 메뉴가 안 닫혔다`);
      menu.cleanup();
    }
  });

  test("팝업 바깥 mousedown 은 메뉴를 닫는다", () => {
    const { menu } = buildSpyMenu();
    menu.toggle();
    fire(appendOutside(), "mousedown");
    assert.equal(menu.popupEl.hidden, true);
  });

  test("[+] 버튼 위 mousedown 으로는 닫지 않는다", () => {
    // 여기서 닫아 버리면 mousedown 이 닫고 click 이 다시 열어, [+] 가 영영 토글되지 않는다.
    const { menu } = buildSpyMenu();
    menu.toggle();
    fire(appendOutside("btn room-media-btn"), "mousedown");
    assert.equal(menu.popupEl.hidden, false);
  });

  test("document 리스너를 균형 있게 등록·해제하고 cleanup 이 열린 채로도 정리한다", () => {
    const added = [];
    const removed = [];
    const origAdd = win.document.addEventListener.bind(win.document);
    const origRemove = win.document.removeEventListener.bind(win.document);
    win.document.addEventListener = (type, fn, opts) => {
      if (type === "mousedown") added.push(fn);
      return origAdd(type, fn, opts);
    };
    win.document.removeEventListener = (type, fn, opts) => {
      if (type === "mousedown") removed.push(fn);
      return origRemove(type, fn, opts);
    };
    const { menu } = buildSpyMenu();
    menu.toggle(); // 열기 → 등록 +1
    assert.equal(added.length, 1);
    menu.toggle(); // 닫기 → 해제 +1
    assert.equal(removed.length, 1);
    assert.equal(removed[0], added[0], "등록한 것과 같은 핸들러를 해제한다");
    menu.toggle();
    menu.cleanup(); // 열린 채로 정리 → 해제 +1
    assert.equal(removed.length, 2);
    assert.equal(menu.popupEl.hidden, true);
  });

  test("ESC 로 닫힌다", () => {
    const { menu } = buildSpyMenu();
    menu.toggle();
    win.document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(menu.popupEl.hidden, true);
  });
});
