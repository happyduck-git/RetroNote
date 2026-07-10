import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { startStarfield, startMatrixRain } from "./screensaver-scenes.js";

// 씬 함수는 canvas 인자만 받고 전역 requestAnimationFrame/Math.random 에 의존한다.
// Node 엔 canvas 도 rAF 도 없으므로 손수 만든 fake 로 순수 검증한다(screen-mode.test.js fake 스타일).

// fillStyle/font 등 setter 와 fillRect/fillText 호출을 기록하는 2D 컨텍스트 fake.
function recordingCtx() {
  return {
    fillStyle: null,
    font: null,
    textBaseline: null,
    globalAlpha: 1,
    fillRectCalls: [],
    fillTextCalls: [],
    fillRect(x, y, w, h) {
      this.fillRectCalls.push([x, y, w, h]);
    },
    fillText(ch, x, y) {
      this.fillTextCalls.push([ch, x, y]);
    },
  };
}

// clientWidth/Height(표시 크기)와 width/height(버퍼)를 가진 canvas fake.
function fakeCanvas(clientWidth, clientHeight) {
  const ctx = recordingCtx();
  return {
    clientWidth,
    clientHeight,
    width: 0,
    height: 0,
    ctxCalls: 0,
    lastKind: null,
    ctx,
    getContext(kind) {
      this.ctxCalls++;
      this.lastKind = kind;
      return ctx;
    },
  };
}

// 전역 rAF/cancel 을 캡처 스텁으로 교체. 프레임은 자동 루프하지 않고 테스트가 수동 실행한다.
function installRaf() {
  let nextId = 0;
  const state = { frames: [], cancelled: [], lastId: 0 };
  globalThis.requestAnimationFrame = (fn) => {
    state.frames.push(fn);
    state.lastId = ++nextId;
    return state.lastId;
  };
  globalThis.cancelAnimationFrame = (id) => state.cancelled.push(id);
  return state;
}

describe("screensaver scenes", () => {
  let raf;
  let origRaf;
  let origCancel;
  let origRandom;

  beforeEach(() => {
    origRaf = globalThis.requestAnimationFrame;
    origCancel = globalThis.cancelAnimationFrame;
    origRandom = Math.random;
    raf = installRaf();
  });

  afterEach(() => {
    globalThis.requestAnimationFrame = origRaf;
    globalThis.cancelAnimationFrame = origCancel;
    Math.random = origRandom;
  });

  describe("startStarfield", () => {
    test("getContext('2d') 사용 + rAF 예약 + stop() 이 마지막 rAF 를 취소", () => {
      const canvas = fakeCanvas(800, 600);
      const stop = startStarfield(canvas);
      assert.equal(canvas.ctxCalls, 1);
      assert.equal(canvas.lastKind, "2d");
      assert.equal(raf.frames.length, 1); // start 시 프레임 1회 예약
      const scheduledId = raf.lastId;
      stop();
      assert.ok(raf.cancelled.includes(scheduledId));
    });

    test("프레임 실행: DARK 초기화 + 트레일 + 화면 안 별을 fillRect 로 렌더", () => {
      Math.random = () => 0.5; // 별을 화면 중앙(in-bounds)에 스폰 → 실제로 그려짐
      const canvas = fakeCanvas(800, 600);
      startStarfield(canvas);
      raf.frames[0](16); // 첫 프레임 수동 실행

      const rects = canvas.ctx.fillRectCalls;
      // 전체 채우기(초기 DARK + 트레일) 2회 이상 + 별(작은 사각형)
      assert.ok(rects.length >= 3);
      const star = rects.find((r) => r[2] === 1 && r[3] === 1);
      assert.ok(star, "1x1 별 픽셀이 그려져야 한다");
      // 프레임 끝에서 다음 프레임을 다시 예약한다
      assert.equal(raf.frames.length, 2);
    });

    test("fitCanvas: 버퍼를 clientWidth/Height ÷ SCALE(2) 로 맞춘다", () => {
      Math.random = () => 0.5;
      const canvas = fakeCanvas(800, 600);
      startStarfield(canvas);
      raf.frames[0](16);
      assert.equal(canvas.width, 400); // 800 / 2
      assert.equal(canvas.height, 300); // 600 / 2
    });
  });

  describe("startMatrixRain", () => {
    const CHARS = "0123456789<>=*+-ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ레트로노트";

    test("getContext('2d') 사용 + rAF 예약 + stop() 이 마지막 rAF 를 취소", () => {
      const canvas = fakeCanvas(800, 600);
      const stop = startMatrixRain(canvas);
      assert.equal(canvas.ctxCalls, 1);
      assert.equal(canvas.lastKind, "2d");
      assert.equal(raf.frames.length, 1);
      const scheduledId = raf.lastId;
      stop();
      assert.ok(raf.cancelled.includes(scheduledId));
    });

    test("STEP_MS 경과 프레임: 글리프를 fillText 로 그리고 폰트/베이스라인 설정", () => {
      Math.random = () => 0; // drops 가 전부 0(=화면 최상단)에서 시작 → 첫 스텝에 그려짐
      const canvas = fakeCanvas(800, 600);
      startMatrixRain(canvas);
      raf.frames[0](100); // acc=100 ≥ STEP_MS(75) → step 실행

      assert.ok(canvas.ctx.fillTextCalls.length > 0);
      assert.match(canvas.ctx.font, /VT323/); // 픽셀 폰트 스택
      assert.equal(canvas.ctx.textBaseline, "top");
      // 그려진 글리프는 모두 지정 문자셋 안에 있어야 한다(시스템 폰트 폴백 룩 방지)
      for (const [ch] of canvas.ctx.fillTextCalls) {
        assert.ok(CHARS.includes(ch), `예상 밖 글리프: ${ch}`);
      }
    });

    test("STEP_MS 미만 프레임: step 을 건너뛴다(fillText 없음)", () => {
      Math.random = () => 0;
      const canvas = fakeCanvas(800, 600);
      startMatrixRain(canvas);
      raf.frames[0](10); // acc=10 < STEP_MS → step 스킵
      assert.equal(canvas.ctx.fillTextCalls.length, 0);
    });

    test("fitCanvas: 버퍼를 clientWidth/Height(SCALE 1) 로 맞춘다", () => {
      Math.random = () => 0;
      const canvas = fakeCanvas(800, 600);
      startMatrixRain(canvas);
      raf.frames[0](100);
      assert.equal(canvas.width, 800);
      assert.equal(canvas.height, 600);
    });
  });
});
