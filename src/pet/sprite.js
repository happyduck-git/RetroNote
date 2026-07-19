// 펫 스프라이트 애니메이션 매핑. 상태별 가로 스트립(프레임 64×64 정사각)을 background-position 으로 재생.
// 색 폴더(assets/pet/<catId>/)는 cats.js 카탈로그가 정한다. PNG 는 유료 에셋이라 레포 미포함.

// 상태(behavior.js) → 스트립 파일 · 프레임 수 · 재생 속도(fps). 6색 공통(모두 같은 격자에서 잘림).
export const ANIMATIONS = {
  idle: { img: "Idle.png", frames: 6, fps: 6 },
  walk: { img: "Running.png", frames: 6, fps: 9 },
  sleep: { img: "Sleeping.png", frames: 4, fps: 3 },
  react: { img: "Surprised.png", frames: 4, fps: 10 },
  chilling: { img: "Chilling.png", frames: 8, fps: 6 }, // 스스로: 꼬리 흔들며 쉼
  dancing: { img: "Dance.png", frames: 4, fps: 8 }, // 스스로: 만세 춤
  // 상호작용 반응(우클릭 메뉴/펫 직접 클릭). 프레임 수 = 스트립 실제 폭 ÷ 64.
  petting: { img: "Tickle.png", frames: 4, fps: 8 }, // 쓰다듬기(약)
  eat: { img: "Happy.png", frames: 10, fps: 10 }, // 먹이주기 / 쓰다듬기(중)
  leap: { img: "Jump.png", frames: 12, fps: 15 }, // 장난치기 공에 뛰어들기
  pounce: { img: "Attack.png", frames: 7, fps: 14 }, // 낚싯대 깃털 할퀴기
  excited: { img: "Excited.png", frames: 3, fps: 10 }, // 잡은 뒤 신남 / 쓰다듬기(강)
  boxed: { img: "Box1.png", frames: 12, fps: 8 }, // 상자에 쏙 들어가 놀기
};

// 늘 존재해야 하는 "일상/스스로" 애니 — 창을 띄우기 전 선로드해 그 상태에서 투명 창이 안 뜨게 한다.
// 상호작용 스트립은 제외한다: 없어도 펫은 보여야 하므로 표시 게이팅에 넣지 않고 첫 사용 시 로드.
export const AMBIENT_ANIM_KEYS = ["idle", "walk", "sleep", "react", "chilling", "dancing"];

// 상태 이름 → 애니 키. approach(목표로 걸어감)는 walk 를, 쓰다듬기 심화는 Happy/Excited 스트립을 재사용.
const STATE_TO_ANIM = {
  idle: "idle",
  walk: "walk",
  approach: "walk",
  sleep: "sleep",
  react: "react",
  chilling: "chilling",
  dancing: "dancing",
  petting: "petting",
  pettingHappy: "eat",
  pettingExcited: "excited",
  eat: "eat",
  leap: "leap",
  pounce: "pounce",
  excited: "excited",
  boxed: "boxed",
};

export function animKeyFor(state) {
  return STATE_TO_ANIM[state] || "idle";
}
