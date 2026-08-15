import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { connStatusLabel } from "./conn-status.js";

describe("connStatusLabel", () => {
  test("연결 상태 + 인원 수", () => {
    assert.deepEqual(connStatusLabel({ state: "connected", onlineCount: 3 }), {
      text: "● 3 online", dots: false, error: false, retry: false,
    });
  });

  test("인원 수를 모르면 숫자 없이", () => {
    assert.equal(connStatusLabel({ state: "connected", onlineCount: null }).text, "● online");
  });

  test("첫 연결 중에는 점이 흐른다", () => {
    const l = connStatusLabel({ state: "connecting" });
    assert.equal(l.text, "connecting");
    assert.equal(l.dots, true);
  });

  test("복구 중에는 reconnecting + 점", () => {
    const l = connStatusLabel({ state: "recovering" });
    assert.equal(l.text, "reconnecting");
    assert.equal(l.dots, true);
    assert.equal(l.error, false);
  });

  test("대기 중에는 남은 초와 재시도 표시", () => {
    assert.deepEqual(connStatusLabel({ state: "waiting", retryInSec: 5 }), {
      text: "offline · 5s", dots: false, error: true, retry: true,
    });
  });

  test("남은 초가 0이면 초 표기를 뺀다", () => {
    assert.equal(connStatusLabel({ state: "waiting", retryInSec: 0 }).text, "offline");
  });
});
