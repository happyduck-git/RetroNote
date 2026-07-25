import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseSlashCommand, makeSlashDispatcher, suggestQuery, matchCommands } from "./slash-command.js";

// 호출을 기록하는 fake — 인자/횟수를 검증.
function spy(impl) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.calls = calls;
  return fn;
}

describe("parseSlashCommand", () => {
  test("/ 로 시작하지 않으면 비명령", () => {
    assert.deepEqual(parseSlashCommand("hello"), { isCommand: false });
    assert.deepEqual(parseSlashCommand("안녕하세요"), { isCommand: false });
    assert.deepEqual(parseSlashCommand(""), { isCommand: false });
    // 문장 중간의 / 는 명령이 아니다.
    assert.deepEqual(parseSlashCommand("a/b"), { isCommand: false });
  });

  test("/pet, /help 는 명령으로 파싱", () => {
    assert.deepEqual(parseSlashCommand("/pet"), { isCommand: true, name: "pet", args: "" });
    assert.deepEqual(parseSlashCommand("/help"), { isCommand: true, name: "help", args: "" });
  });

  test("명령 이름은 대소문자 무시(소문자 정규화)", () => {
    assert.equal(parseSlashCommand("/PET").name, "pet");
    assert.equal(parseSlashCommand("/Help").name, "help");
  });

  test("앞뒤 공백은 트림 후 판별", () => {
    assert.deepEqual(parseSlashCommand("  /pet  "), { isCommand: true, name: "pet", args: "" });
  });

  test('"/" 만 입력하면 빈 이름의 명령', () => {
    assert.deepEqual(parseSlashCommand("/"), { isCommand: true, name: "", args: "" });
  });

  test("이름 뒤 인자는 args 로 분리", () => {
    assert.deepEqual(parseSlashCommand("/pet cream"), { isCommand: true, name: "pet", args: "cream" });
    assert.deepEqual(parseSlashCommand("/foo a b c"), { isCommand: true, name: "foo", args: "a b c" });
  });

  test("null/undefined 도 안전하게 비명령 처리", () => {
    assert.deepEqual(parseSlashCommand(undefined), { isCommand: false });
    assert.deepEqual(parseSlashCommand(null), { isCommand: false });
  });
});

// 부수효과(navigate/showBanner)를 fake 로 주입해 각 명령이 올바른 collaborator 를 부르는지 검증.
function buildDeps(overrides = {}) {
  return { navigate: spy(), showBanner: spy(), ...overrides };
}

describe("makeSlashDispatcher", () => {
  test("/pet → navigate('pet-settings') 만 호출, true 반환", () => {
    const deps = buildDeps();
    const dispatch = makeSlashDispatcher(deps);
    assert.equal(dispatch("/pet"), true);
    assert.deepEqual(deps.navigate.calls, [["pet-settings"]]);
    assert.equal(deps.showBanner.calls.length, 0);
  });

  test("/help → showBanner 로 목록(pet/help 포함) 표시, navigate 미호출", () => {
    const deps = buildDeps();
    const dispatch = makeSlashDispatcher(deps);
    assert.equal(dispatch("/help"), true);
    assert.equal(deps.navigate.calls.length, 0);
    assert.equal(deps.showBanner.calls.length, 1);
    const banner = deps.showBanner.calls[0][0];
    assert.match(banner, /\/pet/);
    assert.match(banner, /\/help/);
  });

  test("알 수 없는 명령 → '알 수 없는 명령어' 배너, navigate 미호출, true", () => {
    const deps = buildDeps();
    const dispatch = makeSlashDispatcher(deps);
    assert.equal(dispatch("/foo"), true);
    assert.equal(deps.navigate.calls.length, 0);
    assert.equal(deps.showBanner.calls.length, 1);
    assert.match(deps.showBanner.calls[0][0], /알 수 없는 명령어/);
    assert.match(deps.showBanner.calls[0][0], /\/foo/);
  });

  test("일반 메시지 → false 반환, 아무 collaborator 미호출", () => {
    const deps = buildDeps();
    const dispatch = makeSlashDispatcher(deps);
    assert.equal(dispatch("hello"), false);
    assert.equal(deps.navigate.calls.length, 0);
    assert.equal(deps.showBanner.calls.length, 0);
  });

  test("/PET(대소문자), 앞뒤 공백도 /pet 과 동일 동작", () => {
    const deps = buildDeps();
    const dispatch = makeSlashDispatcher(deps);
    assert.equal(dispatch("  /PET  "), true);
    assert.deepEqual(deps.navigate.calls, [["pet-settings"]]);
  });
});

describe("suggestQuery", () => {
  test("/ 로 시작하고 공백 없으면 뒤 토큰(소문자) 반환", () => {
    assert.equal(suggestQuery("/"), "");
    assert.equal(suggestQuery("/p"), "p");
    assert.equal(suggestQuery("/PET"), "pet");
    assert.equal(suggestQuery("  /he"), "he"); // 앞 공백 허용
  });

  test("공백이 들어가면(이름 확정/인자) null → 숨김", () => {
    assert.equal(suggestQuery("/pet "), null);
    assert.equal(suggestQuery("/pet cream"), null);
  });

  test("/ 로 시작 안 하면 null", () => {
    assert.equal(suggestQuery("hello"), null);
    assert.equal(suggestQuery(""), null);
    assert.equal(suggestQuery("a/b"), null);
    assert.equal(suggestQuery(undefined), null);
  });
});

describe("matchCommands", () => {
  const names = (q) => matchCommands(q).map((c) => c.name);

  test("빈 query 는 전체(등록 순서: pet, help)", () => {
    assert.deepEqual(names(""), ["pet", "help"]);
  });

  test("접두 일치가 substring 보다 먼저", () => {
    // "p": pet 은 접두(0), help 는 substring(위치 3) → pet 먼저
    assert.deepEqual(names("p"), ["pet", "help"]);
  });

  test("이름에 없는 글자는 제외", () => {
    assert.deepEqual(names("h"), ["help"]);
    assert.deepEqual(names("t"), ["pet"]);
    assert.deepEqual(names("z"), []);
  });

  test("대소문자 무시", () => {
    assert.deepEqual(names("P"), ["pet", "help"]);
  });

  test("각 항목은 name + description", () => {
    assert.deepEqual(matchCommands("pet")[0], { name: "pet", description: "펫 설정 열기" });
  });
});
