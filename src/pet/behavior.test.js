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

// approach 가 끝나 상호작용이 종료될 때까지 tick 을 돌린다(테스트용 안전장치).
function runUntil(b, wanted, cap = 200) {
  let n = 0;
  while (b.getState().state !== wanted && n++ < cap) b.tick(100);
  return b.getState().state;
}

describe("펫 behavior — 쓰다듬기(stroke)", () => {
  test("stroke() 로 petting 이 되고 pettingMs 후 idle 로 복귀", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { pettingMs: 500 } });
    b.stroke();
    assert.equal(b.getState().state, "petting");
    b.tick(500);
    assert.equal(b.getState().state, "idle");
  });

  test("지속 알림 중 쓰다듬기: petting 재생 후 다시 놀람(react)으로 복귀", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { pettingMs: 500 } });
    b.setAlerting(true); // 놀람 고정
    b.stroke();
    assert.equal(b.getState().state, "petting");
    b.tick(500);
    assert.equal(b.getState().state, "react"); // 알림 여전 → 놀람 복귀
  });

  test("상호작용 중 react() 는 무시된다(방해 안 함)", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { pettingMs: 1000 } });
    b.stroke();
    b.react();
    assert.equal(b.getState().state, "petting");
  });
});

describe("펫 behavior — 먹이주기(feed)", () => {
  test("feed(tx) → 목표로 걸어가 eat 후 idle 로 복귀", () => {
    const b = makePetBehavior({
      rng: () => 0.5,
      config: { approachSpeed: 1, catchDist: 0.06, eatMs: 500, idleMin: 0, idleMax: 0 },
    });
    b.feed(0.9); // x=0.5 → 목표 0.9
    assert.equal(b.getState().state, "approach");
    assert.equal(runUntil(b, "eat"), "eat"); // 도달 → 먹기
    b.tick(500); // eat 만료
    assert.equal(b.getState().state, "idle");
  });
});

describe("펫 behavior — 장난치기(play)", () => {
  test("play(tx) → 다가가 leap(도약) → excited → idle", () => {
    const b = makePetBehavior({
      rng: () => 0.5,
      config: { approachSpeed: 1, catchDist: 0.06, leapMs: 300, excitedMs: 300, idleMin: 0, idleMax: 0 },
    });
    b.play(0.9);
    assert.equal(b.getState().state, "approach");
    assert.equal(runUntil(b, "leap"), "leap");
    b.tick(300); // leap 만료 → 신남
    assert.equal(b.getState().state, "excited");
    b.tick(300); // 신남 만료 → 복귀
    assert.equal(b.getState().state, "idle");
  });

  test("setTarget 으로 움직이는 공을 쫓다가 잡으면 leap", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { approachSpeed: 2, catchDist: 0.06 } });
    b.play(1.0); // 처음엔 오른쪽 끝을 목표
    // 공이 왼쪽으로 굴러가는 상황을 흉내: 매 tick 목표를 0 으로 갱신 → 펫이 쫓아가 잡음
    let n = 0;
    while (b.getState().state === "approach" && n++ < 200) {
      b.setTarget(0.0);
      b.tick(50);
    }
    assert.equal(b.getState().state, "leap");
  });

  test("제한시간 안에 공을 못 잡으면 포기하고 idle", () => {
    const b = makePetBehavior({
      rng: () => 0.5,
      config: { approachSpeed: 0.001, catchDist: 0, approachTimeoutMs: 200, idleMin: 0, idleMax: 0 },
    });
    b.play(1.0);
    b.tick(200); // 타임아웃
    assert.equal(b.getState().state, "idle");
  });
});

describe("펫 behavior — 쓰다듬기 심화(tier)", () => {
  test("tier 1/2/3 는 각각 petting / pettingHappy / pettingExcited", () => {
    const b = makePetBehavior({ rng: () => 0.5 });
    b.stroke(1);
    assert.equal(b.getState().state, "petting");
    b.stroke(2);
    assert.equal(b.getState().state, "pettingHappy");
    b.stroke(3);
    assert.equal(b.getState().state, "pettingExcited");
  });

  test("심화 상태도 pettingMs 후 idle 로 복귀", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { pettingMs: 400 } });
    b.stroke(3);
    b.tick(400);
    assert.equal(b.getState().state, "idle");
  });
});

