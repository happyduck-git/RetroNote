// 마크다운 모드 에디터: CodeMirror 6 + Obsidian식 인라인 라이브 렌더.
// 마크다운 소스가 진실이고, 커서가 없는 줄에서는 마커(#, **, -, > 등)를 숨겨 렌더된 듯 보인다.
// 별도 프리뷰 패널은 없다 — 이 인라인 렌더가 곧 프리뷰다.
import {
  EditorView,
  Decoration,
  WidgetType,
  ViewPlugin,
  keymap,
  placeholder,
  history,
  historyKeymap,
  defaultKeymap,
  syntaxTree,
  markdown,
  markdownLanguage,
  GFM,
} from "../vendor/codemirror.js";
import { el, resizeHint } from "../core/dom.js";
import { playKey } from "../platform/sound.js";
import { collectRanges } from "./md-decorations.js";

// ── 데코레이션 정의 ───────────────────────────────────────────────
const LINE_DECO = {
  h1: Decoration.line({ class: "cm-h1" }),
  h2: Decoration.line({ class: "cm-h2" }),
  h3: Decoration.line({ class: "cm-h3" }),
  h4: Decoration.line({ class: "cm-h4" }),
  h5: Decoration.line({ class: "cm-h5" }),
  h6: Decoration.line({ class: "cm-h6" }),
  quote: Decoration.line({ class: "cm-quote" }),
  ul: Decoration.line({ class: "cm-ul" }),
  ol: Decoration.line({ class: "cm-ol" }),
};

const MARK_DECO = {
  bold: Decoration.mark({ class: "cm-bold" }),
  italic: Decoration.mark({ class: "cm-italic" }),
  strike: Decoration.mark({ class: "cm-strike" }),
  code: Decoration.mark({ class: "cm-code" }),
  link: Decoration.mark({ class: "cm-link" }),
};

// 비활성 줄에서 마커를 숨기는 replace 데코.
const HIDE_DECO = Decoration.replace({});

// 글머리표(-)를 • 위젯으로 치환.
class BulletWidget extends WidgetType {
  eq() {
    return true;
  }
  toDOM() {
    return el("span", { class: "cm-bullet", text: "•" });
  }
}
const BULLET_DECO = Decoration.replace({ widget: new BulletWidget() });

// 현재 선택(들)이 걸친 모든 줄 번호 집합 = "raw(마커 노출)로 보일 줄".
function activeLines(state) {
  const set = new Set();
  for (const r of state.selection.ranges) {
    const a = state.doc.lineAt(r.from).number;
    const b = state.doc.lineAt(r.to).number;
    for (let n = a; n <= b; n++) set.add(n);
  }
  return set;
}

function buildDecorations(view) {
  const { state } = view;
  const doc = {
    slice: (a, b) => state.sliceDoc(a, b),
    lineAt: (p) => {
      const l = state.doc.lineAt(p);
      return { number: l.number, from: l.from, to: l.to };
    },
  };
  const { lines, marks, hides } = collectRanges(syntaxTree(state), doc);
  const active = activeLines(state);

  const ranges = [];
  for (const ln of lines) {
    const deco = LINE_DECO[ln.kind];
    if (deco) ranges.push(deco.range(state.doc.line(ln.line).from));
  }
  for (const m of marks) {
    const deco = MARK_DECO[m.kind];
    if (deco && m.from < m.to) ranges.push(deco.range(m.from, m.to));
  }
  for (const h of hides) {
    if (active.has(h.line)) continue; // 커서 있는 줄은 raw 유지
    if (h.from >= h.to) continue;
    ranges.push((h.kind === "bullet" ? BULLET_DECO : HIDE_DECO).range(h.from, h.to));
  }
  // 두 번째 인자 true → from/startSide 기준 자동 정렬(수동 정렬 throw 회피).
  return Decoration.set(ranges, true);
}

const livePreview = ViewPlugin.fromClass(
  class {
    constructor(view) {
      this.decorations = buildDecorations(view);
    }
    update(u) {
      // IME 한글 조합 중엔 전체 재빌드를 보류(WebView2 조합 끊김 방지).
      // 단, 데코는 ViewPlugin 소속이라 CM 이 자동 매핑하지 않으므로, 조합 중 문서 변경분만큼
      // 위치를 직접 매핑해 둔다 — 안 그러면 캐시된 절대 오프셋이 어긋나 엉뚱한 문자를 숨긴다.
      // (조합 종료 후 다음 비-조합 업데이트에서 정상 재빌드된다.)
      if (u.view.composing) {
        if (u.docChanged) this.decorations = this.decorations.map(u.changes);
        return;
      }
      if (u.docChanged || u.viewportChanged || u.selectionSet) {
        this.decorations = buildDecorations(u.view);
      }
    }
  },
  { decorations: (v) => v.decorations },
);

