// 상태 → 스프라이트 애니 키 매핑 단위 테스트(순수 함수).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { animKeyFor, ANIMATIONS, AMBIENT_ANIM_KEYS } from "./sprite.js";

// behavior.js 가 내보내는 상태 이름 전부. 이 목록과 매핑이 어긋나면 폴백(idle)으로 새므로 함께 지킨다.
const BEHAVIOR_STATES = [
  "idle",
  "walk",
  "approach",
  "sleep",
  "react",
  "chilling",
  "dancing",
  "petting",
  "pettingHappy",
  "pettingExcited",
  "eat",
  "leap",
  "pounce",
  "excited",
  "boxed",
];

describe("sprite — animKeyFor 매핑", () => {
  test("재사용 매핑이 의도대로 연결된다", () => {
    assert.equal(animKeyFor("approach"), "walk");
    assert.equal(animKeyFor("pettingHappy"), "eat");
    assert.equal(animKeyFor("pettingExcited"), "excited");
    assert.equal(animKeyFor("boxed"), "boxed");
  });

  test("알 수 없는 상태는 idle 로 폴백한다", () => {
    assert.equal(animKeyFor("nope"), "idle");
    assert.equal(animKeyFor(undefined), "idle");
  });

  test("모든 behavior 상태가 실재하는 ANIMATIONS 키로 매핑된다", () => {
    for (const s of BEHAVIOR_STATES) {
      const key = animKeyFor(s);
      assert.ok(ANIMATIONS[key], `상태 ${s} → ${key} 가 ANIMATIONS 에 없음`);
    }
  });
});

describe("sprite — 정의 일관성", () => {
  test("AMBIENT_ANIM_KEYS 는 모두 ANIMATIONS 에 존재한다", () => {
    for (const k of AMBIENT_ANIM_KEYS) {
      assert.ok(ANIMATIONS[k], `AMBIENT 키 ${k} 가 ANIMATIONS 에 없음`);
    }
  });

  test("각 애니는 img 와 1 이상의 frames 를 가진다", () => {
    for (const [k, a] of Object.entries(ANIMATIONS)) {
      assert.ok(typeof a.img === "string" && a.img.length > 0, `${k} img 누락`);
      assert.ok(Number.isInteger(a.frames) && a.frames >= 1, `${k} frames 부적절`);
    }
  });
});
