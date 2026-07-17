// 펫 스프라이트 규격 + 애니메이션 매핑.
// 아트: ToffeeCraft Cat Pack "Pochi"(유료). Pochi/Sprites/ 의 애니메이션별 가로 스트립을 쓴다.
// 모든 스트립은 높이 64px, 프레임 64×64 정사각. 파일 폭 ÷ 64 = 프레임 수.
// 시트/색을 바꾸려면 여기 상수만 고치면 된다(코드 다른 곳 불변). 파일은 src/assets/pet/ 에 로컬 배치.

// 프레임 픽셀 크기(정사각). 렌더는 background-size 퍼센트라 해상도 독립이지만, 규격 기록용.
export const FRAME = 64;

// 펫 상태(behavior.js) → 스트립 파일 + 프레임 수 + 재생 속도(fps).
//   idle:  기본(호흡/앉기)      walk:  이동(느리게 재생하면 걷기 느낌)
//   sleep: Zzz                  react: 새 메시지 놀람
export const ANIMATIONS = {
  idle: { img: "Idle.png", frames: 6, fps: 6 },
  walk: { img: "Running.png", frames: 6, fps: 9 },
  sleep: { img: "Sleeping.png", frames: 4, fps: 3 },
  react: { img: "Surprised.png", frames: 4, fps: 10 },
};

// behavior 상태명 → 애니 키. walk 는 그대로, 나머지도 동일 이름.
export function animKeyFor(state) {
  return ANIMATIONS[state] ? state : "idle";
}
