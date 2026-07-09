// 화면보호기 장면 모음(#73). 각 start 함수는 canvas 에 애니메이션을 시작하고 stop() 을 반환한다.
// 스타필드/매트릭스 레인 두 장면을 모두 구현해 두고 눈으로 비교한 뒤 하나를 고를 예정 —
// 선택이 끝나면 남은 쪽과 교대 정책(screensaver.js pickScene)을 함께 정리한다.

// styles.css 의 --crt-green / --screen-dark 와 같은 값. canvas 컨텍스트는 CSS 변수를
// 직접 읽지 못하므로 상수로 복제한다(팔레트 변경 시 함께 갱신).
const GREEN = "#00ff41";
const DARK = "#060a06";
const BRIGHT = "#c8ffd8"; // 근접 별/글리프 머리 하이라이트(초록빛 흰색)

// 표시 크기(clientWidth/Height)를 매 프레임 추적해 내부 해상도를 1/scale 로 맞춘다.
// scale>1 이면 CSS image-rendering:pixelated 업스케일로 굵은 픽셀감을 얻는다.
// 리사이즈로 버퍼 크기가 바뀌면 true 를 반환(장면 상태 재생성 신호).
function fitCanvas(canvas, scale) {
  const w = Math.max(1, Math.floor(canvas.clientWidth / scale));
  const h = Math.max(1, Math.floor(canvas.clientHeight / scale));
  if (canvas.width === w && canvas.height === h) return false;
  canvas.width = w;
  canvas.height = h;
  return true;
}

// 스타필드: 화면 중심에서 별이 바깥으로 날아오는 워프. 반투명 어두운 채우기로 잔상 트레일.
export function startStarfield(canvas) {
  const ctx = canvas.getContext("2d");
  const SCALE = 2; // 내부 해상도 1/2 → 픽셀 2배 굵기
  const SPEED = 0.4; // z 감소 속도(초당). 클수록 빠른 워프.
  let stars = null;
  let raf = 0;
  let prev = 0;

  // 중심 기준 단위 평면 좌표(x,y ∈ [-1,1]) + 깊이 z(1=먼 곳, 0=눈앞). z 로 나눠 투영한다.
  const spawn = (zMin, zMax) => ({
    x: Math.random() * 2 - 1,
    y: Math.random() * 2 - 1,
    z: zMin + Math.random() * (zMax - zMin),
  });

  const frame = (t) => {
    if (fitCanvas(canvas, SCALE)) stars = null;
    const w = canvas.width;
    const h = canvas.height;
    if (!stars) {
      // 별 수는 면적 비례(작은 화면에서 과밀·큰 화면에서 휑함 방지)
      const count = Math.max(40, Math.min(180, Math.round((w * h) / 160)));
      stars = Array.from({ length: count }, () => spawn(0.2, 1));
      ctx.fillStyle = DARK;
      ctx.fillRect(0, 0, w, h);
    }
    const dt = Math.min(0.05, Math.max(0.001, (t - prev) / 1000)); // 탭 복귀 등 큰 공백 클램프
    prev = t;

    ctx.fillStyle = "rgba(6, 10, 6, 0.35)"; // DARK 의 반투명 — 잔상 트레일
    ctx.fillRect(0, 0, w, h);
    const cx = w / 2;
    const cy = h / 2;
    const focal = Math.min(w, h) / 2;
    for (const s of stars) {
      s.z -= dt * SPEED;
      const sx = cx + (s.x / s.z) * focal;
      const sy = cy + (s.y / s.z) * focal;
      if (s.z <= 0.05 || sx < 0 || sx >= w || sy < 0 || sy >= h) {
        Object.assign(s, spawn(0.7, 1)); // 화면 밖/눈앞 통과 → 먼 곳에서 재출발
        continue;
      }
      const size = Math.max(1, Math.round((1 - s.z) * 3)); // 가까울수록 큰 픽셀
      ctx.fillStyle = s.z < 0.25 ? BRIGHT : GREEN;
      ctx.globalAlpha = Math.min(1, 1.3 - s.z); // 멀수록 어둡게
      ctx.fillRect(Math.round(sx), Math.round(sy), size, size);
    }
    ctx.globalAlpha = 1;
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}

// 매트릭스 레인: 열마다 글리프가 흘러내리고 반투명 채우기로 꼬리가 사라진다.
// 글리프는 픽셀 폰트만 사용(VT323=숫자/기호, Galmuri11Adj=한글) — 시스템 폰트 폴백으로
// 레트로 룩이 깨지지 않도록 두 폰트가 커버하는 문자만 쓴다.
export function startMatrixRain(canvas) {
  const ctx = canvas.getContext("2d");
  const STEP_MS = 75; // ≈13fps 저속 스텝 — 고전 연출
  const CHARS = "0123456789<>=*+-ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ레트로노트";
  let drops = null; // 열별 머리 위치(셀 단위). 음수면 아직 화면 위(시차 스타트).
  let cell = 12;
  let raf = 0;
  let prev = 0;
  let acc = 0;

  const rand = (n) => Math.floor(Math.random() * n);

  const step = (w, h) => {
    ctx.fillStyle = "rgba(6, 10, 6, 0.2)"; // 스텝마다 살짝 어둡게 → 지나간 글리프가 꼬리로 남음
    ctx.fillRect(0, 0, w, h);
    ctx.font = `${cell}px "VT323", "Galmuri11Adj", monospace`;
    ctx.textBaseline = "top";
    for (let i = 0; i < drops.length; i++) {
      const y = drops[i] * cell;
      if (y >= 0 && y < h) {
        ctx.fillStyle = Math.random() < 0.06 ? BRIGHT : GREEN; // 드물게 밝은 머리로 반짝임
        ctx.fillText(CHARS[rand(CHARS.length)], i * cell, y);
      }
      // 바닥을 지나면 확률적으로만 리셋 → 열마다 꼬리 길이/주기가 달라진다(고전 연출)
      if (y > h && Math.random() > 0.97) drops[i] = -rand(6);
      else drops[i]++;
    }
  };

  const frame = (t) => {
    if (fitCanvas(canvas, 1)) drops = null; // 픽셀 폰트 자체가 픽셀감을 주므로 업스케일 불필요
    const w = canvas.width;
    const h = canvas.height;
    if (!drops) {
      cell = Math.max(10, Math.round(h / 18));
      const nrows = Math.ceil(h / cell);
      drops = Array.from({ length: Math.max(1, Math.ceil(w / cell)) }, () => -rand(nrows));
      ctx.fillStyle = DARK;
      ctx.fillRect(0, 0, w, h);
    }
    acc += Math.min(250, t - prev); // 탭 복귀 등 큰 공백 클램프
    prev = t;
    if (acc >= STEP_MS) {
      acc %= STEP_MS;
      step(w, h);
    }
    raf = requestAnimationFrame(frame);
  };
  raf = requestAnimationFrame(frame);
  return () => cancelAnimationFrame(raf);
}
