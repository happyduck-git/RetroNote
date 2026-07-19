// 펫 창(pet.html)의 진입 모듈 — DOM 생성 + rAF 렌더 루프 + 창 드래그/제거 + 브리지 이벤트 수신.
// 펫은 "저장된 선택(pet-cat pref)"의 순수 투영: 스스로 show/hide 하지 않고 pet:set-cat 에만 반응
// (우클릭 제거도 pref 왕복) → 유령창/부활 버그 차단.
import { el } from "../core/dom.js";
import { makePetBehavior } from "./behavior.js";
import { makePetDisplayController } from "./pet-display.js";
import { assetBaseFor, normalizeCat } from "./cats.js";
import { ANIMATIONS, AMBIENT_ANIM_KEYS, animKeyFor } from "./sprite.js";

// 장난감/밥 에셋(유료, gitignore). 경로는 문서(pet.html) 기준 상대 — 펫 스프라이트와 동일 방식.
// 추격 장난감(장난치기에서 랜덤): 공 3색 + 쥐. 쥐는 좀 더 빠르게 움직여 "사냥" 느낌.
const CHASE_TOYS = [
  { src: "assets/toys/ball-blue.gif", speed: 0.55 },
  { src: "assets/toys/ball-orange.gif", speed: 0.55 },
  { src: "assets/toys/ball-pink.gif", speed: 0.55 },
  { src: "assets/toys/mouse.gif", speed: 0.85 },
];
// 음식(먹이주기에서 랜덤): 사료(1칸) / 생선(2×2 격자) / 밥그릇(2×2 격자).
// 격자 시트는 background-position 으로 한 칸만 보여준다(색까지 랜덤 → 파일 3개로 9가지).
const FOODS = [
  { src: "assets/toys/food-catfood.png", cols: 1, rows: 1 },
  { src: "assets/toys/food-fish.png", cols: 2, rows: 2 },
  { src: "assets/toys/food-bowl.png", cols: 2, rows: 2 },
];
const FEATHER_SRC = "assets/toys/feather.gif"; // 낚싯대(커서 추적)
const DRAG_THRESHOLD = 4; // px — 이보다 움직이면 창 드래그, 아니면 클릭(쓰다듬기)
const PET_ESCALATE_MS = 2500; // 이 시간 안에 다시 쓰다듬으면 강도 누적, 지나면 리셋
const BALL_FRICTION = 0.3; // 장난감 감속(초당 정규화 속도 감소) → 점점 느려져 고양이가 추월해 잡음
const TOY_START_GAP = 0.15; // 고양이 앞 이만큼 떨어진 곳에서 출발(즉시 잡힘 방지)
const randOf = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Tauri 전역(withGlobalTauri). 브라우저 단독 실행에선 없으므로 옵셔널 접근.
const T = typeof window !== "undefined" ? window.__TAURI__ : undefined;
const getCurrentWindow = T?.window?.getCurrentWindow;
const evapi = T?.event;
const LogicalSize = T?.window?.LogicalSize;

// 리사이즈 클램프 — tauri.conf.json 의 pet 창 min/max 와 동기화(빌드 스텝 없어 손으로 맞춤).
const PET_MIN = { w: 140, h: 130 };
const PET_MAX = { w: 400, h: 360 };

function buildDom() {
  const dot = el("div", { class: "pet-dot", hidden: true });
  const pet = el("div", { class: "pet" }, [dot]);
  // 바닥에 놓이는 상호작용 아이템(기본 숨김): 굴러다니는 공/쥐 · 밥(둘 다 배경이미지 div).
  const ball = el("div", { class: "pet-toy", hidden: true });
  const food = el("div", { class: "pet-food", hidden: true });
  // 낚싯대 깃털(커서를 따라다님, 기본 숨김).
  const feather = el("div", { class: "pet-feather", hidden: true });
  // 하트 파티클 레이어(쓰다듬기).
  const hearts = el("div", { class: "pet-hearts" });
  // 우클릭 메뉴(기본 숨김). 쓰다듬기는 펫 직접 클릭이라 메뉴엔 없음.
  const feedBtn = el("button", { class: "pet-menu-item", type: "button", text: "Feed" });
  const playBtn = el("button", { class: "pet-menu-item", type: "button", text: "Play" });
  const wandBtn = el("button", { class: "pet-menu-item", type: "button", text: "Wand" });
  const boxBtn = el("button", { class: "pet-menu-item", type: "button", text: "Box" });
  const removeBtn = el("button", { class: "pet-menu-item", type: "button", text: "Remove pet" });
  const menu = el("div", { class: "pet-menu", hidden: true }, [feedBtn, playBtn, wandBtn, boxBtn, removeBtn]);
  // 투명 창을 드래그로 리사이즈하는 손잡이(우하단 코너).
  const grip = el("div", { class: "pet-resize", title: "Drag to resize" });
  const stage = el("div", { class: "pet-stage" }, [pet, ball, food, feather, hearts, menu, grip]);
  document.body.append(stage);
  return { stage, pet, dot, ball, food, feather, hearts, menu, feedBtn, playBtn, wandBtn, boxBtn, removeBtn, grip };
}