describe("펫 behavior — 낚싯대(swat)", () => {
  test("swat → 다가가 pounce 후 신남 없이 바로 idle(재추격은 호출부 몫)", () => {
    const b = makePetBehavior({
      rng: () => 0.5,
      config: { approachSpeed: 1, catchDist: 0.06, pounceMs: 300, idleMin: 0, idleMax: 0 },
    });
    b.swat(0.9);
    assert.equal(runUntil(b, "pounce"), "pounce");
    b.tick(300); // pounce 만료 → excited 없이 idle
    assert.equal(b.getState().state, "idle");
  });

  test("이미 닿을 거리면 걷기 없이 바로 pounce(연타)", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { catchDist: 0.06 } });
    b.swat(0.52); // x=0.5 와의 거리 0.02 ≤ catchDist → approach 건너뛰고 즉시 pounce
    assert.equal(b.getState().state, "pounce");
  });
});

describe("펫 behavior — 스스로 하는 행동(chilling/dancing)", () => {
  test("idle 에서 chilling 으로 전이하고 시간이 지나면 idle 로 복귀", () => {
    const b = makePetBehavior({
      rng: seq([0, 0.8, 0]), // ctor idle(0) → chooseFromIdle=0.8(chill 구간) → chill duration
      config: { idleMin: 0, idleMax: 0, chillMin: 500, chillMax: 500 },
    });
    b.tick(10); // idle 만료 → chilling
    assert.equal(b.getState().state, "chilling");
    b.tick(500);
    assert.equal(b.getState().state, "idle");
  });

  test("idle 에서 dancing 으로 전이한다", () => {
    const b = makePetBehavior({
      rng: seq([0, 0.9, 0]), // 0.9 는 dance 구간(0.87~0.93)
      config: { idleMin: 0, idleMax: 0, danceMin: 500, danceMax: 500 },
    });
    b.tick(10);
    assert.equal(b.getState().state, "dancing");
  });

  test("지속 알림 중엔 스스로 행동으로 빠지지 않는다(놀람 고정)", () => {
    const b = makePetBehavior({ rng: seq([0, 0.8, 0]), config: { idleMin: 0, idleMax: 0 } });
    b.setAlerting(true);
    for (let i = 0; i < 50; i++) b.tick(1000);
    assert.equal(b.getState().state, "react");
  });
});

describe("펫 behavior — 상자(box)", () => {
  test("box() → boxed 상태로 들어가고 시간이 지나면 idle 로 복귀", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { boxMin: 500, boxMax: 500 } });
    b.box();
    assert.equal(b.getState().state, "boxed");
    b.tick(500);
    assert.equal(b.getState().state, "idle");
  });

  test("상자 안(boxed)은 상호작용이라 react() 로 방해받지 않는다", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { boxMin: 2000, boxMax: 2000 } });
    b.box();
    b.react();
    assert.equal(b.getState().state, "boxed");
  });
});

describe("펫 behavior — 상호작용 중 알림 교차(새 상태들)", () => {
  test("먹는 중 알림 도착: 먹기 안 끊기고, 끝난 뒤 idle 아닌 react 로 복귀", () => {
    const b = makePetBehavior({
      rng: () => 0.5,
      config: { approachSpeed: 1, catchDist: 0.06, eatMs: 500, idleMin: 0, idleMax: 0 },
    });
    b.feed(0.9);
    runUntil(b, "eat");
    b.setAlerting(true); // 상호작용 중이면 상태 안 바꾸고 플래그만
    assert.equal(b.getState().state, "eat"); // 먹기 유지
    b.tick(500); // eat 만료
    assert.equal(b.getState().state, "react"); // 알림 남음 → 놀람 복귀
  });

  test("장난치기 신남(excited) 중 알림: 끝난 뒤 react 로 복귀", () => {
    const b = makePetBehavior({
      rng: () => 0.5,
      config: { approachSpeed: 1, catchDist: 0.06, leapMs: 300, excitedMs: 300, idleMin: 0, idleMax: 0 },
    });
    b.play(0.9);
    runUntil(b, "excited");
    b.setAlerting(true);
    b.tick(300); // excited 만료
    assert.equal(b.getState().state, "react");
  });

  test("상자 놀이 중 알림: 나올 때 idle 아닌 react 로 복귀", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { boxMin: 500, boxMax: 500 } });
    b.box();
    b.setAlerting(true); // boxed 는 INTERACTION → 상태 유지
    assert.equal(b.getState().state, "boxed");
    b.tick(500); // boxed 만료
    assert.equal(b.getState().state, "react");
  });

  test("reset() 은 상호작용 상태를 idle 로 되돌린다(알림 없을 때)", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { boxMin: 9999, boxMax: 9999 } });
    b.box();
    b.reset();
    assert.equal(b.getState().state, "idle");
  });

  test("reset() 은 알림이 남아 있으면 react 로 되돌린다", () => {
    const b = makePetBehavior({ rng: () => 0.5, config: { eatMs: 9999 } });
    b.feed(0.5); // 같은 위치 → 즉시 approach
    b.setAlerting(true);
    b.reset();
    assert.equal(b.getState().state, "react");
  });
});
