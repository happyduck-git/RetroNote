// 창 제어: 리사이즈 그립, 드래그 이동, Cmd/Ctrl ±/0 줌, 핀치 줌, 닫기 버튼, 종횡비 클램프.
const { getCurrentWindow, LogicalSize } = window.__TAURI__.window;

const WIN_MIN = { w: 400, h: 360 };
const WIN_MAX = { w: 1400, h: 1260 };
const WIN_DEFAULT = { w: 800, h: 720 };
const ASPECT = 2170 / 1952; // computer.png 비율

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

async function scaleWindowBy(factor) {
  const cur = await currentLogicalSize();
  await applyAspectClampedWidth(cur.w * factor);
}

async function resetWindowSize() {
  await getCurrentWindow().setSize(new LogicalSize(WIN_DEFAULT.w, WIN_DEFAULT.h));
}

export function initWindowControls(container) {
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
      let pendingW = null;
      let rafId = null;

      const apply = () => {
        rafId = null;
        if (pendingW == null) return;
        const targetW = pendingW;
        pendingW = null;
        applyAspectClampedWidth(targetW);
      };

      const onMove = (ev) => {
        pendingW = start.w + (ev.screenX - startX);
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

  // 명시적 드래그 핸들러 — 투명 창에서 -webkit-app-region이 종종 누락되는 문제 보완
  container.addEventListener("mousedown", async (e) => {
    if (e.button !== 0) return;
    if (e.target.closest("textarea, button")) return;
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
