import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { buildInputRow } from "./input-row.js";

// showGiphy 는 room-view 가 넘기고 이 모듈이 받는 계약이다. 한쪽 이름만 바뀌면 undefined 가 되어
// 첨부 버튼이 조용히 [img] 로 강등되는데(예외도 안 나고 다른 테스트도 안 깨진다) 그걸 여기서 잡는다.

let dom;
let win;
let saved;

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

describe("buildInputRow 의 showGiphy 계약", () => {
  test("Giphy 키가 있으면 [+] 와 세 가지를 안내하는 툴팁", () => {
    const { mediaBtn } = buildInputRow({ showGiphy: true });
    assert.equal(mediaBtn.textContent, "[+]");
    assert.equal(mediaBtn.getAttribute("title"), "Attach image, GIF or sticker");
  });

  test("Giphy 키가 없으면 [img] 로 바뀌고 툴팁도 이미지만 말한다", () => {
    const { mediaBtn } = buildInputRow({ showGiphy: false });
    assert.equal(mediaBtn.textContent, "[img]");
    assert.equal(mediaBtn.getAttribute("title"), "Attach image");
  });

  test("입력행이 내보내는 요소들이 실제로 행 안에 있다", () => {
    const { inputRowEl, emojiBtn, mediaBtn, fileInput, input, sendBtn } = buildInputRow({ showGiphy: true });
    for (const el of [emojiBtn, mediaBtn, fileInput, input, sendBtn]) {
      assert.ok(inputRowEl.contains(el));
    }
  });

  test("연결 전이므로 첨부·전송 버튼은 비활성으로 시작한다", () => {
    const { mediaBtn, sendBtn } = buildInputRow({ showGiphy: true });
    assert.equal(mediaBtn.disabled, true);
    assert.equal(sendBtn.disabled, true);
  });
});
