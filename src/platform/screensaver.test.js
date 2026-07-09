import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeScreensaver } from "./screensaver.js";

const SCENE_KEY = "retro-note.screensaver-scene";
const IDLE = 1000; // 테스트용 짧은 유휴 시간

// localStorage 호환 fake — getItem 만 사용.
function fakeStorage(init = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) };
}

// 조작 가능한 시계 + show/hide 호출 기록을 갖춘 하네스.
function harness({ storage = fakeStorage(), idleMs = IDLE } = {}) {
  const h = { t: 0, shown: [], hidden: 0 };
  h.saver = makeScreensaver({
    idleMs,
    storage,
    now: () => h.t,
    show: (scene) => h.shown.push(scene),
    hide: () => h.hidden++,
  });
  return h;
}

describe("makeScreensaver: 유휴 판정", () => {
  test("idleMs 경과 전 check → 발동 안 함", () => {
    const h = harness();
    h.t = IDLE - 1;
    h.saver.check();
    assert.equal(h.saver.isActive(), false);
    assert.deepEqual(h.shown, []);
  });

  test("idleMs 경과 후 check → 발동(첫 장면 starfield)", () => {
    const h = harness();
    h.t = IDLE;
    h.saver.check();
    assert.equal(h.saver.isActive(), true);
    assert.deepEqual(h.shown, ["starfield"]);
  });

  test("비활성 중 입력은 타이머를 리셋한다", () => {
    const h = harness();
    h.t = IDLE - 1;
    assert.equal(h.saver.notifyActivity(), false); // 입력 소비 아님
    h.t = IDLE; // 입력 후 1ms — 아직 유휴 아님
    h.saver.check();
    assert.equal(h.saver.isActive(), false);
    h.t = IDLE - 1 + IDLE; // 입력 시점부터 idleMs 경과
    h.saver.check();
    assert.equal(h.saver.isActive(), true);
  });

  test("활성 중 입력 → 즉시 해제 + 입력 소비(true) + hide 호출", () => {
    const h = harness();
    h.t = IDLE;
    h.saver.check();
    assert.equal(h.saver.notifyActivity(), true);
    assert.equal(h.saver.isActive(), false);
    assert.equal(h.hidden, 1);
  });

  test("해제 직후 check 가 곧바로 재발동하지 않는다(타이머 리셋)", () => {
    const h = harness();
    h.t = IDLE;
    h.saver.check();
    h.saver.notifyActivity(); // 해제 — lastActivity 가 t=IDLE 로 리셋
    h.saver.check();
    assert.equal(h.saver.isActive(), false);
    h.t = IDLE * 2; // 해제 시점부터 다시 idleMs 경과
    h.saver.check();
    assert.equal(h.saver.isActive(), true);
  });

  test("활성 중 check/activate 는 no-op(중복 show 없음)", () => {
    const h = harness();
    h.t = IDLE;
    h.saver.check();
    h.t = IDLE * 3;
    h.saver.check();
    h.saver.activate();
    assert.equal(h.shown.length, 1);
  });
});

describe("makeScreensaver: 장면 선택(비교 기간 임시 정책)", () => {
  // 발동→해제를 한 사이클 돌리는 헬퍼
  const cycle = (h) => {
    h.t += IDLE;
    h.saver.check();
    h.saver.notifyActivity();
  };

  test("핀 없음 → starfield/matrix 교대", () => {
    const h = harness();
    cycle(h);
    cycle(h);
    cycle(h);
    assert.deepEqual(h.shown, ["starfield", "matrix", "starfield"]);
  });

  test("storage 핀 → 항상 같은 장면", () => {
    const h = harness({ storage: fakeStorage({ [SCENE_KEY]: "matrix" }) });
    cycle(h);
    cycle(h);
    assert.deepEqual(h.shown, ["matrix", "matrix"]);
  });

  test("잘못된 핀 값은 무시하고 교대", () => {
    const h = harness({ storage: fakeStorage({ [SCENE_KEY]: "banana" }) });
    cycle(h);
    cycle(h);
    assert.deepEqual(h.shown, ["starfield", "matrix"]);
  });

  test("activate 에 장면을 명시하면 그 장면을 쓰고 교대 기준도 갱신(미리보기 훅)", () => {
    const h = harness();
    h.saver.activate("matrix");
    h.saver.notifyActivity();
    cycle(h); // 직전이 matrix 였으므로 starfield
    assert.deepEqual(h.shown, ["matrix", "starfield"]);
  });

  test("activate 에 모르는 장면 이름 → 교대 정책으로 폴백", () => {
    const h = harness();
    h.saver.activate("banana");
    assert.deepEqual(h.shown, ["starfield"]);
  });
});
