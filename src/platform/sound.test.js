import { test, describe, afterEach } from "node:test";
import assert from "node:assert/strict";

// sound.js 는 DI 팩토리가 아니라 전역(window/fetch/localStorage)을 직접 참조한다.
// 그래서 전역을 가짜로 갈아끼우고, 테스트마다 모듈을 "새 인스턴스"로 불러(캐시버스팅)
// 내부 상태(soundReady/loadFailed 등)를 노출 없이 동작으로 검증한다.
//   - fetch 호출 횟수 → 로딩이 한 번만/재시도 안 함 을 확인
//   - createBufferSource().start() 호출(records.starts) → 실제 재생 여부

let importSeq = 0;
async function loadSound() {
  importSeq += 1;
  // 쿼리스트링이 다르면 Node ESM 이 별도 모듈로 취급 → 모듈 전역 상태가 초기화됨.
  return import(new URL(`./sound.js?case=${importSeq}`, import.meta.url));
}

// 한 번의 매크로태스크 뒤로 미뤄 대기 중 마이크로태스크(fetch→decode 체인, resume().then)를 모두 흘려보냄.
const tick = () => new Promise((r) => setTimeout(r, 0));
async function flush() {
  await tick();
  await tick();
}

function newRecords() {
  return { fetches: 0, resumeCalls: 0, starts: 0, ctx: null };
}

// 가짜 AudioContext 생성자. initialState/resumeTo 로 suspended·interrupted 시나리오를 만든다.
function makeAudioCtor(rec, { initialState = "running", resumeTo = "running", asyncResume = false } = {}) {
  return class FakeAudioContext {
    constructor() {
      this.state = initialState;
      rec.ctx = this;
    }
    decodeAudioData() {
      return Promise.resolve({ fake: "buffer" });
    }
    resume() {
      rec.resumeCalls += 1;
      // asyncResume: 상태 전환을 마이크로태스크로 미뤄 "resume 은 비동기" 를 사실적으로 흉내낸다
      // (연타 몰림·resume 도중 뮤트 같은 타이밍 경계를 재현하려면 필요).
      if (asyncResume) {
        return Promise.resolve().then(() => {
          this.state = resumeTo;
        });
      }
      this.state = resumeTo;
      return Promise.resolve();
    }
    createBufferSource() {
      return {
        buffer: null,
        connect(node) {
          return node;
        },
        start() {
          rec.starts += 1;
        },
      };
    }
    createGain() {
      return {
        gain: { value: 0 },
        connect(node) {
          return node;
        },
      };
    }
    get destination() {
      return {};
    }
  };
}

function okFetch(rec) {
  return async () => {
    rec.fetches += 1;
    return { ok: true, arrayBuffer: async () => new ArrayBuffer(8) };
  };
}

function notFoundFetch(rec) {
  return async () => {
    rec.fetches += 1;
    return { ok: false };
  };
}

let restore = null;
function installGlobals({ muted = false, fetchImpl, AudioCtor } = {}) {
  const orig = {
    window: globalThis.window,
    fetch: globalThis.fetch,
    localStorage: globalThis.localStorage,
    document: globalThis.document,
    warn: console.warn,
  };
  console.warn = () => {}; // 로딩 실패 경로의 경고 노이즈 차단
  const store = new Map();
  if (muted) store.set("retro-note.muted", "true");
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
  };
  globalThis.fetch = fetchImpl;
  globalThis.window = { AudioContext: AudioCtor, addEventListener() {} };
  globalThis.document = { addEventListener() {}, getElementById: () => null, hidden: false };
  restore = () => {
    globalThis.window = orig.window;
    globalThis.fetch = orig.fetch;
    globalThis.localStorage = orig.localStorage;
    globalThis.document = orig.document;
    console.warn = orig.warn;
  };
}
afterEach(() => {
  restore?.();
  restore = null;
});

describe("sound — 뮤트", () => {
  test("뮤트면 로딩도 재생도 하지 않는다", async () => {
    const rec = newRecords();
    installGlobals({ muted: true, fetchImpl: okFetch(rec), AudioCtor: makeAudioCtor(rec) });
    const { playKey } = await loadSound();
    playKey();
    await flush();
    assert.equal(rec.fetches, 0); // isMuted 단락 → ensureLoaded 도달 안 함
    assert.equal(rec.starts, 0);
  });
});

