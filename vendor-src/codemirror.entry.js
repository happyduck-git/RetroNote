// esbuild 진입점 — src/vendor/codemirror.js 로 번들된다(헤더의 명령 참조).
// 손수 고른 최소 확장만 export (basicSetup 미사용: 줄번호/폴드/검색/자동완성 제외).
export { EditorView, Decoration, WidgetType, ViewPlugin, keymap, placeholder } from "@codemirror/view";
export { history, historyKeymap, defaultKeymap } from "@codemirror/commands";
export { syntaxTree } from "@codemirror/language";
export { markdown, markdownLanguage } from "@codemirror/lang-markdown";
export { GFM } from "@lezer/markdown";
