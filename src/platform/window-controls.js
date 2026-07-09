// 창 제어: 리사이즈 그립, 드래그 이동, Cmd/Ctrl ±/0 줌, 핀치 줌, 닫기 버튼, 종횡비 클램프.
// Tauri 외 환경(브라우저)에서는 window API가 없으므로 창 제어를 통째로 건너뛴다.
import { isBezelMode, onScreenModeChange } from "./screen-mode.js";

// node 유닛테스트(window 없음)에서도 이 모듈을 import 할 수 있게 최상위 window 접근을 가드.
// (window-size.test.js 가 상수만 읽어 tauri.conf.json 과 대조하려면 import 가 가능해야 함)
const tauriWindow =
  typeof window !== "undefined" ? window.__TAURI__?.window : undefined;
const getCurrentWindow = tauriWindow?.getCurrentWindow;
const LogicalSize = tauriWindow?.LogicalSize;

// tauri.conf.json 의 minWidth/minHeight/maxWidth/maxHeight 와 동기화 필수.
// 손으로 맞춘 값이라, window-size.test.js 가 양쪽 일치를 자동 검증한다(어긋나면 테스트 실패).
export const WIN_MIN = { w: 400, h: 360 };
export const WIN_MAX = { w: 2000, h: 1600 };
const WIN_DEFAULT = { w: 800, h: 720 };
const ASPECT = 2170 / 1952; // computer.png 비율(기본 모드 전용)

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

async function currentLogicalSize() {
  const win = getCurrentWindow();
  // 두 IPC 는 서로 독립 — 병렬 조회로 왕복 1회 절약.
  const [physical, factor] = await Promise.all([
    win.innerSize(),
    win.scaleFactor(),
  ]);
  return { w: physical.width / factor, h: physical.height / factor };
}

// 순수 계산(부작용 없음) — setSize 호출과 분리해 window-size.test.js 로 검증 가능하게 함.
// 너비를 받아 종횡비를 유지하면서 MIN/MAX 안에 맞춘 정수 크기를 돌려준다.
export function computeAspectClamped(targetW) {
  let newW = clamp(targetW, WIN_MIN.w, WIN_MAX.w);
  let newH = newW / ASPECT;
  if (newH < WIN_MIN.h) {
    newH = WIN_MIN.h;
    newW = newH * ASPECT;
  } else if (newH > WIN_MAX.h) {
    newH = WIN_MAX.h;
    newW = newH * ASPECT;
  }
  return { w: Math.round(newW), h: Math.round(newH) };
}

// 베젤 화면 모드: 종횡비를 무시하고 가로/세로를 각각 독립적으로 MIN/MAX 클램프.
export function computeFreeSize(targetW, targetH) {
  return {
    w: Math.round(clamp(targetW, WIN_MIN.w, WIN_MAX.w)),
    h: Math.round(clamp(targetH, WIN_MIN.h, WIN_MAX.h)),
  };
}

// 베젤 복귀: 자유 리사이즈된 창의 폰트 기준(--computer-width)은 min(w, h×ASPECT) —
// 이를 새 폭으로 삼으면 복귀 후에도 글자 체감 크기가 이어지고, 창은 절대 커지지 않는다
// (min(w, h×ASPECT) ≤ w 이고 그 높이 ≤ h). 폭 w 를 그대로 쓰면(과거 동작) 가로로 긴
// 창에서 높이가 늘며 글자가 커진다. 반환값은 클램프 전 목표 폭: 호출부가
// computeAspectClamped 를 거친다.
export function computeBezelExitWidth(w, h) {
  return Math.min(w, h * ASPECT);
}

async function applyAspectClampedWidth(targetW) {
  const { w, h } = computeAspectClamped(targetW);
  await getCurrentWindow().setSize(new LogicalSize(w, h));
}

async function applyFreeSize(targetW, targetH) {
  const { w, h } = computeFreeSize(targetW, targetH);
  await getCurrentWindow().setSize(new LogicalSize(w, h));
}

