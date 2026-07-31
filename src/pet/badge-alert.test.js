import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { petBadgeVisible } from "./badge-alert.js";

describe("petBadgeVisible", () => {
  test("안 읽음 있고 메인 비포커스 → 표시", () => {
    assert.equal(petBadgeVisible(1, false), true);
    assert.equal(petBadgeVisible(9, false), true);
  });

  test("메인 창이 앞이면 안 읽음이 있어도 숨김", () => {
    assert.equal(petBadgeVisible(3, true), false);
  });

  test("안 읽음 0 이면 항상 숨김", () => {
    assert.equal(petBadgeVisible(0, false), false);
    assert.equal(petBadgeVisible(0, true), false);
  });
});
