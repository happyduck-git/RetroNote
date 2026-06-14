// Web Audio 기반 키스트로크 사운드 + 뮤트 토글. 뮤트 버튼(#mute-btn)은 index.html의 상시 크롬.
const SOUND_PATH = "assets/keypress.mp3";
const MUTE_KEY = "retro-note.muted";

let isMuted = localStorage.getItem(MUTE_KEY) === "true";

// 각 키스트로크가 독립 source 노드로 재생되어 빠른 연속 입력에 강함
let audioCtx = null;
let audioBuffer = null;
let soundReady = false;

async function loadBuffer() {
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

export function playKey() {
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

export function initSound() {
  loadBuffer();
  const muteBtn = document.getElementById("mute-btn");
  if (!muteBtn) return;
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
}
