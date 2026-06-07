// Tauri v2 globals (withGlobalTauri: true)
const { writeTextFile, mkdir, BaseDirectory } = window.__TAURI__.fs;
const { getCurrentWindow, LogicalSize } = window.__TAURI__.window;

const WIN_MIN = { w: 400, h: 360 };
const WIN_MAX = { w: 1400, h: 1260 };
const WIN_DEFAULT = { w: 800, h: 720 };
const ASPECT = 2170 / 1952; // computer.png 비율

const NOTES_DIR = "retro-notes";
const SOUND_PATH = "assets/keypress.mp3";
const MUTE_KEY = "retro-note.muted";

let isMuted = localStorage.getItem(MUTE_KEY) === "true";

// Web Audio API — 각 키스트로크가 독립 source 노드로 재생되어 빠른 연속 입력에 강함
let audioCtx = null;
let audioBuffer = null;
let soundReady = false;

async function initKeySound() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    audioCtx = new Ctx();
    const res = await fetch(SOUND_PATH);
    if (!res.ok) throw new Error("sound not found");
    const arr = await res.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(arr);
    soundReady = true;
  } catch {
    audioCtx = null;
    audioBuffer = null;
    soundReady = false;
  }
}

function playKey() {
  if (isMuted) return;
  if (!soundReady || !audioCtx || !audioBuffer) return;
  // 브라우저 autoplay policy: 사용자 입력 발생 후 첫 호출에서 resume
  if (audioCtx.state === "suspended") audioCtx.resume();
  const src = audioCtx.createBufferSource();
  src.buffer = audioBuffer;
  const gain = audioCtx.createGain();
  gain.gain.value = 0.5;
  src.connect(gain).connect(audioCtx.destination);
  src.start(0);
}

function pad(n) {
  return String(n).padStart(2, "0");
}

function timestamp() {
  const d = new Date();
  return (
    `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` +
    `_${pad(d.getHours())}-${pad(d.getMinutes())}`
  );
}

function shake(container) {
  container.classList.remove("shake");
  // Force reflow so the animation restarts when triggered consecutively.
  void container.offsetWidth;
  container.classList.add("shake");
  setTimeout(() => container.classList.remove("shake"), 450);
}

function showSavedToast(toast) {
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), 1500);
}

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
  await getCurrentWindow().setSize(
    new LogicalSize(WIN_DEFAULT.w, WIN_DEFAULT.h),
  );
}

async function saveNote(content) {
  await mkdir(NOTES_DIR, {
    baseDir: BaseDirectory.Document,
    recursive: true,
  });
  const filename = `note_${timestamp()}.txt`;
  await writeTextFile(`${NOTES_DIR}/${filename}`, content, {
    baseDir: BaseDirectory.Document,
  });
  return filename;
}

window.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("computer-wrap");
  const note = document.getElementById("note");
  const saveBtn = document.getElementById("save-btn");
  const closeBtn = document.getElementById("close-btn");
  const toast = document.getElementById("saved-toast");

  initKeySound();

  // Autofocus on launch
  setTimeout(() => note.focus(), 0);

  note.addEventListener("keydown", () => {
    playKey();
  });

  saveBtn.addEventListener("click", async () => {
    const content = note.value;
    if (content.length === 0) {
      shake(container);
      return;
    }
    try {
      await saveNote(content);
      showSavedToast(toast);
    } catch (err) {
      console.error("save failed:", err);
      shake(container);
    }
  });

  closeBtn.addEventListener("click", async () => {
    await getCurrentWindow().close();
  });

  const muteBtn = document.getElementById("mute-btn");
  const applyMuteUI = () => {
    muteBtn.classList.toggle("muted", isMuted);
    muteBtn.title = isMuted ? "Unmute" : "Mute";
  };
  applyMuteUI();
  muteBtn.addEventListener("click", () => {
    isMuted = !isMuted;
    localStorage.setItem(MUTE_KEY, String(isMuted));
    applyMuteUI();
  });

  // 우하단 그립으로 수동 리사이즈
  // macOS의 transparent + decorations:false 창에서는 startResizeDragging이 silent no-op이라 직접 처리
  const resizeGrip = document.getElementById("resize-grip");
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
});
