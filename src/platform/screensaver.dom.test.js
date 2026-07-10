import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { initScreensaver } from "./screensaver.js";

// initScreensaver() 의 실제 DOM 배선을 jsdom 위에서 끝까지 구동한다.
// (순수 상태머신 makeScreensaver 는 screensaver.test.js 가, 장면 렌더는
//  screensaver-scenes.test.js 가 커버 — 여기선 배선만 본다.)
//
// 시간 제어는 node 의 mock timers 를 쓰지 않는다: 코드가 전역 performance.now() 를
// 직접 읽으므로 globalThis.performance 를 가변 clock 으로 갈아끼우고, setInterval 은
// 콜백을 캡처만 해 테스트가 수동으로 틱한다. node --test 는 파일별 프로세스 격리라
// 전역 오염이 다른 테스트 파일로 새지 않지만, 파일 내 test 간 대비로 afterEach 복원.

const IDLE_MS = 3 * 60 * 1000;

let dom;
let win;
let clock;
let intervalFn; // 캡처된 setInterval 콜백(= () => saver.check())
let saved;

// jsdom 에 없는 canvas 2D 컨텍스트 no-op(장면 start 가 getContext 로 null 을 받지 않게).
function noopCtx() {
  return {
    fillStyle: null,
    font: null,
    textBaseline: null,
    globalAlpha: 1,
    fillRect() {},
    fillText() {},
  };
}

// bubbles+cancelable 이벤트를 target 에서 발생시키고 이벤트 객체를 돌려준다.
function fire(target, type) {
  const ev = new win.Event(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev;
}

const saverEl = () => win.document.querySelector(".screensaver");

beforeEach(() => {
  dom = new JSDOM(
    `<!doctype html><html><body>
      <div class="screen-wrap" id="computer-wrap">
        <div class="screen" id="screen"><input id="editor" /></div>
        <div class="top-controls"><button id="close-btn">[X]</button></div>
      </div>
    </body></html>`,
  );
  win = dom.window;
  clock = 0;
  intervalFn = null;

  saved = {
    window: globalThis.window,
    document: globalThis.document,
    localStorage: globalThis.localStorage,
    performance: globalThis.performance,
    setInterval: globalThis.setInterval,
    requestAnimationFrame: globalThis.requestAnimationFrame,
    cancelAnimationFrame: globalThis.cancelAnimationFrame,
    getContext: win.HTMLCanvasElement.prototype.getContext,
  };

  globalThis.window = win;
  globalThis.document = win.document;
  globalThis.localStorage = { getItem: () => null }; // 장면 핀 없음 → 교대(첫 회 starfield)
  globalThis.performance = { now: () => clock };
  globalThis.setInterval = (fn) => {
    intervalFn = fn;
    return 1;
  };
  // 장면은 배선 테스트 범위 밖 — rAF no-op 으로 프레임 루프를 막고, getContext 는 no-op 반환.
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  win.HTMLCanvasElement.prototype.getContext = () => noopCtx();
});

afterEach(() => {
  globalThis.window = saved.window;
  globalThis.document = saved.document;
  globalThis.localStorage = saved.localStorage;
  globalThis.performance = saved.performance;
  globalThis.setInterval = saved.setInterval;
  globalThis.requestAnimationFrame = saved.requestAnimationFrame;
  globalThis.cancelAnimationFrame = saved.cancelAnimationFrame;
  win.HTMLCanvasElement.prototype.getContext = saved.getContext;
  win.close();
});

describe("initScreensaver 배선", () => {
  test("유휴 시간 경과 후 틱 → CRT 영역에 오버레이 부착", () => {
    initScreensaver(); // 이 시점 clock=0 → lastActivity=0
    assert.equal(saverEl(), null); // 아직 유휴 아님

    clock = IDLE_MS; // 3분 경과
    intervalFn(); // setInterval 틱 = saver.check()

    const overlay = saverEl();
    assert.ok(overlay, "오버레이가 생겨야 한다");
    assert.equal(overlay.parentElement.id, "computer-wrap"); // #screen 이 아닌 wrap 에 부착
    assert.ok(overlay.querySelector("canvas"), "오버레이 안에 canvas");
  });

  test("유휴 시간 미달 틱 → 발동 안 함", () => {
    initScreensaver();
    clock = IDLE_MS - 1;
    intervalFn();
    assert.equal(saverEl(), null);
  });

  for (const type of ["pointermove", "keydown", "wheel", "pointerdown"]) {
    test(`활성 중 ${type} 입력 → 즉시 해제`, () => {
      initScreensaver();
      win.__screensaver.show("starfield");
      assert.ok(saverEl());

      const ev = fire(win.document.body, type);
      assert.equal(saverEl(), null, "입력으로 오버레이가 제거되어야 한다");
      // pointermove 는 삼키지 않고(마우스 이동), 나머지는 preventDefault 로 소비
      if (type === "pointermove") assert.equal(ev.defaultPrevented, false);
      else assert.equal(ev.defaultPrevented, true);
    });
  }

  test("깨우는 클릭은 600ms 창 안에서 삼켜져 아래 버튼에 닿지 않는다", () => {
    initScreensaver();
    const closeBtn = win.document.getElementById("close-btn");
    let clicks = 0;
    closeBtn.addEventListener("click", () => clicks++); // 버블 단계 스파이

    win.__screensaver.show("starfield");
    fire(closeBtn, "pointerdown"); // 깨우기 + pointerWokeAt = clock(0)
    assert.equal(saverEl(), null); // 깨워짐

    const click = fire(closeBtn, "click"); // clock 그대로 0 → delta 0 < 600 → 삼킴
    assert.equal(clicks, 0, "깨우는 클릭은 버튼에 닿으면 안 된다");
    assert.equal(click.defaultPrevented, true);
  });

  test("600ms 이후의 클릭은 정상적으로 버튼에 전달된다", () => {
    initScreensaver();
    const closeBtn = win.document.getElementById("close-btn");
    let clicks = 0;
    closeBtn.addEventListener("click", () => clicks++);

    win.__screensaver.show("starfield");
    fire(closeBtn, "pointerdown"); // pointerWokeAt = 0
    clock = 700; // 삼킴 창(600ms) 밖

    const click = fire(closeBtn, "click");
    assert.equal(clicks, 1, "정상 클릭은 버튼에 전달되어야 한다");
    assert.equal(click.defaultPrevented, false);
  });

  test("발동 시 포커스를 내리고 해제 시 복원", () => {
    initScreensaver();
    const input = win.document.getElementById("editor");
    input.focus();
    assert.equal(win.document.activeElement, input);

    win.__screensaver.show("starfield");
    assert.notEqual(win.document.activeElement, input, "발동 시 편집기 포커스 해제");

    win.__screensaver.hide();
    assert.equal(win.document.activeElement, input, "해제 시 포커스 복원");
  });

  test("__screensaver 훅으로 즉시 표시/제거 + 장면 지정", () => {
    initScreensaver();
    win.__screensaver.show("matrix");
    assert.ok(saverEl());
    win.__screensaver.hide();
    assert.equal(saverEl(), null);
  });

  test("#computer-wrap 이 없으면 조용히 아무것도 안 한다", () => {
    win.document.getElementById("computer-wrap").remove();
    assert.doesNotThrow(() => initScreensaver());
    assert.equal(win.__screensaver, undefined); // 훅도 설치되지 않음
  });
});
