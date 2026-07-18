import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makePetCat } from "./pet-cat.js";

const KEY = "retro-note.pet-cat";

// localStorage 호환 fake — getItem/setItem 만 사용.
function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    _map: m,
  };
}

describe("makePetCat", () => {
  test("스토리지 비어있음 → 기본 none", () => {
    const m = makePetCat({ storage: fakeStorage() });
    assert.equal(m.get(), "none");
  });

  test("저장값 있으면 복원", () => {
    const m = makePetCat({ storage: fakeStorage({ [KEY]: "orange" }) });
    assert.equal(m.get(), "orange");
  });

  test("set: 값 저장 + 영속화 + 리스너 통지", () => {
    const storage = fakeStorage();
    const m = makePetCat({ storage });
    const seen = [];
    m.onChange((v) => seen.push(v));

    m.set("black");
    assert.equal(m.get(), "black");
    assert.equal(storage._map.get(KEY), "black");
    assert.deepEqual(seen, ["black"]);
  });

  test("set 동일값 → no-op(쓰기·통지 없음)", () => {
    const storage = fakeStorage({ [KEY]: "grey" });
    const m = makePetCat({ storage });
    let n = 0;
    m.onChange(() => n++);
    m.set("grey"); // 이미 grey
    assert.equal(n, 0);
  });

  test("set(null/빈값) → none 으로 접힘", () => {
    const storage = fakeStorage({ [KEY]: "white" });
    const m = makePetCat({ storage });
    m.set(null);
    assert.equal(m.get(), "none");
    assert.equal(storage._map.get(KEY), "none");
  });

  test("onChange 반환 함수로 구독 해지", () => {
    const m = makePetCat({ storage: fakeStorage() });
    let n = 0;
    const off = m.onChange(() => n++);
    m.set("orange");
    off();
    m.set("black");
    assert.equal(n, 1);
  });
});
