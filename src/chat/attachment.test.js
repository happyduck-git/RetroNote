import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { pickTargetSize, ATTACHMENT_LIMITS } from "./attachment.js";

describe("pickTargetSize: 긴 변 임계값 기준 등비 축소", () => {
  test("임계값 이하이면 축소하지 않음 (scaled:false, 원본 유지)", () => {
    assert.deepEqual(pickTargetSize(300, 200), { w: 300, h: 200, scaled: false });
    assert.deepEqual(pickTargetSize(341, 100), { w: 341, h: 100, scaled: false }); // 정확히 임계값
    assert.deepEqual(pickTargetSize(100, 341), { w: 100, h: 341, scaled: false });
  });

  test("가로가 길면 긴 변을 341 로 맞춰 등비 축소", () => {
    assert.deepEqual(pickTargetSize(682, 200), { w: 341, h: 100, scaled: true });
  });

  test("세로가 길면 긴 변을 341 로 맞춰 등비 축소", () => {
    assert.deepEqual(pickTargetSize(200, 682), { w: 100, h: 341, scaled: true });
  });

  test("축소 결과는 반올림된다", () => {
    // ratio = 341/683 ≈ 0.4993 → 300*ratio ≈ 149.78 → 150
    assert.deepEqual(pickTargetSize(683, 300), { w: 341, h: 150, scaled: true });
  });

  test("longEdge 인자를 넘기면 그 값 기준으로 축소", () => {
    assert.deepEqual(pickTargetSize(1000, 500, 100), { w: 100, h: 50, scaled: true });
    assert.deepEqual(pickTargetSize(80, 40, 100), { w: 80, h: 40, scaled: false });
  });
});

describe("ATTACHMENT_LIMITS", () => {
  test("MAX_BYTES 는 5 MiB", () => {
    assert.equal(ATTACHMENT_LIMITS.MAX_BYTES, 5 * 1024 * 1024);
  });

  test("ALLOWED 는 png/jpeg/gif/webp 만", () => {
    assert.deepEqual(
      [...ATTACHMENT_LIMITS.ALLOWED].sort(),
      ["image/gif", "image/jpeg", "image/png", "image/webp"],
    );
  });

  test("DOWNSCALE_LONG_EDGE 는 341", () => {
    assert.equal(ATTACHMENT_LIMITS.DOWNSCALE_LONG_EDGE, 341);
  });
});
