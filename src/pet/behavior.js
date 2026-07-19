// 펫 행동 상태 머신 — 순수 로직(DOM/타이머/rAF 없음).
// 정규화 위치 x ∈ [0,1] 과 상태, 방향(facing)만 관리한다.
// tick(dtMs) 로 시간을 밀어 넣고, rng 를 주입받아 결정론적으로 테스트한다.
//
// 스스로 하는 행동(사용자 조작 없이 idle 에서 확률로): walk / sleep / chilling / dancing
// 상호작용 상태(사용자가 만짐):
//   petting/pettingHappy/pettingExcited  쓰다듬기(연속으로 만질수록 세짐)
//   approach 밥/장난감 목표 x 로 걸어감 → 닿으면 eat 또는 pounce
//   eat      먹는 중(제자리)
//   pounce   덮치기 → pounceThen 에 따라 excited(공) 또는 즉시 종료(낚싯대)
//   excited  잡은 뒤 신남

// 기본 상수(모두 튜닝 가능). ms 단위.
const DEFAULTS = {
  // 혼자 있을 때 한 동작이 유지되는 시간(ms).
  idleMin: 8000,
  idleMax: 24000,
  walkMin: 6400,
  walkMax: 20000,
  sleepMin: 40000,
  sleepMax: 96000,
  reactMs: 1200,
  walkSpeed: 0.16, // 초당 정규화 x 이동량(0~1 폭 기준)
  pWalk: 0.6, // idle 다음이 walk 일 확률
  pSleep: 0.15, // idle 다음이 sleep 일 확률
  pChill: 0.12, // idle 다음이 chilling(쉼)
  pDance: 0.06, // idle 다음이 dancing(춤) — 나머지는 idle 유지
  chillMin: 24000,
  chillMax: 48000,
  danceMin: 12000,
  danceMax: 24000,
  // 상호작용
  pettingMs: 2800, // 쓰다듬기 재생 시간
  approachSpeed: 0.5, // 밥/장난감으로 다가가는 속도(초당 정규화, 평소 걸음보다 빠름)
  approachTimeoutMs: 7000, // 움직이는 목표를 이 시간 안에 못 잡으면 포기
  catchDist: 0.06, // 목표와 이 거리 안으로 들어오면 "닿음". 한 tick 최대 이동보다 커야 통과 방지.
  eatMs: 1800,
  leapMs: 800, // 장난치기: 공에 뛰어드는 도약(Jump) 시간
  pounceMs: 650, // 낚싯대: 깃털 할퀴기(Attack) 시간
  excitedMs: 1300,
  boxMin: 6000, // 상자 속에서 노는 시간
  boxMax: 12000,
};

// 사용자 상호작용 중인 상태 — 지속 알림(alerting)에 얼리지 않고 흐름을 진행시킨다.
// chilling/dancing 은 "스스로" 행동이라 여기 없다(알림이 뜨면 멈추고 놀람으로).
const INTERACTION_STATES = new Set([
  "petting",
  "pettingHappy",
  "pettingExcited",
  "approach",
  "eat",
  "leap",
  "pounce",
  "excited",
  "boxed",
]);

