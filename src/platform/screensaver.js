// 화면보호기(#73): 앱 창 안 입력(마우스/키보드/휠)이 IDLE_MS 동안 없으면 CRT 화면 영역을
// 장면 캔버스로 덮고, 어떤 입력이든 들어오면 즉시 걷어 이전 상태 그대로 복귀한다(오버레이 방식 —
// 라우팅/뷰 상태는 건드리지 않으므로 모든 뷰에서 동작). 채팅 새 메시지 도착은 입력이 아니므로
// 화면보호기를 해제하지 않는다(알림음/뱃지는 기존대로 동작).
// 장면은 starfield ↔ matrix 를 활성화 때마다 교대한다 — 눈으로 비교해 하나를 고르기 위한
// 임시 정책. localStorage SCENE_KEY = "starfield" | "matrix" 로 한쪽 고정 가능.
import { startStarfield, startMatrixRain } from "./screensaver-scenes.js";

const IDLE_MS = 3 * 60 * 1000; // 유휴 판정 3분 고정(#73 결정)
const SCENE_KEY = "retro-note.screensaver-scene";
const SCENES = ["starfield", "matrix"];

// 의존성 주입 factory — 유휴 판정/장면 선택의 순수 로직. 테스트가 fake now/show/hide 를 주입.
//   now: 단조 증가 ms 시계(실사용 performance.now). show(scene)/hide(): 오버레이 표시/제거.
export function makeScreensaver({ idleMs = IDLE_MS, storage, now, show, hide }) {
  let lastActivity = now();
  let active = false;
  let lastScene = null; // 마지막으로 보여준 장면 — 교대 결정용(메모리 한정, 재시작 시 초기화)

  const pickScene = () => {
    const pinned = storage.getItem(SCENE_KEY);
    if (SCENES.includes(pinned)) return pinned;
    return lastScene === SCENES[0] ? SCENES[1] : SCENES[0]; // 교대(첫 회는 starfield)
  };

  const activate = (scene) => {
    if (active) return;
    active = true;
    lastScene = SCENES.includes(scene) ? scene : pickScene();
    show(lastScene);
  };

  const deactivate = () => {
    if (!active) return;
    active = false;
    lastActivity = now(); // 해제 직후 check 가 곧바로 재발동하지 않도록 리셋
    hide();
  };

  // 사용자 입력 신호. 활성 중이면 해제하고 true(= 이 입력은 깨우기용으로 소비됨)를 반환 —
  // 호출부는 true 일 때 이벤트를 삼켜 아래 UI 에 닿지 않게 한다.
  const notifyActivity = () => {
    if (active) {
      deactivate();
      return true;
    }
    lastActivity = now();
    return false;
  };

  // 주기 호출(타이머 틱)용 — 유휴 시간이 차면 발동.
  const check = () => {
    if (!active && now() - lastActivity >= idleMs) activate();
  };

  return { notifyActivity, check, activate, deactivate, isActive: () => active };
}

// 실제 DOM 배선. 앱 전역 기능이라 뷰 unmount 계약과 무관하게 앱 수명 내내 살아있다.
export function initScreensaver() {
  const wrap = document.getElementById("computer-wrap");
  if (!wrap) return;

  let overlay = null;
  let stopScene = null;
  let prevFocus = null;

  const show = (scene) => {
    // 깨우는 키가 IME 조합 등으로 편집기에 새지 않도록 포커스를 내려두고, 해제 시 복원한다.
    prevFocus = document.activeElement;
    if (prevFocus && prevFocus !== document.body) prevFocus.blur?.();
    overlay = document.createElement("div");
    overlay.className = "screensaver";
    const canvas = document.createElement("canvas");
    overlay.appendChild(canvas);
    wrap.appendChild(overlay); // #screen 밖에 부착 — 뷰 전환이 일어나도 오버레이가 지워지지 않게
    stopScene = (scene === "matrix" ? startMatrixRain : startStarfield)(canvas);
  };

  const hide = () => {
    stopScene?.();
    stopScene = null;
    overlay?.remove();
    overlay = null;
    prevFocus?.focus?.(); // 뷰가 바뀌어 detach 됐으면 no-op — 안전
    prevFocus = null;
  };

  const saver = makeScreensaver({
    storage: localStorage,
    now: () => performance.now(),
    show,
    hide,
  });

  let pointerWokeAt = -Infinity;
  const onInput = (e) => {
    const consumed = saver.notifyActivity();
    if (!consumed) return;
    if (e.type === "pointermove") return; // 움직임만으로 깨울 땐 삼킬 필요 없음
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "pointerdown") pointerWokeAt = performance.now();
  };
  // pointerdown 을 preventDefault 해도 click 은 여전히 발생한다(포인터 이벤트 스펙 — click 은
  // 호환 마우스 이벤트가 아님). 깨우는 클릭의 후속 up/click 이 아래 UI(닫기 버튼 등)를 누르지
  // 않도록 짧은 시간창 안의 것만 흡수한다.
  const swallowFollowUp = (e) => {
    if (performance.now() - pointerWokeAt < 600) {
      e.preventDefault();
      e.stopPropagation();
    }
  };
  // capture 단계에서 감지 — CodeMirror 등 타깃 핸들러가 stopPropagation 해도 활동은 집계된다.
  window.addEventListener("pointermove", onInput, { capture: true, passive: true });
  window.addEventListener("pointerdown", onInput, true);
  window.addEventListener("keydown", onInput, true);
  window.addEventListener("wheel", onInput, { capture: true, passive: false }); // preventDefault 가능해야 함
  window.addEventListener("pointerup", swallowFollowUp, true);
  window.addEventListener("click", swallowFollowUp, true);

  setInterval(() => saver.check(), 1000);

  // 장면 비교용 임시 훅(#73): 개발자 콘솔에서 3분 기다리지 않고 즉시 미리보기.
  //   __screensaver.show("starfield") / __screensaver.show("matrix") — 아무 입력으로 해제.
  window.__screensaver = {
    show: (scene) => saver.activate(scene),
    hide: () => saver.deactivate(),
  };
}
