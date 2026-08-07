import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";

// bridge.js 는 로드 시 window.__TAURI__ 를 캡처하고, pet-cat.js 는 로드 시
// typeof localStorage 로 인스턴스 생성 여부를 정한다. → import 전에 전역을 심는다.
const KEY = "retro-note.pet-cat";
const emits = []; // { target, event, payload }
const listenCbs = new Map(); // Tauri event 이름 → 등록된 콜백
const winListeners = new Map(); // window 이벤트 타입 → 콜백
let focusChangedCb = null;

const fakeT = {
  event: {
    async emitTo(target, event, payload) {
      emits.push({ target, event, payload });
    },
    listen(event, cb) {
      listenCbs.set(event, cb);
      return Promise.resolve(() => {});
    },
  },
  window: {
    getCurrentWindow() {
      return {
        onFocusChanged(cb) {
          focusChangedCb = cb;
          return Promise.resolve(() => {});
        },
      };
    },
  },
};

// pet-cat 이 쓰는 localStorage fake — 초기 펫 색은 orange.
const store = new Map([[KEY, "orange"]]);
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
};
globalThis.window = {
  __TAURI__: fakeT,
  addEventListener: (type, cb) => winListeners.set(type, cb),
};

const { initPetBridge } = await import("./bridge.js");
const { getPetCat } = await import("../platform/pet-cat.js");

after(() => {
  delete globalThis.window;
  delete globalThis.localStorage;
});

const emitsFor = (event) => emits.filter((e) => e.event === event);
const hasEmit = (event, payload) =>
  emits.some(
    (e) =>
      e.event === event &&
      e.target === "pet" &&
      JSON.stringify(e.payload) === JSON.stringify(payload),
  );

describe("initPetBridge (Tauri 있음)", () => {
  before(() => initPetBridge());

  test("초기화 시 현재 펫 색을 pet:set-cat 으로 즉시 한 번 보낸다(양방향 kick)", () => {
    assert.ok(hasEmit("pet:set-cat", { catId: "orange" }));
  });

  test("focus/blur 릴레이: window 포커스 변화 → pet:main-focus", () => {
    winListeners.get("focus")();
    assert.ok(hasEmit("pet:main-focus", { focused: true }));
    winListeners.get("blur")();
    assert.ok(hasEmit("pet:main-focus", { focused: false }));
  });

  test("Tauri onFocusChanged 콜백도 pet:main-focus 로 중계", () => {
    focusChangedCb({ payload: false });
    assert.ok(hasEmit("pet:main-focus", { focused: false }));
  });

  test("pet:ready → main-focus + pet:unread(합계) + pet:set-cat(현재 색) 전달", () => {
    const before = emits.length;
    listenCbs.get("pet:ready")();
    const after = emits.slice(before);
    assert.ok(after.some((e) => e.event === "pet:main-focus"));
    assert.ok(after.some((e) => e.event === "pet:unread" && e.payload.total === 0));
    assert.ok(after.some((e) => e.event === "pet:set-cat" && e.payload.catId === "orange"));
  });

  test("pet:removed → 펫 색을 none 으로 접고 pet:set-cat(none) 을 되돌린다", () => {
    listenCbs.get("pet:removed")();
    assert.equal(getPetCat(), "none");
    assert.ok(hasEmit("pet:set-cat", { catId: "none" }));
  });
});

describe("initPetBridge (Tauri 없음)", () => {
  test("window.__TAURI__ 없으면 조용히 no-op (구독/emit 없음)", async () => {
    globalThis.window.__TAURI__ = undefined;
    // 쿼리스트링으로 모듈 캐시를 우회해 T=undefined 상태로 재평가.
    const { initPetBridge: initNoTauri } = await import("./bridge.js?notauri");
    const n = emits.length;
    assert.doesNotThrow(() => initNoTauri());
    assert.equal(emits.length, n, "emit 이 발생하면 안 된다");
    globalThis.window.__TAURI__ = fakeT; // 복원
  });
});
