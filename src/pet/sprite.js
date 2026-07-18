// 펫 스프라이트 애니메이션 매핑. 상태별 가로 스트립(프레임 64×64 정사각)을 background-position 으로 재생.
// 색 폴더(assets/pet/<catId>/)는 cats.js 카탈로그가 정한다. PNG 는 유료 에셋이라 레포 미포함.

// 상태(behavior.js) → 스트립 파일 · 프레임 수 · 재생 속도(fps). 6색 공통(모두 같은 격자에서 잘림).
export const ANIMATIONS = {
  idle: { img: "Idle.png", frames: 6, fps: 6 },
  walk: { img: "Running.png", frames: 6, fps: 9 },
  sleep: { img: "Sleeping.png", frames: 4, fps: 3 },
  react: { img: "Surprised.png", frames: 4, fps: 10 },
};

export function animKeyFor(state) {
  return ANIMATIONS[state] ? state : "idle";
}
