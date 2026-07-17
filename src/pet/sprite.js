// 펫 스프라이트 애니메이션 매핑. 상태별 가로 스트립(프레임 64×64 정사각)을 background-position 으로 재생.
// 시트/색 교체는 여기 상수만 고치면 된다. PNG 는 src/assets/pet/ 에 로컬 배치(레포 미포함).

export const FRAME = 64;

// 상태(behavior.js) → 스트립 파일 · 프레임 수 · 재생 속도(fps).
export const ANIMATIONS = {
  idle: { img: "Idle.png", frames: 6, fps: 6 },
  walk: { img: "Running.png", frames: 6, fps: 9 },
  sleep: { img: "Sleeping.png", frames: 4, fps: 3 },
  react: { img: "Surprised.png", frames: 4, fps: 10 },
};

export function animKeyFor(state) {
  return ANIMATIONS[state] ? state : "idle";
}
