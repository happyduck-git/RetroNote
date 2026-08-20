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
const itemByLabel = (menu, label) => items(menu).find((b) => b.textContent === label);

// 눌린 항목을 순서대로 기록하는 메뉴. 어떤 버튼이 어떤 콜백에 걸렸는지 확인용.
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

  test("cleanup 은 열려 있던 메뉴를 닫는다(document 리스너 정리)", () => {
    const { menu } = buildSpyMenu();
    menu.toggle();
    menu.cleanup();
    assert.equal(menu.popupEl.hidden, true);
  });

  test("ESC 로 닫힌다", () => {
    const { menu } = buildSpyMenu();
    menu.toggle();
    win.document.dispatchEvent(new win.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    assert.equal(menu.popupEl.hidden, true);
  });
});
