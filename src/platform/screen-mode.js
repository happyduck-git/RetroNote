// 앱 전역 "베젤 화면" 모드: 모니터 이미지 대신 창을 채우는 레트로 베젤 프레임으로 전환.
// #screen-mode-btn(index.html 상시 크롬)로 토글, localStorage 로 영속. sound.js 뮤트 패턴 참고.
const BEZEL_KEY = "retro-note.bezel-mode";
// 구 키 승계: v0.1.10의 "retro-note.large-screen" 값이 있으면 새 키로 읽어 기존 설정 보존.
const LEGACY_KEY = "retro-note.large-screen";

// 의존성 주입 factory — 테스트가 fake storage/root 를 주입해 순수 검증(session.js 컨벤션).
//   root: 클래스가 붙는 노드(실사용 document.body). storage: localStorage 호환 객체.
export function makeScreenMode({ storage, root }) {
  let bezelMode =
    (storage.getItem(BEZEL_KEY) ?? storage.getItem(LEGACY_KEY)) === "true";
  const listeners = new Set();

  const apply = () => {
    root.classList.toggle("bezel-mode", bezelMode);
  };
  const isBezelMode = () => bezelMode;
  const set = (next) => {
    next = !!next;
    if (next === bezelMode) return; // 값 변화 없으면 no-op(쓰기/통지 생략)
    bezelMode = next;
    storage.setItem(BEZEL_KEY, String(bezelMode));
    apply();
    for (const fn of listeners) fn(bezelMode);
  };
  const toggle = () => set(!bezelMode);
  const onChange = (fn) => {
    listeners.add(fn);
    return () => listeners.delete(fn);
  };

  return { apply, isBezelMode, set, toggle, onChange };
}

// 실제 DOM/스토리지로 빌드한 기본 인스턴스. 순수 유닛테스트에서 import 시엔(document 없음) null.
const instance =
  typeof document !== "undefined" && typeof localStorage !== "undefined"
    ? makeScreenMode({ storage: localStorage, root: document.body })
    : null;

// 모듈 로드 시점(main.js 는 <script type="module" defer> 라 import 그래프가
// DOMContentLoaded 이전에 평가되고, defer 로 document.body 존재가 보장됨)에 즉시 클래스 반영
// → 첫 뷰 mount 이전에 프레임이 확정되어 default→bezel 플래시를 방지한다.
instance?.apply();

export function isBezelMode() {
  return instance ? instance.isBezelMode() : false;
}

export function onScreenModeChange(fn) {
  return instance ? instance.onChange(fn) : () => {};
}

export function initScreenMode() {
  if (!instance) return;
  instance.apply(); // 멱등 재적용(안전)
  const btn = document.getElementById("screen-mode-btn");
  if (!btn) return;
  const applyBtnUI = () => {
    btn.classList.toggle("active", instance.isBezelMode());
    btn.title = instance.isBezelMode() ? "Default screen" : "Bezel screen";
  };
  applyBtnUI();
  instance.onChange(applyBtnUI);
  btn.addEventListener("click", () => instance.toggle());
}
