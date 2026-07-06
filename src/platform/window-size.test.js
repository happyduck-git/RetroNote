// 창 크기 상수(WIN_MIN/WIN_MAX)가 tauri.conf.json 의 min/max Width/Height 와 일치하는지 검증.
// 이 두 값은 손으로 맞춰져 있어(빌드 스텝 없음), 한쪽만 바꾸면 자유 리사이즈 클램프(JS)와
// OS 창 한계(Tauri)가 말없이 어긋난다. 이 테스트가 그 어긋남을 CI 에서 즉시 잡는다.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  WIN_MIN,
  WIN_MAX,
  computeAspectClamped,
  computeFreeSize,
} from "./window-controls.js";

const conf = JSON.parse(
  readFileSync(new URL("../../src-tauri/tauri.conf.json", import.meta.url), "utf8"),
);
const win = conf.app.windows.find((w) => w.label === "main");

describe("창 크기 상수 ↔ tauri.conf.json 동기화", () => {
  test("main 창 설정이 존재한다", () => {
    assert.ok(win, "tauri.conf.json 에 label 'main' 창이 있어야 함");
  });

  test("WIN_MAX 가 conf 의 maxWidth/maxHeight 와 일치", () => {
    assert.equal(win.maxWidth, WIN_MAX.w);
    assert.equal(win.maxHeight, WIN_MAX.h);
  });

  test("WIN_MIN 이 conf 의 minWidth/minHeight 와 일치", () => {
    assert.equal(win.minWidth, WIN_MIN.w);
    assert.equal(win.minHeight, WIN_MIN.h);
  });
});

const ASPECT = 2170 / 1952;

describe("computeFreeSize — 베젤 모드 자유 비율 클램프", () => {
  test("MIN/MAX 안의 값은 그대로", () => {
    assert.deepEqual(computeFreeSize(1000, 800), { w: 1000, h: 800 });
  });

  test("하한 미만은 MIN 으로 클램프", () => {
    assert.deepEqual(computeFreeSize(100, 100), { w: WIN_MIN.w, h: WIN_MIN.h });
  });

  test("상한 초과는 MAX 로 클램프 (가로·세로 독립)", () => {
    assert.deepEqual(computeFreeSize(9999, 9999), { w: WIN_MAX.w, h: WIN_MAX.h });
  });
});

describe("computeAspectClamped — 기본 모드 종횡비 유지", () => {
  test("중간 너비는 종횡비를 유지한다", () => {
    const { w, h } = computeAspectClamped(1000);
    assert.ok(Math.abs(w / h - ASPECT) < 0.01, `비율 유지 실패: ${w}/${h}`);
  });

  test("너비 상한 초과 → 결과가 MIN/MAX 안이고 비율 유지", () => {
    const { w, h } = computeAspectClamped(99999);
    assert.ok(w <= WIN_MAX.w && h <= WIN_MAX.h, `범위 초과: ${w}x${h}`);
    assert.ok(Math.abs(w / h - ASPECT) < 0.01);
  });

  test("아주 작은 너비 → 높이가 MIN 에 걸리면 폭을 비율로 되맞춤", () => {
    const { w, h } = computeAspectClamped(1);
    assert.equal(h, WIN_MIN.h); // 높이는 MIN
    assert.ok(w >= WIN_MIN.w); // 폭은 비율로 재계산되어 MIN 이상
    assert.ok(Math.abs(w / h - ASPECT) < 0.01);
  });
});
