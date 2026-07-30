import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { buildCommandBanner } from "./command-banner.js";

// buildCommandBanner 의 DOM 배선 + 자동 숨김 타이머를 jsdom 위에서 구동한다.
// setTimeout/clearTimeout 을 캡처형으로 갈아끼워 만료 시점을 테스트가 수동으로 제어한다.

let dom;
let win;
let saved;
let timers; // id → fn (아직 취소되지 않은 타이머)
let nextId;

function flushTimers() {
  for (const fn of [...timers.values()]) fn();
}

beforeEach(() => {
  dom = new JSDOM(`<!doctype html><html><body></body></html>`);
  win = dom.window;
  timers = new Map();
  nextId = 1;
  saved = {
    window: globalThis.window,
    document: globalThis.document,
    setTimeout: globalThis.setTimeout,
    clearTimeout: globalThis.clearTimeout,
  };
  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.setTimeout = (fn) => {
    const id = nextId++;
    timers.set(id, fn);
    return id;
  };
  globalThis.clearTimeout = (id) => {
    timers.delete(id);
  };
});

afterEach(() => {
  globalThis.window = saved.window;
  globalThis.document = saved.document;
  globalThis.setTimeout = saved.setTimeout;
  globalThis.clearTimeout = saved.clearTimeout;
  win.close();
});

describe("buildCommandBanner 배선", () => {
  test("초기엔 숨김, show → 표시 + 텍스트", () => {
    const b = buildCommandBanner();
    assert.equal(b.bannerEl.hidden, true);
    b.show("안내 문구");
    assert.equal(b.bannerEl.hidden, false);
    assert.equal(b.bannerEl.textContent, "안내 문구");
  });

  test("사용자 입력은 textContent 로만 삽입(HTML 미해석)", () => {
    const b = buildCommandBanner();
    b.show("<img src=x onerror=alert(1)> /pet");
    assert.equal(b.bannerEl.children.length, 0, "자식 엘리먼트가 생기면 안 된다");
    assert.equal(b.bannerEl.textContent, "<img src=x onerror=alert(1)> /pet");
  });

  test("TTL 만료(타이머 발동) → 자동 숨김 + 텍스트 비움", () => {
    const b = buildCommandBanner();
    b.show("hi");
    assert.equal(b.bannerEl.hidden, false);
    flushTimers(); // setTimeout(hide, TTL) 발동
    assert.equal(b.bannerEl.hidden, true);
    assert.equal(b.bannerEl.textContent, "");
  });

  test("연속 show → 이전 타이머 취소(유효 타이머 하나), 옛 만료가 새 배너를 지우지 않음", () => {
    const b = buildCommandBanner();
    b.show("first");
    b.show("second");
    assert.equal(b.bannerEl.textContent, "second");
    assert.equal(timers.size, 1, "이전 타이머가 취소되어 유효 타이머는 하나여야 한다");
    flushTimers();
    assert.equal(b.bannerEl.hidden, true);
  });

  test("hide → 즉시 숨김 + 텍스트 비움 + 타이머 정리", () => {
    const b = buildCommandBanner();
    b.show("hi");
    b.hide();
    assert.equal(b.bannerEl.hidden, true);
    assert.equal(b.bannerEl.textContent, "");
    assert.equal(timers.size, 0, "타이머가 정리되어야 한다");
  });
});
