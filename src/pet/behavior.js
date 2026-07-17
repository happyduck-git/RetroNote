// 펫 행동 상태 머신 — 순수 로직(DOM/타이머/rAF 없음).
// 정규화 위치 x ∈ [0,1] 과 상태(idle/walk/sleep/react), 방향(facing)만 관리한다.
// tick(dtMs) 로 시간을 밀어 넣고, rng 를 주입받아 결정론적으로 테스트한다.

// 기본 상수(모두 튜닝 가능). ms 단위.
const DEFAULTS = {
  idleMin: 1000,
  idleMax: 3000,
  walkMin: 800,
  walkMax: 2500,
  sleepMin: 5000,
  sleepMax: 12000,
  reactMs: 1200,
  walkSpeed: 0.16, // 초당 정규화 x 이동량(0~1 폭 기준)
  pWalk: 0.6, // idle 다음이 walk 일 확률
  pSleep: 0.15, // idle 다음이 sleep 일 확률 (나머지는 idle 유지)
};

export function makePetBehavior({ rng = Math.random, config = {} } = {}) {
  const C = { ...DEFAULTS, ...config };

  let state = "idle";
  let x = 0.5;
  let facing = "right"; // 스프라이트 원본 방향(오른쪽) 기준
  let elapsed = 0;
  let duration = pick(C.idleMin, C.idleMax);
  let alerting = false; // 안 읽은 메시지가 있는 동안 놀람 상태로 고정

  function pick(lo, hi) {
    return lo + rng() * (hi - lo);
  }

  function enterIdle() {
    state = "idle";
    elapsed = 0;
    duration = pick(C.idleMin, C.idleMax);
  }

  function enterWalk() {
    state = "walk";
    elapsed = 0;
    duration = pick(C.walkMin, C.walkMax);
    facing = rng() < 0.5 ? "left" : "right";
  }

  function enterSleep() {
    state = "sleep";
    elapsed = 0;
    duration = pick(C.sleepMin, C.sleepMax);
  }

  function chooseFromIdle() {
    const r = rng();
    if (r < C.pWalk) enterWalk();
    else if (r < C.pWalk + C.pSleep) enterSleep();
    else enterIdle();
  }

  function tick(dtMs) {
    if (!(dtMs > 0)) return;
    // 지속 알림 중엔 놀람 상태로 고정: 이동·상태 전이 없음(프레임 애니는 렌더 루프가 계속 돌린다).
    if (alerting) return;
    elapsed += dtMs;

    if (state === "walk") {
      const dir = facing === "left" ? -1 : 1;
      x += dir * C.walkSpeed * (dtMs / 1000);
      if (x <= 0) {
        x = 0;
        facing = "right";
      } else if (x >= 1) {
        x = 1;
        facing = "left";
      }
    }

    if (elapsed < duration) return;

    switch (state) {
      case "idle":
        chooseFromIdle();
        break;
      case "walk":
        enterIdle();
        break;
      case "sleep":
        enterIdle();
        break;
      case "react":
        enterIdle();
        break;
      default:
        enterIdle();
    }
  }

  // 일시 반응(one-shot). sleep 이어도 즉시 깨우고, 지속 알림 중이면 이미 놀람이라 무시.
  function react() {
    if (alerting) return;
    if (state === "react") return;
    state = "react";
    elapsed = 0;
    duration = C.reactMs;
  }

  // 안 읽음이 남아있는 동안 놀람 고정, 확인하면 해제해 일상 동작으로 복귀.
  function setAlerting(on) {
    const next = !!on;
    if (next === alerting) return;
    alerting = next;
    if (alerting) {
      state = "react";
      elapsed = 0;
    } else {
      enterIdle();
    }
  }

  function getState() {
    return { state, x, facing };
  }

  return { tick, react, setAlerting, getState };
}
