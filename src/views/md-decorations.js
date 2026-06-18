// 마크다운 인라인 렌더용 "순수" 데코레이션 계산기.
// CodeMirror 뷰/DOM 에 의존하지 않는다 — Lezer 구문 트리 + doc 어댑터만 받아
// {lines, marks, hides} 범위 목록을 돌려준다. 이렇게 분리해야 node --test 로 헤드리스 검증이 된다.
// 어느 줄을 raw(마커 노출)로 둘지는 "커서 위치"를 아는 뷰가 결정한다 — 여기선 모른다.
//
// doc 어댑터: { slice(from,to)->string, lineAt(pos)->{ number, from, to } }
//   - 뷰: view.state.doc (Text) 를 감싼 어댑터
//   - 테스트: 평문 문자열을 감싼 어댑터

// 줄 단위 서식(line decoration): 해당 줄 전체에 클래스.
//   kind: "h1".."h6" | "quote" | "ul" | "ol"
// 인라인 서식(mark decoration): 문자 범위에 클래스(마커 포함 전체 노드).
//   kind: "bold" | "italic" | "strike" | "code" | "link"
// 숨김 토큰(replace decoration 후보): 마커/URL. 뷰가 "비활성 줄"일 때만 실제로 숨긴다.
//   kind: "bullet"(• 로 치환) | "syntax"(빈 치환)

const HEADING = {
  ATXHeading1: "h1",
  ATXHeading2: "h2",
  ATXHeading3: "h3",
  ATXHeading4: "h4",
  ATXHeading5: "h5",
  ATXHeading6: "h6",
};

const INLINE = {
  StrongEmphasis: "bold",
  Emphasis: "italic",
  Strikethrough: "strike",
  InlineCode: "code",
  Link: "link",
};

// 숨김 대상 마커 노드. ListMark 는 글머리(•)와 번호(1.)를 구분해야 하므로 별도 처리.
const HIDE_MARK = new Set([
  "HeaderMark",
  "EmphasisMark",
  "StrikethroughMark",
  "CodeMark",
  "QuoteMark",
  "LinkMark",
  "URL",
]);

export function collectRanges(tree, doc) {
  const lines = []; // { line, kind }
  const marks = []; // { from, to, kind }
  const hides = []; // { from, to, line, kind }

  tree.iterate({
    enter(node) {
      const name = node.name;

      if (HEADING[name]) {
        lines.push({ line: doc.lineAt(node.from).number, kind: HEADING[name] });
        return;
      }
      if (name === "Blockquote") {
        // 인용은 여러 줄에 걸칠 수 있으므로 걸친 모든 줄에 클래스.
        const first = doc.lineAt(node.from).number;
        const last = doc.lineAt(Math.max(node.from, node.to - 1)).number;
        for (let n = first; n <= last; n++) lines.push({ line: n, kind: "quote" });
        return;
      }
      if (name === "ListItem") {
        // 부모 리스트 종류는 ListMark 텍스트로 판별(- * + → ul, 그 외 → ol).
        return;
      }
      if (INLINE[name]) {
        marks.push({ from: node.from, to: node.to, kind: INLINE[name] });
        return;
      }
      if (name === "ListMark") {
        const text = doc.slice(node.from, node.to);
        const bullet = /^[-*+]$/.test(text);
        const lineNo = doc.lineAt(node.from).number;
        lines.push({ line: lineNo, kind: bullet ? "ul" : "ol" });
        // 글머리표(-)만 숨겨 • 로 치환. 번호(1.)는 의미가 있어 유지.
        if (bullet) hides.push({ from: node.from, to: node.to, line: lineNo, kind: "bullet" });
        return;
      }
      if (HIDE_MARK.has(name)) {
        let from = node.from;
        let to = node.to;
        // 제목(#)·인용(>) 마커는 인접 공백까지 흡수해야 잔여 공백이 안 남는다:
        //   여는 "# " → 뒤 공백,  닫는 " ##"(ATX closing) → 앞 공백.
        // (글머리 -·인라인 마커 등은 공백을 동반하지 않거나 공백이 자연스러우므로 제외.)
        if (name === "HeaderMark" || name === "QuoteMark") {
          const line = doc.lineAt(node.from);
          const isSpace = (i) => {
            const ch = doc.slice(i, i + 1);
            return ch === " " || ch === "\t";
          };
          while (to < line.to && isSpace(to)) to++;
          while (from > line.from && isSpace(from - 1)) from--;
        }
        hides.push({ from, to, line: doc.lineAt(node.from).number, kind: "syntax" });
        return;
      }
    },
  });

  return { lines, marks, hides };
}

// 평문 문자열용 doc 어댑터(테스트/비-CM 환경에서 사용). 1-based line number.
export function makeStringDoc(text) {
  // 줄 시작 오프셋 인덱스.
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return {
    slice: (from, to) => text.slice(from, to),
    lineAt(pos) {
      // pos 가 속한 줄을 이진 탐색 없이 선형으로(노트는 작다).
      let n = 1;
      for (let i = 0; i < starts.length; i++) {
        if (starts[i] <= pos) n = i + 1;
        else break;
      }
      const from = starts[n - 1];
      const to = n < starts.length ? starts[n] - 1 : text.length;
      return { number: n, from, to };
    },
  };
}