export function makePetBehavior({ rng = Math.random, config = {} } = {}) {
  const C = { ...DEFAULTS, ...config };

  let state = "idle";
  let x = 0.5;
  let facing = "right"; // 스프라이트 원본 방향(오른쪽) 기준
  let elapsed = 0;
  let duration = pick(C.idleMin, C.idleMax);
  let alerting = false; // 안 읽은 메시지가 있는 동안 놀람 상태로 고정
  let target = 0.5; // approach 목표 x
  let actionTag = null; // approach 도착 후 할 것: "eat" | "pounce"
  let pounceThen = null; // pounce 뒤: "excited"(공) | "idle"(낚싯대)

  function pick(lo, hi) {
    return lo + rng() * (hi - lo);
  }

  function clamp01(v) {
    return v < 0 ? 0 : v > 1 ? 1 : v;
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

  function enterChill() {
    state = "chilling";
    elapsed = 0;
    duration = pick(C.chillMin, C.chillMax);
  }

  function enterDance() {
    state = "dancing";
    elapsed = 0;
    duration = pick(C.danceMin, C.danceMax);
  }

  function chooseFromIdle() {
    const r = rng();
    if (r < C.pWalk) enterWalk();
    else if (r < C.pWalk + C.pSleep) enterSleep();
    else if (r < C.pWalk + C.pSleep + C.pChill) enterChill();
    else if (r < C.pWalk + C.pSleep + C.pChill + C.pDance) enterDance();
    else enterIdle();
  }

  // 상호작용이 끝나면: 아직 안 읽은 알림이 있으면 놀람으로 복귀, 아니면 일상(idle).
  function returnFromInteraction() {
    if (alerting) {
      state = "react";
      elapsed = 0;
    } else {
      enterIdle();
    }
  }

  function enterAction(tag) {
    state = tag; // "eat"(밥) | "leap"(공 도약) | "pounce"(깃털 할퀴기)
    duration = tag === "eat" ? C.eatMs : tag === "leap" ? C.leapMs : C.pounceMs;
    elapsed = 0;
  }

  function enterExcited() {
    state = "excited";
    elapsed = 0;
    duration = C.excitedMs;
  }

  function tick(dtMs) {
    if (!(dtMs > 0)) return;

    const interacting = INTERACTION_STATES.has(state);
    // 지속 알림 중엔 놀람 고정 — 단, 사용자 상호작용 중이면 그 흐름은 계속 진행시킨다.
    if (alerting && !interacting) return;

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
    } else if (state === "approach") {
      // 목표(밥=고정 / 공·쥐·깃털=매 tick setTarget 갱신)로 걸어감.
      const dist = target - x;
      if (Math.abs(dist) <= C.catchDist) {
        enterAction(actionTag); // 닿음 → 먹기/덮치기
        return;
      }
      facing = dist < 0 ? "left" : "right";
      x = clamp01(x + (dist < 0 ? -1 : 1) * C.approachSpeed * (dtMs / 1000));
      if (elapsed >= duration) returnFromInteraction(); // 타임아웃(놓침) → 포기
      return; // approach 는 위에서만 전이(아래 만료 스위치 건너뜀)
    }

    if (elapsed < duration) return;

    switch (state) {
      case "idle":
        chooseFromIdle();
        break;
      case "walk":
      case "sleep":
      case "chilling":
      case "dancing":
      case "react":
        enterIdle();
        break;
      case "petting":
      case "pettingHappy":
      case "pettingExcited":
      case "eat":
      case "boxed":
        returnFromInteraction();
        break;
      case "leap": // 공에 도약
      case "pounce": // 깃털 할퀴기
        if (pounceThen === "excited") enterExcited(); // 공: 잡은 뒤 신남
        else returnFromInteraction(); // 낚싯대: 바로 종료(재추격은 호출부가 다시 swat)
        break;
      case "excited":
        returnFromInteraction();
        break;
      default:
        enterIdle();
    }
  }

  // 일시 반응(one-shot). sleep/chilling 이어도 즉시 깨우고, 지속 알림/상호작용 중이면 방해하지 않는다.
  function react() {
    if (alerting) return;
    if (INTERACTION_STATES.has(state)) return; // 상호작용 중엔 무시
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
    // 상호작용 중이면 상태를 바꾸지 않는다 → 끝날 때 returnFromInteraction 이 알림 여부를 반영.
    if (INTERACTION_STATES.has(state)) return;
    if (alerting) {
      state = "react";
      elapsed = 0;
    } else {
      enterIdle();
    }
  }

  // 펫 직접 클릭 → 쓰다듬기. 연속으로 만질수록 tier 가 올라가 반응이 커진다(호출부가 tier 계산).
  // 지속 알림 중에도 가능(끝나면 알림 상태로 되돌아감).
  function stroke(tier = 1) {
    state = tier >= 3 ? "pettingExcited" : tier >= 2 ? "pettingHappy" : "petting";
    elapsed = 0;
    duration = C.pettingMs;
  }

  function startApproach(tx, tag, then) {
    state = "approach";
    actionTag = tag;
    pounceThen = then;
    target = clamp01(tx);
    elapsed = 0;
    duration = C.approachTimeoutMs;
  }

  // 밥 주기: 목표 x 로 걸어가 먹는다.
  function feed(tx) {
    startApproach(tx, "eat", null);
  }

  // 장난감(공/쥐): 목표로 쫓아가 도약(Jump)으로 덮치고 신남. setTarget 으로 위치를 계속 갱신.
  function play(tx) {
    startApproach(tx, "leap", "excited");
  }

  // 낚싯대: 목표(커서)로 다가가 툭 침. 호출부가 매번 다시 swat 해 끝없이 논다.
  // 이미 닿을 거리면 걷기(approach)를 건너뛰고 바로 덮쳐 → 커서가 가까울 때 Attack 만
  // 이어지고(같은 pounce 라 프레임 유지) 달리기 같은 다른 장면이 끼어들지 않는다.
  function swat(tx) {
    const t = clamp01(tx);
    if (Math.abs(t - x) <= C.catchDist) {
      target = t;
      actionTag = "pounce";
      pounceThen = "idle";
      enterAction("pounce");
    } else {
      startApproach(t, "pounce", "idle");
    }
  }

  // 움직이는 목표(공/쥐/깃털) 추적 — approach 중에만 목표를 갱신한다.
  function setTarget(tx) {
    if (state === "approach") target = clamp01(tx);
  }

  // 상자에 쏙 들어가 논다(메뉴). 일정 시간 후 나온다.
  function box() {
    state = "boxed";
    elapsed = 0;
    duration = pick(C.boxMin, C.boxMax);
  }

  function getState() {
    return { state, x, facing };
  }

  return { tick, react, setAlerting, getState, stroke, feed, play, swat, setTarget, box };
}
