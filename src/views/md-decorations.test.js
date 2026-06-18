// 헤드리스 테스트: Lezer 마크다운 파서로 트리를 만들고 collectRanges 결과를 검증.
// CodeMirror 뷰/DOM 없이 순수 함수만 본다. parser 는 vendor 번들과 동일하게 GFM 구성.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parser as baseParser, GFM } from "@lezer/markdown";
import { collectRanges, makeStringDoc } from "./md-decorations.js";

const parser = baseParser.configure(GFM);

function ranges(text) {
  const tree = parser.parse(text);
  return collectRanges(tree, makeStringDoc(text));
}

describe("collectRanges — line decorations", () => {
  test("ATX 제목은 레벨별 줄 kind 를 만든다", () => {
    assert.deepEqual(ranges("# H1").lines, [{ line: 1, kind: "h1" }]);
    assert.deepEqual(ranges("###### H6").lines, [{ line: 1, kind: "h6" }]);
  });

  test("줄 번호는 1-based 이며 여러 줄에서 정확하다", () => {
    const r = ranges("para\n## second\n### third");
    assert.deepEqual(r.lines, [
      { line: 2, kind: "h2" },
      { line: 3, kind: "h3" },
    ]);
  });

  test("불릿/번호 리스트는 ul/ol 로 구분된다", () => {
    assert.deepEqual(ranges("- item").lines, [{ line: 1, kind: "ul" }]);
    assert.deepEqual(ranges("1. item").lines, [{ line: 1, kind: "ol" }]);
  });

  test("인용은 걸친 모든 줄에 quote kind", () => {
    const r = ranges("> a\n> b");
    assert.deepEqual(
      r.lines.filter((l) => l.kind === "quote"),
      [{ line: 1, kind: "quote" }, { line: 2, kind: "quote" }],
    );
  });
});

describe("collectRanges — inline marks", () => {
  test("bold/italic/strike/code 범위(마커 포함)", () => {
    assert.deepEqual(ranges("**b**").marks, [{ from: 0, to: 5, kind: "bold" }]);
    assert.deepEqual(ranges("*i*").marks, [{ from: 0, to: 3, kind: "italic" }]);
    assert.deepEqual(ranges("~~s~~").marks, [{ from: 0, to: 5, kind: "strike" }]);
    assert.deepEqual(ranges("`c`").marks, [{ from: 0, to: 3, kind: "code" }]);
  });

  test("링크는 link mark 1개로 묶인다", () => {
    const r = ranges("[t](http://x)");
    assert.deepEqual(r.marks, [{ from: 0, to: 13, kind: "link" }]);
  });
});

describe("collectRanges — hideable markers", () => {
  test("제목 마커(#)는 뒤따르는 공백까지 숨김 (앞 공백 잔존 방지)", () => {
    const r = ranges("# H1");
    assert.deepEqual(r.hides, [{ from: 0, to: 2, line: 1, kind: "syntax" }]);
  });

  test("인용 마커(>)도 뒤 공백까지 숨김", () => {
    const r = ranges("> a").hides;
    assert.deepEqual(r, [{ from: 0, to: 2, line: 1, kind: "syntax" }]);
  });

  test("ATX 닫는 마커(## Title ##)는 앞 공백까지 흡수 (잔여 공백 방지)", () => {
    // "## T ##": 여는 [0,2]+공백 → [0,3], 닫는 공백[4]+[5,7] → [4,7], 남는 건 "T"([3,4]).
    const r = ranges("## T ##").hides;
    assert.deepEqual(r, [
      { from: 0, to: 3, line: 1, kind: "syntax" },
      { from: 4, to: 7, line: 1, kind: "syntax" },
    ]);
  });

  test("bold 는 양쪽 EmphasisMark 를 숨김 후보로", () => {
    const hides = ranges("**b**").hides;
    assert.deepEqual(hides, [
      { from: 0, to: 2, line: 1, kind: "syntax" },
      { from: 3, to: 5, line: 1, kind: "syntax" },
    ]);
  });

  test("불릿 마커는 kind:bullet (• 치환), 번호 마커는 숨기지 않음", () => {
    assert.deepEqual(ranges("- x").hides, [{ from: 0, to: 1, line: 1, kind: "bullet" }]);
    assert.deepEqual(ranges("1. x").hides, []);
  });

  test("링크는 []() 마커와 URL 을 숨김 후보로 (텍스트만 남김)", () => {
    const hides = ranges("[t](http://x)").hides;
    // LinkMark [ ] ( ) + URL — 모두 syntax, 1번 줄.
    assert.ok(hides.every((h) => h.kind === "syntax" && h.line === 1));
    assert.ok(hides.length >= 4);
    // 링크 텍스트 "t"(offset 1) 는 숨김 대상이 아니어야 한다.
    assert.ok(!hides.some((h) => h.from <= 1 && h.to > 1 && h.from !== 0));
  });
});

describe("makeStringDoc", () => {
  test("lineAt 은 줄 경계를 정확히 매핑", () => {
    const doc = makeStringDoc("ab\ncd\n");
    assert.deepEqual(doc.lineAt(0), { number: 1, from: 0, to: 2 });
    assert.deepEqual(doc.lineAt(3), { number: 2, from: 3, to: 5 });
    assert.equal(doc.slice(3, 5), "cd");
  });
});
