import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { buildCommandSuggest } from "./command-suggest.js";

// buildCommandSuggest 의 실제 DOM 배선을 jsdom 위에서 구동한다.
// (순수 매칭/파싱은 slash-command.test.js 가 커버 — 여기선 렌더·하이라이트·표시상태와
//  바깥 클릭 닫기(document mousedown 리스너)만 본다.)

let dom;
let win;
let saved;

function fire(target, type) {
  const ev = new win.Event(type, { bubbles: true, cancelable: true });
  target.dispatchEvent(ev);
  return ev;
}

// 자동완성 팝업 + 형제로 입력창/SEND/바깥 요소를 붙인 테스트용 DOM.
function mount(suggest) {
  const input = win.document.createElement("input");
  input.className = "field room-input";
  const sendBtn = win.document.createElement("button");
  sendBtn.className = "btn room-send";
  const outside = win.document.createElement("div");
  outside.className = "outside";
  win.document.body.append(suggest.listEl, input, sendBtn, outside);
  return { input, sendBtn, outside };
}

const itemNames = (s) =>
  [...s.listEl.querySelectorAll(".room-command-suggest-name")].map((n) => n.textContent);
const activeName = (s) =>
  s.listEl.querySelector(".room-command-suggest-item.active .room-command-suggest-name")?.textContent;

beforeEach(() => {
  dom = new JSDOM(`<!doctype html><html><body></body></html>`);
  win = dom.window;
  saved = { window: globalThis.window, document: globalThis.document };
  globalThis.window = win;
  globalThis.document = win.document;
});

afterEach(() => {
  globalThis.window = saved.window;
  globalThis.document = saved.document;
  win.close();
});

describe("buildCommandSuggest 배선", () => {
  test("/ 접두 입력 → 후보 렌더 + 첫 항목 하이라이트", () => {
    const s = buildCommandSuggest({ onRun: () => {} });
    mount(s);
    s.update("/pe");
    assert.equal(s.listEl.hidden, false);
    assert.ok(s.isOpen());
    assert.deepEqual(itemNames(s), ["/pet"]);
    assert.equal(activeName(s), "/pet");
    assert.equal(s.current(), "pet");
  });

  test("/ 만 입력 → 전체 목록(pet, help)", () => {
    const s = buildCommandSuggest({ onRun: () => {} });
    mount(s);
    s.update("/");
    assert.deepEqual(itemNames(s), ["/pet", "/help"]);
  });

  test("비명령/무매칭/뒤 공백은 숨김", () => {
    const s = buildCommandSuggest({ onRun: () => {} });
    mount(s);
    s.update("hello");
    assert.equal(s.isOpen(), false);
    s.update("/z");
    assert.equal(s.isOpen(), false);
    s.update("/pet "); // 이름 확정(뒤 공백) → 자동완성 숨김
    assert.equal(s.isOpen(), false);
  });

  test("move 로 하이라이트 순환(양방향 wrap), current 반영", () => {
    const s = buildCommandSuggest({ onRun: () => {} });
    mount(s);
    s.update("/"); // pet, help
    assert.equal(s.current(), "pet");
    s.move(1);
    assert.equal(s.current(), "help");
    assert.equal(activeName(s), "/help");
    s.move(1); // 끝 → 처음으로 순환
    assert.equal(s.current(), "pet");
    s.move(-1); // 처음 → 끝으로 역순환
    assert.equal(s.current(), "help");
  });

  test("항목 mousedown → onRun(name) 호출 + 기본동작 취소(포커스 유지)", () => {
    let ran = null;
    const s = buildCommandSuggest({ onRun: (name) => (ran = name) });
    mount(s);
    s.update("/"); // pet 하이라이트
    const firstItem = s.listEl.querySelector(".room-command-suggest-item");
    const ev = fire(firstItem, "mousedown");
    assert.equal(ran, "pet");
    assert.equal(ev.defaultPrevented, true);
  });

  test("바깥 클릭(mousedown) → 목록 닫힘", () => {
    const s = buildCommandSuggest({ onRun: () => {} });
    const { outside } = mount(s);
    s.update("/pe");
    assert.ok(s.isOpen());
    fire(outside, "mousedown");
    assert.equal(s.isOpen(), false);
  });

  test("입력창/SEND mousedown 은 목록을 닫지 않는다(각자 로직이 확정)", () => {
    const s = buildCommandSuggest({ onRun: () => {} });
    const { input, sendBtn } = mount(s);
    s.update("/pe");
    fire(input, "mousedown");
    assert.ok(s.isOpen(), "입력창 클릭으로 닫히면 안 된다");
    fire(sendBtn, "mousedown");
    assert.ok(s.isOpen(), "SEND 클릭으로 닫히면 안 된다");
  });

  test("항목 위 mousedown 은 바깥클릭 취급 안 함(닫히지 않음)", () => {
    const s = buildCommandSuggest({ onRun: () => {} });
    mount(s);
    s.update("/");
    const item = s.listEl.querySelector(".room-command-suggest-item");
    fire(item, "mousedown"); // onRun 은 no-op → 목록 자체는 유지
    assert.ok(s.isOpen());
  });

  test("표시/숨김에 따라 document mousedown 리스너를 균형 있게 등록/해제(누수 방지)", () => {
    const added = [];
    const removed = [];
    const origAdd = win.document.addEventListener.bind(win.document);
    const origRemove = win.document.removeEventListener.bind(win.document);
    win.document.addEventListener = (type, fn, opts) => {
      if (type === "mousedown") added.push(fn);
      return origAdd(type, fn, opts);
    };
    win.document.removeEventListener = (type, fn, opts) => {
      if (type === "mousedown") removed.push(fn);
      return origRemove(type, fn, opts);
    };
    const s = buildCommandSuggest({ onRun: () => {} });
    mount(s);
    s.update("/pe"); // 표시 → 등록 +1
    assert.equal(added.length, 1);
    s.update("/p"); // 이미 열림 → 중복 등록 없음
    assert.equal(added.length, 1, "이미 열린 상태면 리스너를 다시 등록하지 않는다");
    s.hide(); // 해제 -1
    assert.equal(removed.length, 1);
    assert.equal(removed[0], added[0], "등록한 것과 같은 핸들러를 해제한다");
  });

  test("닫힘 상태의 current 는 null", () => {
    const s = buildCommandSuggest({ onRun: () => {} });
    mount(s);
    assert.equal(s.current(), null);
  });
});
