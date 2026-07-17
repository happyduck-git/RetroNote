// 펫 행동 상태 머신 단위 테스트. rng 를 주입해 결정론적으로 검증한다(실시간 타이머 없음).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makePetBehavior } from "./behavior.js";

// 정해진 순서로 값을 돌려주는 rng(마지막 값 이후로는 그 값을 반복).
function seq(values) {
  let i = 0;
  return () => {
    const v = values[Math.min(i, values.length - 1)];
    i++;
    return v;
  };
}

describe("펫 behavior — 초기 상태", () => {
  test("idle 로 시작하고 화면 중앙(x=0.5), 오른쪽을 본다", () => {
    const b = makePetBehavior({ rng: () => 0.5 });
    assert.deepEqual(b.getState(), { state: "idle", x: 0.5, facing: "right" });
  });
});

describe("펫 behavior — react(새 메시지 반응)", () => {
  test("react() 로 react 상태가 되고, reactMs 경과 후 idle 로 복귀", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { reactMs: 1200 } });
    b.react();
    assert.equal(b.getState().state, "react");
    b.tick(1200);
    assert.equal(b.getState().state, "idle");
  });

  test("이미 react 중이면 재트리거를 무시한다(디바운스: 경과가 리셋되지 않음)", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { reactMs: 1200 } });
    b.react();
    b.tick(600); // 절반 경과
    b.react(); // 무시되어야 함 → 경과 유지
    b.tick(600); // 합계 1200 → 만료
    assert.equal(b.getState().state, "idle");
  });

  test("sleep 중에도 react 로 즉시 깨어난다", () => {
    // idle(0) → chooseFromIdle 에서 sleep 선택되도록 rng 배열 구성.
    // ctor pick(idle 0) → choose(>=pWalk+pSleep? no: sleep 구간) → sleep duration.
    const b = makePetBehavior({
      rng: seq([0, 0.7, 0]), // 0.7 은 pWalk(0.6)~pWalk+pSleep(0.75) 구간 → sleep
      config: { idleMin: 0, idleMax: 0, sleepMin: 9999, sleepMax: 9999 },
    });
    b.tick(10); // idle 만료 → sleep 진입
    assert.equal(b.getState().state, "sleep");
    b.react();
    assert.equal(b.getState().state, "react");
  });
});

describe("펫 behavior — setAlerting(지속 알림: 확인 전까지 놀람 유지)", () => {
  test("setAlerting(true) 면 react 로 고정되고, 시간이 지나도 idle 로 안 빠진다", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { reactMs: 1200 } });
    b.setAlerting(true);
    assert.equal(b.getState().state, "react");
    for (let i = 0; i < 100; i++) b.tick(1000); // 오래 지나도
    assert.equal(b.getState().state, "react"); // 계속 놀람
  });

  test("setAlerting(false) 면 놀람이 풀리고 idle 로 복귀한다", () => {
    const b = makePetBehavior({ rng: () => 0.5 });
    b.setAlerting(true);
    b.setAlerting(false);
    assert.equal(b.getState().state, "idle");
  });

  test("지속 알림 중에는 위치(x)가 움직이지 않는다", () => {
    const b = makePetBehavior({ rng: () => 0.5 });
    const x0 = b.getState().x;
    b.setAlerting(true);
    for (let i = 0; i < 50; i++) b.tick(100);
    assert.equal(b.getState().x, x0); // 고정
  });

  test("지속 알림 중 react() 는 무시된다(이미 놀람)", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { reactMs: 1200 } });
    b.setAlerting(true);
    b.react();
    b.tick(5000); // react one-shot 이었다면 풀렸을 시간
    assert.equal(b.getState().state, "react"); // 여전히 놀람(지속 알림 우선)
  });
});

describe("펫 behavior — walk 이동/경계", () => {
  test("walk 중 오른쪽 경계 도달 시 x 는 1 로 clamp 되고 facing 이 뒤집힌다", () => {
    const b = makePetBehavior({
      // ctor idle duration(0) / chooseFromIdle=0.1(<0.6 → walk) / walk duration(무한) / facing 0.9(>=0.5 → right)
      rng: seq([0, 0.1, 0, 0.9]),
      config: {
        idleMin: 0,
        idleMax: 0,
        walkMin: 100000,
        walkMax: 100000,
        walkSpeed: 2, // 초당 정규화 2 → 1초면 경계 초과
      },
    });
    b.tick(10); // idle 만료 → walk(오른쪽) 진입
    assert.equal(b.getState().state, "walk");
    assert.equal(b.getState().facing, "right");

    b.tick(1000); // x += 2 → clamp 1, facing 반전
    const s = b.getState();
    assert.equal(s.x, 1);
    assert.equal(s.facing, "left");
  });

  test("x 는 항상 [0,1] 범위를 벗어나지 않는다", () => {
    const b = makePetBehavior({
      rng: seq([0, 0.1, 0, 0.1]), // walk, facing left(0.1<0.5)
      config: {
        idleMin: 0,
        idleMax: 0,
        walkMin: 100000,
        walkMax: 100000,
        walkSpeed: 5,
      },
    });
    b.tick(10); // walk(왼쪽) 진입
    for (let i = 0; i < 20; i++) b.tick(100);
    const { x } = b.getState();
    assert.ok(x >= 0 && x <= 1, `x 가 범위를 벗어남: ${x}`);
  });
});
