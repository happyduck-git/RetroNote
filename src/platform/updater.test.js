import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { makeCheckForUpdate, releaseNotes } from "./updater.js";

// 호출을 기록하는 fake — 인자/순서를 검증. impl 이 던지면 그대로 전파.
function spy(impl) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.calls = calls;
  return fn;
}

// spy 가 첫 인자로 정규식에 맞는 값으로 한 번이라도 호출됐는지.
function calledWithMatch(spyFn, re) {
  return spyFn.calls.some((args) => re.test(String(args[0])));
}

// 콘솔 노이즈 차단(이 모듈은 실패 경로에서 console.error/log 를 찍는다).
let restoreConsole;
beforeEach(() => {
  const origErr = console.error;
  const origLog = console.log;
  console.error = () => {};
  console.log = () => {};
  restoreConsole = () => {
    console.error = origErr;
    console.log = origLog;
  };
});
afterEach(() => restoreConsole());

// 기본 deps 빌더 — "업데이트 있음 + 사용자 동의 + 설치/재시작 성공" 정상 경로.
// 각 테스트는 필요한 부분만 override 하거나 부속물(_update 등)을 직접 손본다.
function buildDeps(overrides = {}) {
  const update = {
    version: "9.9.9",
    // 진행 콜백을 Started→Progress→Finished 순으로 호출(총 100바이트, 40+60).
    downloadAndInstall: spy(async (cb) => {
      cb?.({ event: "Started", data: { contentLength: 100 } });
      cb?.({ event: "Progress", data: { chunkLength: 40 } });
      cb?.({ event: "Progress", data: { chunkLength: 60 } });
      cb?.({ event: "Finished" });
    }),
  };
  const updater = { check: spy(async () => update) };
  // progress() 가 돌려주는 핸들 — 한 번만 만들어 테스트가 set/close 를 들여다본다.
  const progressHandle = { set: spy(), close: spy() };
  const deps = {
    getUpdater: spy(() => updater),
    relaunch: spy(async () => {}),
    confirm: spy(async () => true), // 기본: [UPDATE] 수락
    alert: spy(async () => {}),
    progress: spy(() => progressHandle),
    host: spy(() => undefined),
    // 테스트가 살펴보거나 교체할 수 있도록 노출.
    _update: update,
    _updater: updater,
    _progress: progressHandle,
  };
  return { ...deps, ...overrides };
}

describe("checkForUpdate — no-op 경로 (다이얼로그 안 뜸)", () => {
  test("비-Tauri/플러그인 미주입(getUpdater 가 undefined): 아무것도 안 함", async () => {
    const deps = buildDeps({ getUpdater: spy(() => undefined) });
    await makeCheckForUpdate(deps)();
    assert.equal(deps.confirm.calls.length, 0);
    assert.equal(deps.relaunch.calls.length, 0);
  });

  test("updater 에 check 가 없으면 no-op", async () => {
    const deps = buildDeps({ getUpdater: spy(() => ({})) });
    await makeCheckForUpdate(deps)();
    assert.equal(deps.confirm.calls.length, 0);
  });

  test("check() 가 던지면 조용히 종료(엔드포인트 404 등은 정상)", async () => {
    const deps = buildDeps();
    deps._updater.check = spy(async () => {
      throw new Error("404");
    });
    await makeCheckForUpdate(deps)();
    assert.equal(deps.confirm.calls.length, 0);
    assert.equal(deps._update.downloadAndInstall.calls.length, 0);
  });

  test("최신 버전(check 가 null) 이면 알리지 않음", async () => {
    const deps = buildDeps();
    deps._updater.check = spy(async () => null);
    await makeCheckForUpdate(deps)();
    assert.equal(deps.confirm.calls.length, 0);
    assert.equal(deps._update.downloadAndInstall.calls.length, 0);
  });
});

describe("checkForUpdate — 사용자 동의", () => {
  test("다이얼로그에 새 버전 번호가 들어간다", async () => {
    const deps = buildDeps();
    await makeCheckForUpdate(deps)();
    assert.equal(deps.confirm.calls.length, 1);
    assert.match(deps.confirm.calls[0][0], /9\.9\.9/);
  });

  test("릴리스 노트(body)가 있으면 다이얼로그 details 로 전달", async () => {
    const deps = buildDeps();
    deps._update.body = "- 새 기능 A\n- 버그 수정 B";
    await makeCheckForUpdate(deps)();
    assert.equal(deps.confirm.calls[0][1].details, "- 새 기능 A\n- 버그 수정 B");
  });

  test("릴리스 노트가 없으면 details 는 undefined(노트 박스 없음)", async () => {
    const deps = buildDeps(); // 기본 update 에는 body 없음
    await makeCheckForUpdate(deps)();
    assert.equal(deps.confirm.calls[0][1].details, undefined);
  });

  test("[LATER](confirm=false) 면 다운로드/재시작/진행모달 모두 안 함", async () => {
    const deps = buildDeps({ confirm: spy(async () => false) });
    await makeCheckForUpdate(deps)();
    assert.equal(deps._update.downloadAndInstall.calls.length, 0);
    assert.equal(deps.relaunch.calls.length, 0);
    assert.equal(deps.progress.calls.length, 0);
    assert.equal(deps.alert.calls.length, 0);
  });
});