export function initPetWindow() {
  const { stage, pet, dot, ball, food, feather, hearts, menu, feedBtn, playBtn, wandBtn, boxBtn, removeBtn, grip } =
    buildDom();
  const behavior = makePetBehavior({});

  // 깃털 배경 지정 + 장난감/음식/깃털 GIF·PNG 캐시 예열(숨김 요소 배경이라 로드가 지연될 수 있음).
  feather.style.backgroundImage = `url(${FEATHER_SRC})`;
  [...CHASE_TOYS.map((t) => t.src), ...FOODS.map((f) => f.src), FEATHER_SRC].forEach((src) => {
    new Image().src = src;
  });

  // 브리지로 받는 상태(빨간 점 게이팅).
  let unread = 0;
  let mainFocused = true;

  // 현재 색의 에셋 경로. null = 표시할 스프라이트 없음(none/미로드).
  let assetBase = null;

  // curBase: 같은 애니라도 색(assetBase)이 바뀌면 재적용을 감지하려고 둔다.
  let curKey = null;
  let curBase = null;
  let curAnim = ANIMATIONS.idle;
  let frame = 0;
  let frameElapsed = 0;

  function setAnim(key) {
    if (!assetBase) return; // 색 없음 → url(null) 방지
    if (key === curKey && assetBase === curBase) return;
    curKey = key;
    curBase = assetBase;
    curAnim = ANIMATIONS[key] || ANIMATIONS.idle;
    frame = 0;
    frameElapsed = 0;
    pet.style.backgroundImage = `url(${assetBase}${curAnim.img})`;
    // 스트립 폭 = 프레임수 × 요소폭 → background-position-x 퍼센트로 프레임을 고른다(해상도 독립).
    pet.style.backgroundSize = `${curAnim.frames * 100}% 100%`;
    drawFrame();
  }

  function drawFrame() {
    const n = curAnim.frames;
    const posX = n > 1 ? (frame / (n - 1)) * 100 : 0;
    pet.style.backgroundPositionX = `${posX}%`;
  }

  function updateDot() {
    dot.hidden = !(unread > 0 && !mainFocused);
  }

  // --- 상호작용 아이템/모드 — 한 번에 하나만 ---
  let ballActive = false;
  let ballX = 0; // 정규화 위치(0~1)
  let ballVx = 0; // 정규화 속도(초당)
  let ballSpeed = 0; // 이번 장난감 속도(공/쥐 다름)
  let foodActive = false;
  let wandActive = false;

  // 커서(낚싯대·하트 위치용). stage 는 창 전체(0,0)라 clientX/Y 를 그대로 쓴다.
  let cursorX = 0; // clientX
  let cursorY = 0; // clientY
  let cursorNX = 0.5; // 펫 좌표계로 환산한 정규화 x

  const itemBusy = () => ballActive || foodActive || wandActive;

  // 아이템을 창 폭에 맞춰 바닥의 nx(0~1) 위치에 놓는다(스프라이트 폭만큼 범위 축소).
  function placeItem(elm, nx) {
    const range = Math.max(0, stage.clientWidth - elm.offsetWidth);
    elm.style.transform = `translateX(${nx * range}px)`;
  }
  // 추격 장난감은 진행 방향으로 좌우 반전(공은 대칭이라 무해, 쥐는 바라보는 방향).
  function placeToy(nx, vx) {
    const range = Math.max(0, stage.clientWidth - ball.offsetWidth);
    ball.style.transform = `translateX(${nx * range}px) scaleX(${vx < 0 ? -1 : 1})`;
  }

  // 장난치기: 공(3색)/쥐 중 랜덤. 고양이 근처에서 빈 쪽으로 굴러 나가고, 마찰로 점점 느려진다
  // → 고양이가 뒤에서 따라잡아 도약(Jump)으로 덮침.
  function spawnToy() {
    if (!assetBase || itemBusy()) return;
    const toy = randOf(CHASE_TOYS);
    ball.style.backgroundImage = `url(${toy.src})`;
    ballSpeed = toy.speed;
    const petX = behavior.getState().x;
    const dir = petX < 0.5 ? 1 : -1; // 여유 있는(먼) 쪽으로 굴려보냄
    ballX = Math.max(0, Math.min(1, petX + dir * TOY_START_GAP));
    ballVx = dir * ballSpeed;
    ballActive = true;
    ball.hidden = false;
    placeToy(ballX, ballVx);
    behavior.play(ballX);
  }
  function clearBall() {
    ballActive = false;
    ball.hidden = true;
  }

  // 먹이주기: 사료/생선/밥그릇 중 랜덤 + 격자 시트면 한 칸(색)도 랜덤.
  function spawnFood() {
    if (!assetBase || itemBusy()) return;
    const f = randOf(FOODS);
    const cx = Math.floor(Math.random() * f.cols);
    const cy = Math.floor(Math.random() * f.rows);
    food.style.backgroundImage = `url(${f.src})`;
    food.style.backgroundSize = `${f.cols * 100}% ${f.rows * 100}%`;
    food.style.backgroundPositionX = f.cols > 1 ? `${(cx / (f.cols - 1)) * 100}%` : "0%";
    food.style.backgroundPositionY = f.rows > 1 ? `${(cy / (f.rows - 1)) * 100}%` : "0%";
    const nx = Math.random(); // 바닥 임의 위치
    foodActive = true;
    food.hidden = false;
    placeItem(food, nx);
    behavior.feed(nx);
  }
  function clearFood() {
    foodActive = false;
    food.hidden = true;
  }

  // 상자: 고양이가 상자에 쏙 들어가 논다(별도 DOM 없음, 상자는 스프라이트에 그려져 있음).
  function tryBox() {
    if (!assetBase || itemBusy()) return;
    behavior.box();
  }

  // --- 낚싯대(깃털이 커서를 따라다니고 펫이 끝없이 쫓아 툭 침) ---
  function positionFeather() {
    feather.style.transform = `translate(${cursorX - feather.offsetWidth / 2}px, ${
      cursorY - feather.offsetHeight / 2
    }px)`;
  }
  function startWand() {
    if (!assetBase || itemBusy()) return;
    wandActive = true;
    feather.hidden = false;
    wandBtn.textContent = "Stop wand";
    positionFeather();
    behavior.swat(cursorNX); // 첫 추격 시작
  }
  function endWand() {
    if (!wandActive) return;
    wandActive = false;
    feather.hidden = true;
    wandBtn.textContent = "Wand";
    // 진행 중이던 추격은 자연히 끝나 idle 로 복귀(강제 전이 없음).
  }

  // 매 프레임 아이템 갱신. 공/쥐는 굴러가며 벽에서 튕기고 펫이 추적. 낚싯대는 끝나면 다시 추격.
  function updateItems(dt, state) {
    if (ballActive) {
      if (state !== "approach") {
        clearBall(); // 도약(leap)·타임아웃 등으로 approach 를 벗어남 → 장난감 사라짐
      } else {
        // 마찰로 감속(선형). 아주 느려지면 멈춰(0) 고양이가 다가와 덮치게 둔다.
        const sp = Math.max(0, Math.abs(ballVx) - BALL_FRICTION * (dt / 1000));
        ballVx = ballVx < 0 ? -sp : sp;
        ballX += ballVx * (dt / 1000);
        if (ballX <= 0) {
          ballX = 0;
          ballVx = Math.abs(ballVx);
        } else if (ballX >= 1) {
          ballX = 1;
          ballVx = -Math.abs(ballVx);
        }
        behavior.setTarget(ballX);
        placeToy(ballX, ballVx);
      }
    }
    if (foodActive && state !== "approach" && state !== "eat") {
      clearFood(); // 다 먹음(eat 종료) → 밥 사라짐
    }
    // 낚싯대 재추격은 루프 상단(렌더 전)에서 처리한다 — idle 프레임 깜빡임 방지.
  }

  // --- 쓰다듬기 심화(연속으로 만질수록 반응↑) ---
  let petCount = 0;
  let petResetId = null;
  function petStroke() {
    if (!assetBase) return;
    petCount++;
    if (petResetId != null) clearTimeout(petResetId);
    petResetId = setTimeout(() => {
      petCount = 0;
      petResetId = null;
    }, PET_ESCALATE_MS);
    const tier = petCount >= 5 ? 3 : petCount >= 3 ? 2 : 1; // Tickle → Happy → Excited
    behavior.stroke(tier);
    spawnHearts(tier);
  }
  function spawnHearts(tier = 1) {
    const n = tier >= 3 ? 6 + Math.floor(Math.random() * 3) : tier >= 2 ? 4 + Math.floor(Math.random() * 2) : 2 + Math.floor(Math.random() * 2);
    const petLeft = pet.getBoundingClientRect().left;
    for (let i = 0; i < n; i++) {
      const h = el("div", { class: "pet-heart", text: "♥" });
      h.style.left = `${petLeft + pet.offsetWidth * (0.2 + Math.random() * 0.6)}px`;
      h.style.bottom = `${pet.offsetHeight * (0.5 + Math.random() * 0.2)}px`;
      h.style.animationDelay = `${i * 70}ms`;
      if (tier >= 3) h.style.fontSize = "18px"; // 강할수록 큰 하트
      h.addEventListener("animationend", () => h.remove());
      hearts.append(h);
    }
  }

  // --- rAF 루프 (시간 기반 dt) ---
  let rafId = null;
  let last = null;

  function loop(ts) {
    rafId = requestAnimationFrame(loop);
    if (!assetBase) {
      last = ts; // 스프라이트 없음 → 안 그림(복귀 시 dt 튐 방지로 last 만 갱신)
      return;
    }
    if (last == null) last = ts;
    let dt = ts - last;
    last = ts;
    if (dt > 100) dt = 100; // 오래 숨었다 복귀 시 순간이동 방지

    behavior.tick(dt);

    // 낚싯대: swat 이 끝나 idle 로 돌아오는 순간, 렌더(setAnim) 전에 즉시 다시 추격을 건다.
    // → 덮치기(pounce) 사이에 idle 프레임이 한 컷 새어 나오는 깜빡임 방지.
    if (wandActive) {
      const s = behavior.getState().state;
      if (s === "approach") behavior.setTarget(cursorNX);
      else if (s !== "pounce") behavior.swat(cursorNX);
    }

    const { state, x, facing } = behavior.getState();

    setAnim(animKeyFor(state));

    // 스프라이트 프레임 cadence (부드러운 이동과 분리된 청키한 프레임 교체).
    frameElapsed += dt;
    const frameMs = 1000 / (curAnim.fps || 8);
    while (frameElapsed >= frameMs) {
      frameElapsed -= frameMs;
      frame = (frame + 1) % curAnim.frames;
    }
    drawFrame();

    // 정규화 x → px 위치. 창(=stage) 폭에서 스프라이트 폭을 뺀 범위로 매핑(경계 밖 클리핑 방지).
    const range = Math.max(0, stage.clientWidth - pet.offsetWidth);
    const px = x * range;
    pet.style.transform = `translateX(${px}px) scaleX(${facing === "left" ? -1 : 1})`;

    // 상호작용 아이템(공/밥) 위치·정리.
    updateItems(dt, state);
  }

  function start() {
    if (rafId == null) {
      last = null;
      rafId = requestAnimationFrame(loop);
    }
  }
  function stop() {
    if (rafId != null) {
      cancelAnimationFrame(rafId);
      rafId = null;
    }
  }

  // 자기 창이 안 보이면 루프 정지(CPU 절약). 이벤트는 계속 받아 점 상태는 유지.
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stop();
    else start();
  });

  // 커서 추적(낚싯대 조준 + 하트 위치). stage=창 전체(0,0)라 clientX/Y 를 그대로 쓴다.
  window.addEventListener("mousemove", (e) => {
    cursorX = e.clientX;
    cursorY = e.clientY;
    const range = Math.max(1, stage.clientWidth - pet.offsetWidth);
    cursorNX = Math.max(0, Math.min(1, (e.clientX - pet.offsetWidth / 2) / range));
    if (wandActive) positionFeather();
  });

  // 스트립 선로드 프로브. background-image 는 onerror 가 없어 이렇게 별도로 존재를 확인한다.
  const preloadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`pet sprite load failed: ${src}`));
      img.src = src;
      if (img.complete && img.naturalWidth > 0) resolve(); // 캐시 즉시완료 폴백
    });
  // idle 하나만이 아니라 일상 스트립(walk/sleep/react)까지 확인해야 그 상태에서 투명 창이 안 뜬다.
  const AMBIENT_IMGS = [...new Set(AMBIENT_ANIM_KEYS.map((k) => ANIMATIONS[k].img))];
  // 상호작용 스트립(petting/eat/pounce/excited) — 표시 게이팅에서 제외하고 창을 띄운 뒤 캐시만 예열.
  const INTERACTION_IMGS = [
    ...new Set(
      Object.entries(ANIMATIONS)
        .filter(([k]) => !AMBIENT_ANIM_KEYS.includes(k))
        .map(([, a]) => a.img),
    ),
  ];

  let winVisible = false;

  // 표시 컨트롤러(순수 로직) 배선. loadImage 는 일상 스트립을 모두 선로드(하나라도 없으면 reject → show 안 함).
  const controller = makePetDisplayController({
    loadImage: (base) => Promise.all(AMBIENT_IMGS.map((name) => preloadImage(base + name))),
    show: () => {
      if (!winVisible) {
        winVisible = true;
        getCurrentWindow?.().show?.().catch((err) => console.error("pet show failed:", err));
      }
      // 상호작용 스트립 캐시 예열(실패 무시) → 첫 상호작용 시 한 프레임 깜빡임 방지.
      if (assetBase) INTERACTION_IMGS.forEach((name) => preloadImage(assetBase + name).catch(() => {}));
      start();
    },
    hide: () => {
      stop();
      clearBall(); // 떠 있던 상호작용 아이템 정리(제거/색변경 시 잔상 방지)
      clearFood();
      endWand();
      assetBase = null; // 재표시 시 render 로 다시 확정
      if (winVisible) {
        winVisible = false;
        getCurrentWindow?.().hide?.().catch((err) => console.error("pet hide failed:", err));
      }
    },
    render: (id) => {
      assetBase = assetBaseFor(id); // 먼저 갱신 → setAnim 이 색 변화를 감지
      setAnim(animKeyFor(behavior.getState().state));
    },
  });

  // --- 우클릭 메뉴 ---
  let menuOpen = false;

  function openMenu(x, y) {
    menu.hidden = false;
    menuOpen = true;
    // 창 밖으로 넘치지 않게 clamp(먼저 보이게 한 뒤 크기를 재야 offsetWidth 가 잡힘).
    const maxX = Math.max(0, stage.clientWidth - menu.offsetWidth);
    const maxY = Math.max(0, stage.clientHeight - menu.offsetHeight);
    menu.style.left = `${Math.min(Math.max(0, x), maxX)}px`;
    menu.style.top = `${Math.min(Math.max(0, y), maxY)}px`;
  }
  function closeMenu() {
    if (!menuOpen) return;
    menu.hidden = true;
    menuOpen = false;
  }

  // "Remove pet": 로컬로 숨기지 않고 제거 신호만 보낸다. 실제 숨김은 메인이 pref 를 none 으로
  // 바꿔 되돌려주는 pet:set-cat 이 담당한다(펫 = pref 의 순수 투영).
  async function removePet() {
    closeMenu();
    try {
      await evapi?.emit?.("pet:removed");
    } catch (err) {
      console.error("pet remove emit failed:", err);
    }
  }

  // 좌클릭: 안 움직이면 클릭(쓰다듬기), 임계값 이상 움직이면 창 드래그.
  // startDragging 은 OS 가 드래그를 가로채므로, 실제 이동이 감지된 뒤에야 호출한다.
  stage.addEventListener("mousedown", (e) => {
    if (menuOpen) {
      // 메뉴 밖을 누르면 닫기만(드래그 안 함). 메뉴 안(버튼)은 button click 이 처리.
      if (!menu.contains(e.target)) closeMenu();
      return;
    }
    if (e.button !== 0) return;
    if (e.target === grip) return; // 리사이즈는 grip 핸들러가 담당

    if (wandActive) {
      // 낚싯대 노는 중: 클릭 한 번으로 그만두기(드래그·쓰다듬기 없음).
      const onWandUp = () => {
        window.removeEventListener("mouseup", onWandUp);
        endWand();
      };
      window.addEventListener("mouseup", onWandUp);
      return;
    }

    const sx = e.screenX;
    const sy = e.screenY;
    let dragging = false;

    const cleanup = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    const onMove = (ev) => {
      if (dragging) return;
      if (Math.abs(ev.screenX - sx) > DRAG_THRESHOLD || Math.abs(ev.screenY - sy) > DRAG_THRESHOLD) {
        dragging = true;
        cleanup();
        getCurrentWindow?.()
          .startDragging?.()
          .catch((err) => console.error("pet startDragging failed:", err));
      }
    };
    const onUp = () => {
      cleanup();
      if (!dragging) petStroke(); // 안 움직였으면 클릭 = 쓰다듬기
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  // 리사이즈 그립 — window-controls.js 와 같은 수동 방식(현재 크기 + 화면좌표 델타 → setSize, rAF 스로틀).
  grip.addEventListener("mousedown", async (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation(); // stage 의 창 드래그(startDragging) 시작 방지
    const win = getCurrentWindow?.();
    if (!win || !LogicalSize) return;

    let startW;
    let startH;
    try {
      const size = await win.innerSize();
      const factor = await win.scaleFactor();
      startW = size.width / factor;
      startH = size.height / factor;
    } catch (err) {
      console.error("pet resize start failed:", err);
      return;
    }
    const startX = e.screenX;
    const startY = e.screenY;
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

    let rafId = null;
    let pending = null;
    const apply = () => {
      rafId = null;
      if (!pending) return;
      const w = clamp(Math.round(pending.w), PET_MIN.w, PET_MAX.w);
      const h = clamp(Math.round(pending.h), PET_MIN.h, PET_MAX.h);
      win.setSize(new LogicalSize(w, h)).catch((err) => console.error("pet setSize failed:", err));
    };
    const onMove = (ev) => {
      pending = { w: startW + (ev.screenX - startX), h: startH + (ev.screenY - startY) };
      if (rafId == null) rafId = requestAnimationFrame(apply);
    };
    const onUp = () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (rafId != null) cancelAnimationFrame(rafId);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  });

  // 우클릭 → 기본 메뉴 막고 커스텀 메뉴 표시.
  stage.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    openMenu(e.clientX, e.clientY);
  });

  feedBtn.addEventListener("click", () => {
    closeMenu();
    spawnFood();
  });
  playBtn.addEventListener("click", () => {
    closeMenu();
    spawnToy();
  });
  wandBtn.addEventListener("click", () => {
    closeMenu();
    if (wandActive) endWand();
    else startWand();
  });
  boxBtn.addEventListener("click", () => {
    closeMenu();
    tryBox();
  });
  removeBtn.addEventListener("click", removePet);

  // 메뉴 닫기 / 낚싯대 끝내기: Esc.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      closeMenu();
      endWand();
    }
  });
  window.addEventListener("blur", closeMenu);

  // --- 브리지 이벤트 수신 + 부팅 핸드셰이크 ---
  // 리스너 등록을 기다린 뒤 pet:ready emit → 메인의 첫 pet:set-cat 을 놓치지 않는다.
  (async () => {
    try {
      await getCurrentWindow?.().hide?.(); // 부팅 시 숨김(tauri.conf visible:false 와 이중 보장)
    } catch (err) {
      console.error("pet initial hide failed:", err);
    }

    try {
      await Promise.all(
        [
          evapi?.listen?.("pet:message-arrived", () => behavior.react()),
          evapi?.listen?.("pet:unread", (e) => {
            unread = e?.payload?.total || 0;
            updateDot();
            // 안 읽음이 있는 동안 놀람 유지, 확인(그 방 입장)해서 0 이 되면 해제 → 일상 동작 복귀.
            behavior.setAlerting(unread > 0);
          }),
          evapi?.listen?.("pet:main-focus", (e) => {
            mainFocused = !!e?.payload?.focused;
            updateDot();
          }),
          evapi?.listen?.("pet:set-cat", (e) => {
            controller.setCat(normalizeCat(e?.payload?.catId));
          }),
        ].filter(Boolean),
      );
    } catch (err) {
      // 등록 실패해도 finally 의 pet:ready 는 반드시 보낸다 → 메인의 kick 으로 복구 기회를 남긴다.
      console.error("pet listener registration failed:", err);
    } finally {
      try {
        await evapi?.emit?.("pet:ready");
      } catch (err) {
        console.error("pet ready emit failed:", err);
      }
    }
  })();

  return { start, stop };
}

// 창 진입점에서 즉시 초기화.
initPetWindow();
