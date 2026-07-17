// 펫 창(pet.html)의 진입 모듈 — DOM 생성 + rAF 렌더 루프 + 창 드래그/제거 + 브리지 이벤트 수신.
// 순수 로직은 behavior.js, 애니 데이터는 sprite.js. 이 파일은 렌더 cadence 와 Tauri 창 배선을 담당(미테스트).
import { el } from "../core/dom.js";
import { makePetBehavior } from "./behavior.js";
import { ANIMATIONS, animKeyFor } from "./sprite.js";

// Tauri 전역(withGlobalTauri). 브라우저 단독 실행에선 없으므로 옵셔널 접근.
const T = typeof window !== "undefined" ? window.__TAURI__ : undefined;
const getCurrentWindow = T?.window?.getCurrentWindow;
const evapi = T?.event;
const LogicalSize = T?.window?.LogicalSize;

const ASSET_BASE = "assets/pet/"; // pet.html 기준 상대경로 → src/assets/pet/

// 리사이즈 클램프 — tauri.conf.json 의 pet 창 min/max 와 동기화(빌드 스텝 없어 손으로 맞춤).
const PET_MIN = { w: 140, h: 130 };
const PET_MAX = { w: 400, h: 360 };

function buildDom() {
  const dot = el("div", { class: "pet-dot", hidden: true });
  const pet = el("div", { class: "pet" }, [dot]);
  // 우클릭 메뉴(기본 숨김). 지금은 "Remove pet" 하나 — 항목 추가는 여기에 버튼을 더하면 됨.
  const removeBtn = el("button", { class: "pet-menu-item", type: "button", text: "Remove pet" });
  const menu = el("div", { class: "pet-menu", hidden: true }, [removeBtn]);
  // 리사이즈 그립 — 투명 창에서 유일하게 보이는 손잡이(우하단 코너). 드래그로 창 크기 조절.
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

  // 애니메이션 재생 상태.
  let curKey = null;
  let curAnim = ANIMATIONS.idle;
  let frame = 0;
  let frameElapsed = 0;

  function setAnim(key) {
    if (key === curKey) return;
    curKey = key;
    curAnim = ANIMATIONS[key] || ANIMATIONS.idle;
    frame = 0;
    frameElapsed = 0;
    pet.style.backgroundImage = `url(${ASSET_BASE}${curAnim.img})`;
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

  // 펫 창의 "실제" 표시 상태를 메인에 보고한다 → 버튼 상태의 유일한 기준(메인 추측값 desync 방지).
  async function reportShown() {
    try {
      const win = getCurrentWindow?.();
      const visible = win ? await win.isVisible() : false;
      await evapi?.emit?.("pet:shown", { shown: !!visible });
    } catch (err) {
      console.error("pet report visibility failed:", err);
    }
  }

  async function removePet() {
    closeMenu();
    try {
      await getCurrentWindow?.().hide?.();
      await reportShown(); // 숨김 반영 → 메인 버튼 동기화
    } catch (err) {
      console.error("pet dismiss failed:", err);
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

  // --- 리사이즈 그립(투명 창을 마우스로 크기 조절) ---
  // 메인 창(window-controls.js)과 같은 수동 방식: mousedown 에서 현재 크기를 잡고,
  // mousemove 의 화면좌표 델타를 더해 setSize. rAF 로 스로틀 + min/max clamp.
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

  // --- 브리지 이벤트 수신(메인 창 → 펫 창) ---
  evapi?.listen?.("pet:message-arrived", () => behavior.react());
  evapi?.listen?.("pet:unread", (e) => {
    unread = e?.payload?.total || 0;
    updateDot();
    // 안 읽음이 있는 동안 놀람 유지, 확인(그 방 입장)해서 0 이 되면 해제 → 일상 동작 복귀.
    behavior.setAlerting(unread > 0);
  });
  evapi?.listen?.("pet:main-focus", (e) => {
    mainFocused = !!e?.payload?.focused;
    updateDot();
  });
  // 토글: 펫 창이 자기 "실제" 표시 상태를 뒤집고 결과를 보고한다(메인은 결과만 반영).
  evapi?.listen?.("pet:toggle", async () => {
    try {
      const win = getCurrentWindow?.();
      if (!win) return;
      if (await win.isVisible()) await win.hide();
      else await win.show();
      await reportShown();
    } catch (err) {
      console.error("pet toggle failed:", err);
    }
  });
  // 조회: 메인이 현재 상태를 물으면 실제 표시 여부를 보고(메인 리로드 후 버튼 재동기화).
  evapi?.listen?.("pet:query", () => reportShown());

  // 시작 시: 항상 숨김으로 시작한다(부팅 때 자동으로 뜨지 않음 — 메인 상단 버튼으로만 표시).
  // tauri.conf 의 visible:false 와 이중으로 보장. 그 뒤 메인에 준비 완료를 알리면,
  // 메인(bridge)이 현재 세션 표시 여부/포커스/안읽음을 회신한다(창 리로드 시에도 동기화).
  (async () => {
    try {
      await getCurrentWindow?.().hide?.();
    } catch (err) {
      console.error("pet initial hide failed:", err);
    }
    try {
      await evapi?.emit?.("pet:ready");
    } catch {
      // ignore
    }
  })();

  setAnim("idle");
  start();

  return { start, stop };
}

// 창 진입점에서 즉시 초기화.
initPetWindow();
