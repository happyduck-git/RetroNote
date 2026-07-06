import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeScreenMode } from "./screen-mode.js";

const KEY = "retro-note.bezel-mode";
const LEGACY_KEY = "retro-note.large-screen"; // 구 키(v0.1.10). 값 승계로 기존 설정 보존.

// localStorage 호환 fake — getItem/setItem 만 사용.
function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _map: m,
  };
}

// classList.toggle(name, on) 만 흉내내는 fake root(실사용 document.body).
function fakeRoot() {
  const c = new Set();
  return {
    classList: {
      toggle: (n, on) => (on ? c.add(n) : c.delete(n)),
      contains: (n) => c.has(n),
    },
    _c: c,
  };
}

describe("makeScreenMode", () => {
  test("스토리지 비어있음 → 기본 off, 클래스 미부착", () => {
    const root = fakeRoot();
    const m = makeScreenMode({ storage: fakeStorage(), root });
    m.apply();
    assert.equal(m.isBezelMode(), false);
    assert.equal(root.classList.contains("bezel-mode"), false);
  });

  test('저장값 "true" → on + 클래스 부착', () => {
    const root = fakeRoot();
    const m = makeScreenMode({ storage: fakeStorage({ [KEY]: "true" }), root });
    m.apply();
    assert.equal(m.isBezelMode(), true);
    assert.ok(root.classList.contains("bezel-mode"));
  });

  test("toggle: 값 반전 + 영속화 + 클래스 + 리스너 통지", () => {
    const storage = fakeStorage();
    const root = fakeRoot();
    const m = makeScreenMode({ storage, root });
    const seen = [];
    m.onChange((v) => seen.push(v));

    m.toggle();
    assert.equal(m.isBezelMode(), true);
    assert.equal(storage._map.get(KEY), "true");
    assert.ok(root.classList.contains("bezel-mode"));

    m.toggle();
    assert.equal(m.isBezelMode(), false);
    assert.equal(storage._map.get(KEY), "false");
    assert.equal(root.classList.contains("bezel-mode"), false);

    assert.deepEqual(seen, [true, false]);
  });

  test("set 동일값 → no-op(쓰기·통지 없음)", () => {
    const storage = fakeStorage();
    const m = makeScreenMode({ storage, root: fakeRoot() });
    let n = 0;
    m.onChange(() => n++);
    m.set(false); // 이미 false
    assert.equal(n, 0);
    assert.equal(storage._map.has(KEY), false);
  });

  test("onChange 반환 함수로 구독 해지", () => {
    const m = makeScreenMode({ storage: fakeStorage(), root: fakeRoot() });
    let n = 0;
    const off = m.onChange(() => n++);
    m.toggle();
    off();
    m.toggle();
    assert.equal(n, 1);
  });
});

// 구 키(large-screen) 승계 — 기존 사용자 설정 보존이 목적.
// `?? ` 는 null(키 없음)일 때만 폴백하므로, 새 키가 있으면 새 키가 항상 이긴다.
describe("makeScreenMode: 구 키(large-screen) 승계", () => {
  test("새 키 없음 + 구 키 'true' → 승계해서 on", () => {
    const root = fakeRoot();
    const m = makeScreenMode({ storage: fakeStorage({ [LEGACY_KEY]: "true" }), root });
    m.apply();
    assert.equal(m.isBezelMode(), true);
    assert.ok(root.classList.contains("bezel-mode"));
  });

  test("새 키 'false' + 구 키 'true' → 새 키가 이겨서 off", () => {
    const root = fakeRoot();
    const m = makeScreenMode({
      storage: fakeStorage({ [KEY]: "false", [LEGACY_KEY]: "true" }),
      root,
    });
    m.apply();
    assert.equal(m.isBezelMode(), false);
    assert.equal(root.classList.contains("bezel-mode"), false);
  });

  test("구 키 'false' → off (승계값이 false)", () => {
    const m = makeScreenMode({ storage: fakeStorage({ [LEGACY_KEY]: "false" }), root: fakeRoot() });
    assert.equal(m.isBezelMode(), false);
  });
});