describe("sound — 로딩", () => {
  test("정상: 로드 완료 후 keydown 이 소리를 낸다", async () => {
    const rec = newRecords();
    installGlobals({ fetchImpl: okFetch(rec), AudioCtor: makeAudioCtor(rec) });
    const { playKey } = await loadSound();
    playKey(); // 첫 호출이 로딩을 시작(아직 미준비 → 이 타이밍엔 재생 안 됨)
    await flush();
    playKey(); // 이제 준비됨 + running → 재생
    await flush();
    assert.equal(rec.fetches, 1);
    assert.ok(rec.starts >= 1);
  });

  test("로딩은 딱 한 번만 (동시/이후 호출 모두 재fetch 안 함)", async () => {
    const rec = newRecords();
    installGlobals({ fetchImpl: okFetch(rec), AudioCtor: makeAudioCtor(rec) });
    const { playKey } = await loadSound();
    playKey();
    playKey(); // 아직 로딩 중 — loadingPromise 가드로 중복 로드 방지
    await flush();
    playKey(); // 이미 준비됨 — soundReady 단락
    await flush();
    assert.equal(rec.fetches, 1);
  });

  test("로딩 실패는 봉인: 이후 keydown 마다 재fetch/재시도하지 않는다", async () => {
    const rec = newRecords();
    installGlobals({ fetchImpl: notFoundFetch(rec), AudioCtor: makeAudioCtor(rec) });
    const { playKey } = await loadSound();
    playKey();
    await flush(); // 실패 → loadFailed 봉인
    playKey();
    await flush();
    playKey();
    await flush();
    assert.equal(rec.fetches, 1); // 첫 실패 이후 재fetch 없음
    assert.equal(rec.starts, 0);
  });
});

describe("sound — 컨텍스트 깨우기", () => {
  test("suspended 면 resume 후 재생한다", async () => {
    const rec = newRecords();
    installGlobals({
      fetchImpl: okFetch(rec),
      AudioCtor: makeAudioCtor(rec, { initialState: "suspended", resumeTo: "running" }),
    });
    const { playKey } = await loadSound();
    playKey();
    await flush(); // 로드 완료(컨텍스트는 여전히 suspended)
    playKey(); // state !== running → resume().then(fireSource)
    await flush();
    assert.ok(rec.resumeCalls >= 1);
    assert.ok(rec.starts >= 1);
  });

  // L1 회귀 방지: WKWebView 의 "interrupted" 는 resume() 이 resolve 돼도 running 이 안 될 수 있다.
  // 이때 재생하면 멈춘 그래프에 start(0) → 무음. 그래서 .then 에서 state === "running" 까지 확인해야 한다.
  test("resume 이 resolve 돼도 running 이 아니면 재생하지 않는다 (interrupted)", async () => {
    const rec = newRecords();
    installGlobals({
      fetchImpl: okFetch(rec),
      AudioCtor: makeAudioCtor(rec, { initialState: "suspended", resumeTo: "interrupted" }),
    });
    const { playKey } = await loadSound();
    playKey();
    await flush();
    playKey(); // resume 은 되지만 상태가 interrupted 로 남음
    await flush();
    assert.ok(rec.resumeCalls >= 1);
    assert.equal(rec.starts, 0); // 멈춘 컨텍스트에 재생하지 않음
  });
});

describe("sound — 연타/뮤트 경계", () => {
  test("suspended 중 빠른 연타 → 깨어난 뒤 소리는 한 번만 (몰림 방지)", async () => {
    const rec = newRecords();
    installGlobals({
      fetchImpl: okFetch(rec),
      AudioCtor: makeAudioCtor(rec, { initialState: "suspended", resumeTo: "running", asyncResume: true }),
    });
    const { playKey } = await loadSound();
    playKey(); // 로딩 시작(아직 미준비)
    await flush(); // 로드 완료, 컨텍스트는 여전히 suspended
    // 컨텍스트가 잠든 동안 5번 연타 — 첫 호출만 resume 을 예약해야 한다(resumePending 가드).
    playKey();
    playKey();
    playKey();
    playKey();
    playKey();
    await flush();
    assert.equal(rec.resumeCalls, 1); // resume 예약은 딱 한 번
    assert.equal(rec.starts, 1); // 소리도 한 번만(몰림 없음)
  });

  test("resume 도중 뮤트로 바뀌면 재생하지 않는다", async () => {
    const rec = newRecords();
    installGlobals({
      fetchImpl: okFetch(rec),
      AudioCtor: makeAudioCtor(rec, { initialState: "suspended", resumeTo: "running", asyncResume: true }),
    });
    // 뮤트 버튼 fake 를 심어 initSound 가 클릭 핸들러를 배선하게 한다.
    let clickMute = null;
    const btn = {
      classList: { toggle() {} },
      title: "",
      addEventListener: (ev, fn) => {
        if (ev === "click") clickMute = fn;
      },
    };
    globalThis.document.getElementById = (id) => (id === "mute-btn" ? btn : null);
    const { playKey, initSound } = await loadSound();
    initSound(); // 로딩 시작 + 뮤트 버튼 배선
    await flush(); // 로드 완료(suspended)
    playKey(); // resume + .then(fireSource) 예약
    clickMute(); // resume 완료 전에 뮤트 ON
    await flush();
    assert.ok(rec.resumeCalls >= 1);
    assert.equal(rec.starts, 0); // 뮤트로 바뀌어 재생 안 함
  });

  test("AudioContext 미지원이면 봉인 — 크래시 없이 재fetch/재생 안 함", async () => {
    const rec = newRecords();
    installGlobals({ fetchImpl: okFetch(rec), AudioCtor: undefined }); // window.AudioContext 없음
    const { playKey } = await loadSound();
    playKey();
    await flush();
    playKey();
    await flush();
    assert.equal(rec.fetches, 0); // Ctx 없음 → fetch 전에 loadFailed 봉인
    assert.equal(rec.starts, 0);
  });
});
