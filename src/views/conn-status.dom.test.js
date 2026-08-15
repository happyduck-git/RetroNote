import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { connStatusLabel, renderConnStatus } from "./conn-status.js";

// 문구 결정 자체는 conn-status.test.js 가 본다. 여기서는 그 문구를 DOM 으로 옮기는 부분만.
let dom, win, saved;

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>");
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

function render(state) {
  const el = win.document.createElement("button");
  renderConnStatus(el, connStatusLabel(state));
  return el;
}

const dots = (el) => el.querySelectorAll(".conn-dot").length;

describe("renderConnStatus", () => {
  test("연결 중에는 점 3개가 붙는다", () => {
    const el = render({ state: "connecting" });
    assert.equal(dots(el), 3);
    assert.ok(el.textContent.startsWith("connecting"));
  });

  test("연결됐으면 점도 재시도 표시도 없다", () => {
    const el = render({ state: "connected", onlineCount: 2 });
    assert.equal(dots(el), 0);
    assert.equal(el.querySelectorAll(".conn-retry").length, 0);
    assert.equal(el.classList.contains("conn-error"), false);
  });

  test("끊기면 재시도 표시와 빨간 강조가 붙는다", () => {
    const el = render({ state: "waiting", retryInSec: 5 });
    assert.equal(el.querySelectorAll(".conn-retry").length, 1);
    assert.equal(el.classList.contains("conn-error"), true);
    assert.equal(el.classList.contains("conn-stuck"), false);
  });

  test("연달아 실패하면 conn-stuck 이 붙는다", () => {
    const el = render({ state: "waiting", attempt: 4, retryInSec: 30 });
    assert.equal(el.classList.contains("conn-stuck"), true);
    assert.ok(el.textContent.startsWith("can't connect"));
  });

  test("다시 그려도 이전 자식이 쌓이지 않는다", () => {
    const el = win.document.createElement("button");
    renderConnStatus(el, connStatusLabel({ state: "connecting" }));
    renderConnStatus(el, connStatusLabel({ state: "connecting" }));
    assert.equal(dots(el), 3);
  });

  test("상태가 좋아지면 강조 클래스가 떨어진다", () => {
    const el = win.document.createElement("button");
    renderConnStatus(el, connStatusLabel({ state: "waiting", attempt: 4, retryInSec: 30 }));
    renderConnStatus(el, connStatusLabel({ state: "connected", onlineCount: 1 }));
    assert.equal(el.classList.contains("conn-error"), false);
    assert.equal(el.classList.contains("conn-stuck"), false);
    assert.equal(el.textContent, "● 1 online");
  });
});

describe("renderConnStatus 눌림 여부", () => {
  test("아무 문제 없을 때는 눌리지 않고 툴팁도 없다", () => {
    const el = render({ state: "connected", onlineCount: 2 });
    assert.equal(el.disabled, true, "누르면 멀쩡한 채널을 뜯고 다시 붙는다");
    assert.equal(el.title, "");
  });

  test("끊기면 눌리고 안내가 붙는다", () => {
    const el = render({ state: "waiting", retryInSec: 5 });
    assert.equal(el.disabled, false);
    assert.equal(el.title, "click to retry");
  });

  test("복구 중에도 눌러서 기다림을 건너뛸 수 있다", () => {
    const el = render({ state: "recovering" });
    assert.equal(el.disabled, false);
  });

  test("연결이 돌아오면 다시 눌리지 않게 된다", () => {
    const el = win.document.createElement("button");
    renderConnStatus(el, connStatusLabel({ state: "waiting", retryInSec: 5 }));
    renderConnStatus(el, connStatusLabel({ state: "connected", onlineCount: 1 }));
    assert.equal(el.disabled, true);
    assert.equal(el.title, "");
  });
});