async function scaleWindowBy(factor) {
  const cur = await currentLogicalSize();
  // 베젤 화면 모드에선 현재(자유) 비율을 유지한 채 양축 비례 확대/축소.
  // 기본 모드에선 모니터 종횡비로 폭 기준 클램프.
  if (isBezelMode()) await applyFreeSize(cur.w * factor, cur.h * factor);
  else await applyAspectClampedWidth(cur.w * factor);
}

async function resetWindowSize() {
  // 두 모드가 같은 폰트 기준을 쓰므로(#71 재설계) 기본 크기는 모드와 무관하게 동일.
  await getCurrentWindow().setSize(new LogicalSize(WIN_DEFAULT.w, WIN_DEFAULT.h));
}

export function initWindowControls(container) {
  if (!tauriWindow) return; // 브라우저 등 Tauri 외 환경: 창 제어 비활성(채팅 테스트용)

  // 화면 모드 전환(#71 재설계): 창 크기는 건드리지 않는다 — 두 모드가 같은 폰트 기준
  // (--computer-width, :root 단일 선언)을 쓰므로 글자 체감 크기는 CSS 만으로 연속된다.
  // 기본 모드 복귀 시에만, 베젤에서 자유 리사이즈됐을 수 있는 창을 폰트 기준 폭으로
  // 종횡비 재클램프한다(종횡비가 이미 맞으면 크기 변화 없음).
  onScreenModeChange(async (bezelMode) => {
    if (bezelMode) return;
    // Tauri IPC(창 크기 조회/설정) 실패는 흡수 — 미처리 Promise 거부 방지(best-effort).
    try {
      const cur = await currentLogicalSize();
      await applyAspectClampedWidth(computeBezelExitWidth(cur.w, cur.h));
    } catch {}
  });

  const closeBtn = document.getElementById("close-btn");
  if (closeBtn) {
    closeBtn.addEventListener("click", async () => {
      await getCurrentWindow().close();
    });
  }

  // 우하단 그립으로 수동 리사이즈
  // macOS의 transparent + decorations:false 창에서는 startResizeDragging이 silent no-op이라 직접 처리
  const resizeGrip = document.getElementById("resize-grip");
  if (resizeGrip) {
    resizeGrip.addEventListener("mousedown", async (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      e.stopPropagation();

      const start = await currentLogicalSize();
      const startX = e.screenX;
      const startY = e.screenY;
      const bezelMode = isBezelMode(); // 드래그 중 모드는 불변 → 시작 시 1회 판정
      let pending = null;
      let rafId = null;

      const apply = () => {
        rafId = null;
        if (!pending) return;
        const p = pending;
        pending = null;
        if (bezelMode) applyFreeSize(p.w, p.h); // 자유 비율(가로·세로 독립)
        else applyAspectClampedWidth(p.w); // 기본 모드: 폭 기준 종횡비 유지
      };

      const onMove = (ev) => {
        pending = {
          w: start.w + (ev.screenX - startX),
          h: start.h + (ev.screenY - startY),
        };
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
  }

  // 명시적 드래그 핸들러 — 투명 창에서 -webkit-app-region이 종종 누락되는 문제 보완.
  // 인터랙티브 요소(텍스트 입력/버튼)와 [data-no-drag] 표시된 영역(채팅 목록/입력 등)에서는
  // 드래그를 시작하지 않아 스크롤·선택·클릭이 정상 동작한다.
  container.addEventListener("mousedown", async (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("textarea, input, button, [data-no-drag]")) return;
    await getCurrentWindow().startDragging();
  });

  // Cmd/Ctrl + +/-/0 으로 창 크기 조절
  document.addEventListener("keydown", async (e) => {
    if (!(e.metaKey || e.ctrlKey)) return;
    if (e.key === "=" || e.key === "+") {
      e.preventDefault();
      await scaleWindowBy(1.1);
    } else if (e.key === "-" || e.key === "_") {
      e.preventDefault();
      await scaleWindowBy(1 / 1.1);
    } else if (e.key === "0") {
      e.preventDefault();
      await resetWindowSize();
    }
  });

  // 트랙패드 핀치(ctrl+wheel) 또는 Cmd+휠로 줌
  document.addEventListener(
    "wheel",
    async (e) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
      await scaleWindowBy(factor);
    },
    { passive: false },
  );
}
