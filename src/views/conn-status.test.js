import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { connStatusLabel } from "./conn-status.js";
import { RETRY_DELAYS_MS } from "../chat/reconnect-controller.js";

describe("connStatusLabel", () => {
  test("연결 상태 + 인원 수", () => {
    assert.deepEqual(connStatusLabel({ state: "connected", onlineCount: 3 }), {
      text: "● 3 online", dots: false, error: false, retry: false, stuck: false, idle: true,
    });
  });

  test("인원 수를 모르면 숫자 없이", () => {
    assert.equal(connStatusLabel({ state: "connected", onlineCount: null }).text, "● online");
  });

  test("인원 수가 0이면 숫자를 붙이지 않는다", () => {
    // presence 에 내 track 이 아직 안 닿은 순간이라 "0명"이 아니다.
    assert.equal(connStatusLabel({ state: "connected", onlineCount: 0 }).text, "● online");
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
      text: "offline · 5s", dots: false, error: true, retry: true, stuck: false, idle: false,
    });
  });

  test("남은 초가 0이면 초 표기를 뺀다", () => {
    assert.equal(connStatusLabel({ state: "waiting", retryInSec: 0 }).text, "offline");
  });

  test("여러 번 연달아 실패하면 문구가 바뀐다", () => {
    const l = connStatusLabel({ state: "waiting", attempt: RETRY_DELAYS_MS.length - 1, retryInSec: 30 });
    assert.equal(l.text, "can't connect · 30s");
    assert.equal(l.stuck, true);
  });

  test("실패가 상한에 못 미치면 그냥 offline", () => {
    const l = connStatusLabel({ state: "waiting", attempt: RETRY_DELAYS_MS.length - 2, retryInSec: 10 });
    assert.equal(l.text, "offline · 10s");
    assert.equal(l.stuck, false);
  });
});
