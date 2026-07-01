// 창 제어: 리사이즈 그립, 드래그 이동, Cmd/Ctrl ±/0 줌, 핀치 줌, 닫기 버튼, 종횡비 클램프.
// Tauri 외 환경(브라우저)에서는 window API가 없으므로 창 제어를 통째로 건너뛴다.
import { isLargeScreen, onScreenModeChange } from "./screen-mode.js";

const tauriWindow = window.__TAURI__?.window;
const getCurrentWindow = tauriWindow?.getCurrentWindow;
const LogicalSize = tauriWindow?.LogicalSize;

const WIN_MIN = { w: 400, h: 360 };
const WIN_MAX = { w: 2000, h: 1600 }; // tauri.conf.json 의 maxWidth/maxHeight 와 동기화 필수
const WIN_DEFAULT = { w: 800, h: 720 };
const ASPECT = 2170 / 1952; // computer.png 비율(기본 모드 전용)

function clamp(v, lo, hi) {
  return Math.max(lo, Math.min(hi, v));
}

async function currentLogicalSize() {
  const win = getCurrentWindow();
  const physical = await win.innerSize();
  const factor = await win.scaleFactor();
  return { w: physical.width / factor, h: physical.height / factor };
}

// 너비를 받아 종횡비를 유지하면서 MIN/MAX 안에 맞춰 창 크기를 설정
async function applyAspectClampedWidth(targetW) {
  let newW = clamp(targetW, WIN_MIN.w, WIN_MAX.w);
  let newH = newW / ASPECT;
  if (newH < WIN_MIN.h) {
    newH = WIN_MIN.h;
    newW = newH * ASPECT;
  } else if (newH > WIN_MAX.h) {
    newH = WIN_MAX.h;
    newW = newH * ASPECT;
  }
  await getCurrentWindow().setSize(new LogicalSize(Math.round(newW), Math.round(newH)));
}

// 큰 화면 모드: 종횡비를 무시하고 가로/세로를 각각 독립적으로 MIN/MAX 클램프.
async function applyFreeSize(targetW, targetH) {
  const w = clamp(targetW, WIN_MIN.w, WIN_MAX.w);
  const h = clamp(targetH, WIN_MIN.h, WIN_MAX.h);
  await getCurrentWindow().setSize(new LogicalSize(Math.round(w), Math.round(h)));
}

async function scaleWindowBy(factor) {
  const cur = await currentLogicalSize();
  // 큰 화면 모드에선 현재(자유) 비율을 유지한 채 양축 비례 확대/축소.
  // 기본 모드에선 모니터 종횡비로 폭 기준 클램프.
  if (isLargeScreen()) await applyFreeSize(cur.w * factor, cur.h * factor);
  else await applyAspectClampedWidth(cur.w * factor);
}

async function resetWindowSize() {
  await getCurrentWindow().setSize(new LogicalSize(WIN_DEFAULT.w, WIN_DEFAULT.h));
}

export function initWindowControls(container) {
  if (!tauriWindow) return; // 브라우저 등 Tauri 외 환경: 창 제어 비활성(채팅 테스트용)

  // 화면 모드 전환: 진입 시엔 창 크기를 바꾸지 않는다(프레임만 전환 → 콘텐츠가 같은 창 안에서 커짐).
  // 기본 모드로 복귀할 때만, 자유 리사이즈됐을 수 있는 창을 모니터 종횡비로 다시 맞춘다.
  onScreenModeChange(async (large) => {
    if (large) return;
    const cur = await currentLogicalSize();
    await applyAspectClampedWidth(cur.w);
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
      const large = isLargeScreen(); // 드래그 중 모드는 불변 → 시작 시 1회 판정
      let pending = null;
      let rafId = null;

      const apply = () => {
        rafId = null;
        if (!pending) return;
        const p = pending;
        pending = null;
        if (large) applyFreeSize(p.w, p.h); // 자유 비율(가로·세로 독립)
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
