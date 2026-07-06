// Web Audio 기반 키스트로크 사운드 + 뮤트 토글. 뮤트 버튼(#mute-btn)은 index.html의 상시 크롬.
const SOUND_PATH = "assets/keypress.mp3";
const MUTE_KEY = "retro-note.muted";

let isMuted = localStorage.getItem(MUTE_KEY) === "true";

// 각 키스트로크가 독립 source 노드로 재생되어 빠른 연속 입력에 강함
let audioCtx = null;
let audioBuffer = null;
let soundReady = false;
let loadingPromise = null; // 중복 로딩 방지
let loadFailed = false; // 영구 실패(자산 누락/디코드 불가/미지원). 자산은 번들 고정이라 실패는 사실상 영구 → 재시도·경고 반복 금지
let resumePending = false; // playKey 가 예약한 resume 이 진행 중인지 — suspended 중 연타 시 재생 몰림(pile-up) 방지

async function loadBuffer() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) {
      loadFailed = true;
      return;
    }
    if (!audioCtx) audioCtx = new Ctx();
    const res = await fetch(SOUND_PATH);
    if (!res.ok) throw new Error("sound not found");
    const arr = await res.arrayBuffer();
    audioBuffer = await audioCtx.decodeAudioData(arr);
    soundReady = true;
  } catch (e) {
    // 번들 고정 자산이라 실패는 영구로 간주 → 키 입력마다 재fetch/경고가 쏟아지지 않게 플래그로 봉인
    audioBuffer = null;
    soundReady = false;
    loadFailed = true;
    console.warn("[sound] keypress 로딩 실패, 키사운드 비활성화:", e);
  } finally {
    loadingPromise = null;
  }
}

// 첫 실행 시 한 번만 로딩. 성공했거나 영구 실패로 봉인됐으면 다시 시도하지 않는다.
function ensureLoaded() {
  if (soundReady || loadFailed) return;
  if (!loadingPromise) loadingPromise = loadBuffer();
}

// suspended/interrupted 상태를 running 으로 되살림. macOS WKWebView 는
// 다른 앱의 오디오 점유·절전 복귀·출력장치 변경 시 "interrupted" 로 빠진다.
function resumeCtx() {
  if (audioCtx && audioCtx.state !== "running") {
    // resume 은 Promise. 실패는 무시(다음 기회에 다시 시도)
    audioCtx.resume().catch(() => {});
  }
}

function fireSource() {
  const src = audioCtx.createBufferSource();
  src.buffer = audioBuffer;
  const gain = audioCtx.createGain();
  gain.gain.value = 0.5;
  src.connect(gain).connect(audioCtx.destination);
  src.start(0);
}

export function playKey() {
  if (isMuted) return;
  ensureLoaded();
  if (!soundReady || !audioCtx || !audioBuffer) return;
  // 컨텍스트가 자고 있으면(suspended/interrupted) 깨운 뒤 재생해야 소리가 유실되지 않음.
  // keydown 은 사용자 제스처라 autoplay policy 상 resume 이 허용된다.
  if (audioCtx.state !== "running") {
    // 이미 깨우는 중이면 또 예약하지 않는다 → 깨어난 뒤 소리가 한 번만 나도록(연타 몰림 방지).
    if (resumePending) return;
    resumePending = true;
    audioCtx
      .resume()
      .then(() => {
        resumePending = false;
        // resume 이 resolve 돼도 WKWebView 의 "interrupted" 는 실제로 running 이 안 되는
        // 경우가 있어 소리가 유실됨 → 상태까지 확인. resume 도중 뮤트로 바뀌었을 수도 있어 재확인.
        if (!isMuted && audioBuffer && audioCtx.state === "running") fireSource();
      })
      .catch(() => {
        resumePending = false;
      });
    return;
  }
  fireSource();
}

export function initSound() {
  ensureLoaded();
  // 창 포커스 복귀·탭 표시 전환 시 잠든 컨텍스트를 미리 되살려 다음 입력이 바로 나게 함
  window.addEventListener("focus", resumeCtx);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) resumeCtx();
  });
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
