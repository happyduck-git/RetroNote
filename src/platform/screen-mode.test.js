import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeScreenMode } from "./screen-mode.js";

const KEY = "retro-note.bezel-mode";

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
