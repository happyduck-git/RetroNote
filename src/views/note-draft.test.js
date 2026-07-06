// 헤드리스 테스트: 초안 저장소의 상태 전이만 검증. 에디터/DOM 없이 순수 로직.
// 실제 에디터 doc 은 가변 문자열 fake 로 대체하고 readDoc 이 그걸 읽게 한다.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createDraftStore } from "./note-draft.js";

// 에디터를 흉내내는 헬퍼: doc 을 들고 있는 fake + readDoc 클로저.
function fakeEditor(initial = "") {
  let doc = initial;
  return {
    type: (t) => (doc = t),
    readDoc: () => doc,
  };
}

describe("createDraftStore", () => {
  test("초기 seed 는 빈 문자열", () => {
    const s = createDraftStore();
    assert.equal(s.seed(), "");
  });

  test("새 노트(keep=true)는 화면 재진입 시 초안이 복원된다", () => {
    const s = createDraftStore();
    const ed = fakeEditor();
    // mount: 새 노트로 무장
    s.arm(ed.readDoc, () => true);
    ed.type("작성 중인 메모");
    // unmount: 캡처
    s.captureAndDisarm();
    // 재진입: seed 로 복원
    assert.equal(s.seed(), "작성 중인 메모");
  });

  test("기존 파일 편집분(keep=false)은 보존하지 않는다", () => {
    const s = createDraftStore();
    const ed = fakeEditor();
    s.arm(ed.readDoc, () => false); // startedNew=false 등
    ed.type("기존 파일 수정");
    s.captureAndDisarm();
    assert.equal(s.seed(), "");
  });

  test("첫 저장(clearOnSave) 후 초안이 비워진다", () => {
    const s = createDraftStore();
    const ed = fakeEditor();
    s.arm(ed.readDoc, () => true);
    ed.type("저장할 내용");
    s.clearOnSave();
    assert.equal(s.seed(), "");
  });

  test("captureAndDisarm 은 이후 재캡처를 막는다(캡처 해제)", () => {
    const s = createDraftStore();
    const ed = fakeEditor();
    s.arm(ed.readDoc, () => true);
    ed.type("첫 캡처");
    s.captureAndDisarm();
    // 무장 해제되었으므로 이후 doc 이 바뀌어도 다시 캡처되지 않는다.
    ed.type("이후 변경");
    s.captureAndDisarm();
    assert.equal(s.seed(), "첫 캡처");
  });

  describe("로그아웃 시 초안 폐기 — 호출 순서와 무관", () => {
    // main.js SIGNED_OUT: clearDraft(clear) 와 note unmount(captureAndDisarm) 의
    // 호출 순서가 어떻든 초안이 노출되면 안 된다.
    test("capture 후 clear (navigate → clearDraft 순서)", () => {
      const s = createDraftStore();
      const ed = fakeEditor();
      s.arm(ed.readDoc, () => true);
      ed.type("A 의 비밀 메모");
      s.captureAndDisarm(); // navigate 가 note unmount 로 초안 캡처
      s.clear(); // 그 다음 clearDraft
      assert.equal(s.seed(), "");
    });

    test("clear 후 capture (clearDraft → navigate 순서) — 재캡처로 되살아나지 않는다", () => {
      const s = createDraftStore();
      const ed = fakeEditor();
      s.arm(ed.readDoc, () => true);
      ed.type("A 의 비밀 메모");
      s.clear(); // 먼저 clearDraft 로 폐기 + 캡처 해제
      s.captureAndDisarm(); // 이어서 navigate 의 unmount 가 캡처 시도 → no-op
      assert.equal(s.seed(), "");
    });
  });
});
