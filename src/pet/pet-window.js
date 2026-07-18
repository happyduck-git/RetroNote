// 펫 창(pet.html)의 진입 모듈 — DOM 생성 + rAF 렌더 루프 + 창 드래그/제거 + 브리지 이벤트 수신.
// 펫은 "저장된 선택(pet-cat pref)"의 순수 투영: 스스로 show/hide 하지 않고 pet:set-cat 에만 반응
// (우클릭 제거도 pref 왕복) → 유령창/부활 버그 차단.
import { el } from "../core/dom.js";
import { makePetBehavior } from "./behavior.js";
import { makePetDisplayController } from "./pet-display.js";
import { assetBaseFor, normalizeCat } from "./cats.js";
import { ANIMATIONS, animKeyFor } from "./sprite.js";

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
  // 우클릭 메뉴(기본 숨김).
  const removeBtn = el("button", { class: "pet-menu-item", type: "button", text: "Remove pet" });
  const menu = el("div", { class: "pet-menu", hidden: true }, [removeBtn]);
  // 투명 창을 드래그로 리사이즈하는 손잡이(우하단 코너).
  const grip = el("div", { class: "pet-resize", title: "Drag to resize" });
  const stage = el("div", { class: "pet-stage" }, [pet, menu, grip]);
  document.body.append(stage);
  return { stage, pet, dot, menu, removeBtn, grip };
}

export function initPetWindow() {
  const { stage, pet, dot, menu, removeBtn, grip } = buildDom();
  const behavior = makePetBehavior({});

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

  // 스트립 선로드 프로브. background-image 는 onerror 가 없어 이렇게 별도로 존재를 확인한다.
  const preloadImage = (src) =>
    new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve();
      img.onerror = () => reject(new Error(`pet sprite load failed: ${src}`));
      img.src = src;
      if (img.complete && img.naturalWidth > 0) resolve(); // 캐시 즉시완료 폴백
    });
  // idle 하나만이 아니라 실제 재생할 스트립 전부를 확인해야 walk/sleep/react 중 투명 창이 안 뜬다.
  const ANIM_IMGS = [...new Set(Object.values(ANIMATIONS).map((a) => a.img))];

  // 표시 컨트롤러(순수 로직) 배선. loadImage 는 4개 스트립을 모두 선로드(하나라도 없으면 reject → show 안 함).
  const controller = makePetDisplayController({
    loadImage: (base) => Promise.all(ANIM_IMGS.map((name) => preloadImage(base + name))),
    show: () => {
      getCurrentWindow?.().show?.().catch((err) => console.error("pet show failed:", err));
      start();
    },
    hide: () => {
      stop();
      assetBase = null; // 재표시 시 render 로 다시 확정
      getCurrentWindow?.().hide?.().catch((err) => console.error("pet hide failed:", err));
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

  // 좌클릭 드래그로 창 이동. 메뉴가 떠 있으면 드래그 대신 메뉴 처리.
  stage.addEventListener("mousedown", async (e) => {
    if (menuOpen) {
      // 메뉴 밖을 누르면 닫기만(드래그 안 함). 메뉴 안(버튼)은 button click 이 처리.
      if (!menu.contains(e.target)) closeMenu();
      return;
    }
    if (e.button !== 0) return;
    try {
      await getCurrentWindow?.().startDragging?.();
    } catch (err) {
      console.error("pet startDragging failed:", err);
    }
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

  removeBtn.addEventListener("click", removePet);

  // 메뉴 닫기: Esc / 창 포커스 잃음.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeMenu();
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
