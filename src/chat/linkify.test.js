import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { tokenizeMessage } from "./linkify.js";

// 도우미: 토큰을 "text|url:값" 문자열로 평탄화해 비교를 읽기 쉽게.
function flat(text) {
  return tokenizeMessage(text).map((t) => `${t.type}:${t.value}`);
}

describe("tokenizeMessage", () => {
  test("URL 없는 텍스트는 text 토큰 하나", () => {
    assert.deepEqual(flat("hello world"), ["text:hello world"]);
  });

  test("URL 단독", () => {
    assert.deepEqual(tokenizeMessage("https://example.com"), [
      { type: "url", value: "https://example.com" },
    ]);
  });

  test("텍스트 중간의 URL 분리", () => {
    assert.deepEqual(flat("see https://a.com here"), [
      "text:see ",
      "url:https://a.com",
      "text: here",
    ]);
  });

  test("여러 URL 분리 (http/https 둘 다)", () => {
    assert.deepEqual(flat("a https://x.io b http://y.io c"), [
      "text:a ",
      "url:https://x.io",
      "text: b ",
      "url:http://y.io",
      "text: c",
    ]);
  });

  test("후행 문장부호는 URL에서 제외되어 다음 text 로 흘러간다", () => {
    assert.deepEqual(flat("go https://a.com."), ["text:go ", "url:https://a.com", "text:."]);
    assert.deepEqual(flat("(https://a.com)"), ["text:(", "url:https://a.com", "text:)"]);
  });

  test("경로/쿼리가 붙은 URL도 통째로 인식", () => {
    assert.deepEqual(tokenizeMessage("https://a.com/p/q?x=1&y=2"), [
      { type: "url", value: "https://a.com/p/q?x=1&y=2" },
    ]);
  });

  test("스킴 없는 도메인은 링크로 인식하지 않음", () => {
    assert.deepEqual(flat("visit example.com now"), ["text:visit example.com now"]);
  });

  test("kaomoji 섞인 텍스트가 URL로 오인되지 않음", () => {
    assert.deepEqual(flat("(´∀｀) hi ヾ(◍'౪'◍)ﾉ"), ["text:(´∀｀) hi ヾ(◍'౪'◍)ﾉ"]);
  });

  test("kaomoji와 URL 공존", () => {
    assert.deepEqual(flat("(´∀｀) https://a.com"), [
      "text:(´∀｀) ",
      "url:https://a.com",
    ]);
  });
});