describe("checkForUpdate — 설치/재시작 결과", () => {
  test("정상 경로: 설치 → 재시작 호출, 실패 안내(alert) 없음", async () => {
    const deps = buildDeps();
    await makeCheckForUpdate(deps)();
    assert.equal(deps._update.downloadAndInstall.calls.length, 1);
    assert.equal(deps.relaunch.calls.length, 1);
    assert.equal(deps.alert.calls.length, 0);
  });

  test("설치 실패: 'UPDATE FAILED' 안내, 재시작은 호출 안 함", async () => {
    const deps = buildDeps();
    deps._update.downloadAndInstall = spy(async () => {
      throw new Error("install boom");
    });
    await makeCheckForUpdate(deps)();
    assert.equal(deps.alert.calls.length, 1);
    assert.match(deps.alert.calls[0][0], /UPDATE FAILED/);
    assert.equal(deps.relaunch.calls.length, 0);
  });

  // 회귀 방지(검토 #3): 설치는 됐는데 재시작만 실패하면 "실패"가 아니라
  // "설치됨 — 재시작하라"로 안내해야 한다. "UPDATE FAILED" 로 오인 표시 금지.
  test("설치 성공 + 재시작 실패: 'UPDATE INSTALLED, 재시작' 안내 (FAILED 아님)", async () => {
    const deps = buildDeps({
      relaunch: spy(async () => {
        throw new Error("relaunch boom");
      }),
    });
    await makeCheckForUpdate(deps)();
    assert.equal(deps._update.downloadAndInstall.calls.length, 1);
    assert.equal(deps.alert.calls.length, 1);
    assert.match(deps.alert.calls[0][0], /UPDATE INSTALLED/);
    assert.doesNotMatch(deps.alert.calls[0][0], /FAILED/);
  });

  // 방어 경로: 다이얼로그조차 못 띄우는 환경(alert 가 throw)에서도 크래시 없이 끝나야 한다.
  test("설치 실패 + alert 까지 throw 해도 크래시 없이 종료", async () => {
    const deps = buildDeps({
      alert: spy(async () => {
        throw new Error("no dialog");
      }),
    });
    deps._update.downloadAndInstall = spy(async () => {
      throw new Error("install boom");
    });
    await assert.doesNotReject(() => makeCheckForUpdate(deps)());
    assert.equal(deps.alert.calls.length, 1); // 시도는 했다
  });
});

describe("releaseNotes", () => {
  test("body 없음/공백 → undefined", () => {
    assert.equal(releaseNotes({}), undefined);
    assert.equal(releaseNotes({ body: "   \n  " }), undefined);
    assert.equal(releaseNotes(null), undefined);
  });

  test("앞뒤 공백은 trim", () => {
    assert.equal(releaseNotes({ body: "  hello\nworld  " }), "hello\nworld");
  });

  test("너무 길면 잘리고 … 가 붙음", () => {
    const long = "x".repeat(2000);
    const out = releaseNotes({ body: long });
    assert.ok(out.length < long.length);
    assert.ok(out.endsWith("…"));
  });
});

describe("checkForUpdate — 진행 표시 모달", () => {
  test("[UPDATE] 후 진행 모달을 띄우고 다운로드 퍼센트→설치→재시작 단계를 갱신", async () => {
    const deps = buildDeps();
    await makeCheckForUpdate(deps)();
    // 모달은 한 번만 생성.
    assert.equal(deps.progress.calls.length, 1);
    // 다운로드 퍼센트(40→100%), 설치, 재시작 문구가 차례로 set 된다.
    assert.ok(calledWithMatch(deps._progress.set, /DOWNLOADING/));
    assert.ok(calledWithMatch(deps._progress.set, /100%/));
    assert.ok(calledWithMatch(deps._progress.set, /INSTALLING/));
    assert.ok(calledWithMatch(deps._progress.set, /RESTARTING/));
    // 정상 경로(재시작 성공)에선 모달을 닫지 않는다(곧 프로세스 재시작).
    assert.equal(deps._progress.close.calls.length, 0);
  });

  test("총 크기 미제공 시 퍼센트 대신 받은 용량(MB) 표시", async () => {
    const deps = buildDeps();
    deps._update.downloadAndInstall = spy(async (cb) => {
      cb?.({ event: "Started", data: {} }); // contentLength 없음
      cb?.({ event: "Progress", data: { chunkLength: 1048576 } }); // 1 MB
    });
    await makeCheckForUpdate(deps)();
    assert.ok(calledWithMatch(deps._progress.set, /MB/));
    assert.ok(!calledWithMatch(deps._progress.set, /%/));
  });

  test("설치 실패 시 진행 모달을 닫는다", async () => {
    const deps = buildDeps();
    deps._update.downloadAndInstall = spy(async () => {
      throw new Error("install boom");
    });
    await makeCheckForUpdate(deps)();
    assert.equal(deps._progress.close.calls.length, 1);
  });

  test("재시작 실패 시 진행 모달을 닫고 안내", async () => {
    const deps = buildDeps({
      relaunch: spy(async () => {
        throw new Error("relaunch boom");
      }),
    });
    await makeCheckForUpdate(deps)();
    assert.equal(deps._progress.close.calls.length, 1);
    assert.ok(calledWithMatch(deps.alert, /UPDATE INSTALLED/));
  });

  test("받은 바이트가 총량을 넘어도 퍼센트는 100 을 안 넘음(클램프)", async () => {
    const deps = buildDeps();
    deps._update.downloadAndInstall = spy(async (cb) => {
      cb({ event: "Started", data: { contentLength: 100 } });
      cb({ event: "Progress", data: { chunkLength: 150 } }); // 총량 초과
    });
    await makeCheckForUpdate(deps)();
    // set 된 어떤 문구에도 100 초과 퍼센트는 없어야 한다.
    const over100 = deps._progress.set.calls.some((a) => {
      const m = String(a[0]).match(/(\d+)%/);
      return m && Number(m[1]) > 100;
    });
    assert.ok(!over100);
    assert.ok(calledWithMatch(deps._progress.set, /100%/));
  });
});
