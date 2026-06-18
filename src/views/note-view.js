// 노트 뷰: textarea(TXT) ↔ CodeMirror(MD) 토글 + 저장 + 토스트.
// params.filename 이 있으면 그 노트를 불러와 편집(같은 파일 덮어쓰기), 없으면 새 노트(첫 저장 시 파일 발급).
// TXT 모드는 리팩터 이전과 동일한 plain textarea. MD 모드는 인라인 라이브 렌더(note-editor.js).
// 모드는 localStorage 에 기억(기본 TXT — 기존 사용자 동작 보존).
// 내용 보존 범위: 같은 화면 안에서 모드를 토글하는 동안만 보존한다. 노트 화면을 떠나면(unmount)
// 미저장 초안은 버린다 — 기존 textarea 의 "재진입 시 빈 노트" 동작 유지 + 세션 내 사용자 전환 시 초안 노출 방지.
import { el, resizeHint } from "../core/dom.js";
import { saveNote, writeNote, readNote } from "../platform/notes-fs.js";
import { alertDialog } from "../core/confirm.js";
import { playKey } from "../platform/sound.js";
import { createMarkdownEditor } from "./note-editor.js";

// CSS .shake 애니메이션 duration과 일치해야 한다 (style.css 참조).
const SHAKE_DURATION_MS = 450;
const TOAST_DURATION_MS = 1500;
const MODE_KEY = "retro-note.mode"; // sound.js 의 mute 키와 같은 컨벤션.

let mode = localStorage.getItem(MODE_KEY) === "md" ? "md" : "txt";
let cmView = null; // MD 모드 EditorView | null
let textarea = null; // TXT 모드 textarea | null
let surfaceEl = null; // 현재 편집 표면(textarea 또는 .cm-host)
let toggleBtn = null;

function shake(container) {
  container.classList.remove("shake");
  // 연속 트리거 시 애니메이션이 재시작되도록 강제 reflow.
  void container.offsetWidth;
  container.classList.add("shake");
  setTimeout(() => container.classList.remove("shake"), SHAKE_DURATION_MS);
}

function showSavedToast(toast) {
  toast.classList.add("visible");
  setTimeout(() => toast.classList.remove("visible"), TOAST_DURATION_MS);
}

// 현재 활성 편집기에서 본문을 읽는다.
function readContent() {
  if (cmView) return cmView.state.doc.toString();
  if (textarea) return textarea.value;
  return "";
}

function makeTextarea(content) {
  const note = el("textarea", {
    id: "note",
    spellcheck: "false",
    autocomplete: "off",
    autocorrect: "off",
    autocapitalize: "off",
  });
  note.placeholder = resizeHint();
  note.value = content;
  note.addEventListener("keydown", () => playKey());
  return note;
}

// content 를 시드로 현재 mode 의 편집 표면을 만든다. 모듈 상태는 건드리지 않고 핸들만 반환 →
// 호출자가 "새 표면 생성 성공 후" 기존 표면을 교체할 수 있어, 생성 실패 시 화면이 비지 않는다.
function buildSurface(content) {
  if (mode === "md") {
    const { host, view } = createMarkdownEditor(content);
    return { surfaceEl: host, cmView: view, textarea: null };
  }
  const ta = makeTextarea(content);
  return { surfaceEl: ta, cmView: null, textarea: ta };
}

function adoptSurface(next) {
  cmView = next.cmView;
  textarea = next.textarea;
  surfaceEl = next.surfaceEl;
}

function focusSurface() {
  // 마운트/레이아웃 레이스 회피 — 기존 textarea 패턴과 동일.
  setTimeout(() => (cmView || textarea)?.focus(), 0);
}

// 불러오기 동안 입력 차단(완료 후 해제). 로드가 늦을 때 사용자가 친 글자가 덮어써지는 것을 막는다.
// CM 은 contentDOM 의 contenteditable 토글로 충분 — 동기적 로컬 로드 구간에는 재렌더가 끼지 않는다.
function setSurfaceReadOnly(ro) {
  if (textarea) textarea.readOnly = ro;
  if (cmView) cmView.contentDOM.contentEditable = ro ? "false" : "true";
}