// ── CRT 테마 ──────────────────────────────────────────────────────
const FONT = '"VT323","Galmuri11Adj","Courier New",monospace';
const crtTheme = EditorView.theme(
  {
    "&": {
      color: "var(--crt-green)",
      backgroundColor: "transparent",
      fontFamily: FONT,
      fontSize: "calc(var(--computer-width) / 38)",
      height: "100%",
    },
    "&.cm-focused": { outline: "none" },
    // lineWrapping 이 켜져 있어 가로 스크롤은 불필요 — 세로만 스크롤, 가로는 숨김.
    ".cm-scroller": { fontFamily: FONT, lineHeight: "1.15", overflowX: "hidden", overflowY: "auto" },
    ".cm-content": {
      caretColor: "var(--crt-green)",
      padding: "0.4em 0.5em",
      textShadow: "0 0 4px rgba(0, 255, 65, 0.7)",
    },
    // CM 기본 .cm-line 은 좌우 2px 패딩이 있어 textarea(#note, 0.5em)보다 글자가 살짝 오른쪽에서
    // 시작한다 → 0 으로 맞춰 TXT/MD placeholder·텍스트 시작 위치를 일치시킨다.
    ".cm-line": { padding: "0" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--crt-green)" },
    // placeholder 가 길어 lineWrapping 으로 줄바꿈되면 빈 첫 줄 박스가 2줄 높이가 되어
    // 네이티브 캐럿이 2줄 길이로 보인다 → 한 줄로 고정(넘치면 잘림).
    ".cm-placeholder": {
      color: "var(--crt-green)",
      opacity: "0.35", // #note::placeholder 와 동일하게 통일.
      display: "inline-block",
      maxWidth: "100%",
      whiteSpace: "nowrap",
      overflow: "hidden",
      textOverflow: "ellipsis",
      verticalAlign: "top",
    },
    // 제목: 크기만 키운다(색/글로우는 상속).
    ".cm-h1": { fontSize: "2em", fontWeight: "bold" },
    ".cm-h2": { fontSize: "1.6em", fontWeight: "bold" },
    ".cm-h3": { fontSize: "1.3em", fontWeight: "bold" },
    ".cm-h4": { fontSize: "1.15em", fontWeight: "bold" },
    ".cm-h5": { fontSize: "1.05em", fontWeight: "bold" },
    ".cm-h6": { fontSize: "1em", fontWeight: "bold", opacity: "0.85" },
    ".cm-bold": { fontWeight: "bold", textShadow: "0 0 6px rgba(0, 255, 65, 0.9)" },
    ".cm-italic": { fontStyle: "italic" },
    ".cm-strike": { textDecoration: "line-through", opacity: "0.7" },
    ".cm-code": { backgroundColor: "rgba(0, 255, 65, 0.12)", padding: "0 0.15em", borderRadius: "2px" },
    ".cm-link": { textDecoration: "underline" },
    ".cm-quote": { borderLeft: "2px solid rgba(0, 255, 65, 0.5)", paddingLeft: "0.5em", opacity: "0.85" },
    ".cm-ul, .cm-ol": { paddingLeft: "1.2em" },
    ".cm-bullet": { opacity: "0.8", marginRight: "0.15em" },
  },
  { dark: true },
);

// 마크다운 에디터를 만들어 { host, view } 반환. host 는 호출자가 screen 에 append.
// host 에 data-no-drag → window-controls 의 드래그 핸들러가 에디터 클릭을 가로채지 않음.
export function createMarkdownEditor(initialContent) {
  const host = el("div", { class: "cm-host", "data-no-drag": true });
  const view = new EditorView({
    doc: initialContent,
    parent: host,
    extensions: [
      history(),
      keymap.of([...defaultKeymap, ...historyKeymap]),
      markdown({ base: markdownLanguage, extensions: [GFM], codeLanguages: [] }),
      EditorView.lineWrapping,
      crtTheme,
      livePreview,
      placeholder(resizeHint()),
      EditorView.contentAttributes.of({
        spellcheck: "false",
        autocorrect: "off",
        autocapitalize: "off",
      }),
      // 키스트로크 사운드: 모든 keydown(현 textarea 동작과 동일). return false → CM 처리 계속.
      EditorView.domEventHandlers({
        keydown() {
          playKey();
          return false;
        },
      }),
    ],
  });
  return { host, view };
}
