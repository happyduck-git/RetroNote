import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { generate6, normalize, isValid, CODE_LENGTH } from "./room-code.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

test("normalize: trim + 대문자 + null/undefined 안전", () => {
  assert.equal(normalize("  abcde2 "), "ABCDE2");
  assert.equal(normalize("abcde2"), "ABCDE2");
  assert.equal(normalize(null), "");
  assert.equal(normalize(undefined), "");
  assert.equal(normalize(""), "");
});

describe("isValid", () => {
  test("정확히 6자 + 알파벳 내 문자만 통과 (정규화 후 검증)", () => {
    assert.equal(isValid("ABCDE2"), true);
    assert.equal(isValid("abcde2"), true);
    assert.equal(isValid("  abcde2  "), true);
  });

  test("길이가 6 이 아니면 거부", () => {
    assert.equal(isValid("ABCDE"), false); // 5자
    assert.equal(isValid("ABCDE23"), false); // 7자
    assert.equal(isValid(""), false);
    assert.equal(isValid(null), false);
  });

  test("혼동 문자(0/O/1/I)는 알파벳에서 제외되어 거부", () => {
    assert.equal(isValid("ABCDEO"), false);
    assert.equal(isValid("ABCDEI"), false);
    assert.equal(isValid("ABCDE0"), false);
    assert.equal(isValid("ABCDE1"), false);
  });
});

test("CODE_LENGTH 는 6", () => {
  assert.equal(CODE_LENGTH, 6);
});

test("generate6: 길이 6 + 알파벳 내 문자 + isValid 통과 (반복)", () => {
  for (let i = 0; i < 50; i++) {
    const code = generate6();
    assert.equal(code.length, CODE_LENGTH);
    for (const ch of code) assert.ok(ALPHABET.includes(ch), `문자 '${ch}' 가 알파벳에 없음`);
    assert.equal(isValid(code), true);
  }
});