// 현재 활성 편집기에 본문을 채운다(불러오기). CM 은 문서 전체를 교체.
function setContent(content) {
  if (cmView) {
    cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: content } });
  } else if (textarea) {
    textarea.value = content;
  }
}

function updateToggleLabel() {
  if (!toggleBtn) return;
  toggleBtn.textContent = mode === "md" ? "[ MD ]" : "[ TXT ]";
  toggleBtn.title = mode === "md" ? "Markdown — switch to plain text" : "Plain text — switch to markdown";
}

function toggleMode() {
  const content = readContent();
  const prevMode = mode;
  mode = mode === "md" ? "txt" : "md";

  let next;
  try {
    next = buildSurface(content); // 먼저 새 표면 생성(실패 가능 지점)
  } catch (e) {
    mode = prevMode; // 롤백 — 기존 표면 그대로 둔다.
    console.error("editor build failed:", e);
    return;
  }

  const oldEl = surfaceEl;
  const oldCm = cmView;
  adoptSurface(next);
  oldEl.replaceWith(surfaceEl); // 같은 위치에 교체(부모 참조 불필요)
  oldCm?.destroy();

  localStorage.setItem(MODE_KEY, mode);
  updateToggleLabel();
  focusSurface();
}

export const noteView = {
  async mount(screenEl, params) {
    // filename 이 있으면 그 파일을 편집. 새 노트의 첫 저장 후엔 발급된 파일명을 여기에 담아 같은 파일로 덮어쓴다.
    let currentFilename = params?.filename || null;
    // 의도적 위반: shake 애니메이션은 외부 chrome(.screen-wrap=#computer-wrap)에 정의됨 — screenEl 만 흔들면 시각 효과가 깨진다.
    const container = document.getElementById("computer-wrap");

    const toast = el("div", { id: "saved-toast", class: "saved-toast", text: "[ SAVED ]" });
    const saveBtn = el("button", { class: "btn save-btn", id: "save-btn", title: "Save", text: "[ SAVE ]" });
    toggleBtn = el("button", { class: "btn mode-toggle-btn", onClick: toggleMode });

    saveBtn.addEventListener("click", async () => {
      const content = readContent();
      if (content.length === 0) {
        shake(container);
        return;
      }
      try {
        // 불러온(또는 이미 한 번 저장된) 노트는 같은 파일에 덮어쓰고, 새 노트는 파일명을 발급받아 캡처.
        // 새 노트의 확장자는 현재 모드(MD→.md / TXT→.txt)로 발급한다.
        if (currentFilename) await writeNote(currentFilename, content);
        else currentFilename = await saveNote(content, { markdown: mode === "md" });
        showSavedToast(toast);
      } catch (err) {
        console.error("save failed:", err);
        shake(container);
      }
    });

    adoptSurface(buildSurface("")); // 재진입은 빈 노트(미저장 초안 비보존).
    updateToggleLabel();
    screenEl.append(surfaceEl, toast, saveBtn, toggleBtn);

    if (currentFilename) {
      // 불러오기: 로드가 늦게 끝나는 사이 사용자가 친 글자를 덮어쓰지 않도록 로드 중 입력 차단 후 완료 시 포커스.
      setSurfaceReadOnly(true);
      try {
        const content = await readNote(currentFilename);
        if (!surfaceEl.isConnected) return; // 로드 중 다른 화면으로 이동(router 가 replaceChildren)
        setContent(content);
      } catch (err) {
        console.error("load failed:", err);
        if (surfaceEl.isConnected) setContent("");
        alertDialog("Failed to load note.");
        currentFilename = null; // 알 수 없는 경로를 덮어쓰지 않도록 새 파일로 저장되게 함
      } finally {
        if (surfaceEl.isConnected) {
          setSurfaceReadOnly(false);
          focusSurface();
        }
      }
    } else {
      // 새 노트: 기존 동작(즉시 포커스).
      focusSurface();
    }
  },

  // 라우터가 navigate 시 호출 → CM 정리(메모리 누수 방지). DOM 제거는 라우터가 한다.
  unmount() {
    if (cmView) {
      cmView.destroy();
      cmView = null;
    }
    textarea = null;
    surfaceEl = null;
    toggleBtn = null;
  },
};
