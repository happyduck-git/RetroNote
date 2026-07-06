// 노트 뷰: 마크다운 에디터(인라인 라이브 렌더) + 저장 버튼 + 저장 토스트.
// params.filename 이 있으면 그 노트를 불러와 편집(같은 파일 덮어쓰기), 없으면 새 노트(첫 저장 시 파일 발급).
// 모든 새 노트는 .md 로 저장한다 — 마크다운은 평문의 상위집합이라 평문만 써도 유효한 .md 다(형식 선택 불필요).
// 기존 .txt 노트도 그대로 열어 편집하며, 편집 저장 시 원래 파일명(확장자)을 보존한다.
// 새 노트의 미저장 초안은 메모리에 보존되어 화면 재진입 시 복원된다(첫 저장 전까지만 — 실수로 이탈해도 작성 내용 보호).
// 로그아웃(SIGNED_OUT) 시 초안을 비워, 같은 세션에서 다른 사용자가 로그인해도 이전 초안이 노출되지 않게 한다.
import { el } from "../core/dom.js";
import { saveNote, writeNote, readNote } from "../platform/notes-fs.js";
import { alertDialog } from "../core/confirm.js";
import { createMarkdownEditor } from "./note-editor.js";
import { createDraftStore } from "./note-draft.js";

// CSS .shake 애니메이션 duration과 일치해야 한다 (style.css 참조).
const SHAKE_DURATION_MS = 450;
const TOAST_DURATION_MS = 1500;

let cmView = null; // 마크다운 EditorView | null
const draftStore = createDraftStore(); // 새 노트 미저장 초안 저장소(메모리 전용) — 화면 재진입 시 복원.

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

// 불러오기 동안 입력 차단(완료 후 해제). 로드가 늦을 때 사용자가 친 글자가 덮어써지는 것을 막는다.
// contentDOM 의 contenteditable 토글로 충분 — 동기적 로컬 로드 구간에는 재렌더가 끼지 않는다.
function setReadOnly(ro) {
  if (cmView) cmView.contentDOM.contentEditable = ro ? "false" : "true";
}

// 에디터 문서 전체를 교체(불러오기).
function setContent(content) {
  if (!cmView) return;
  cmView.dispatch({ changes: { from: 0, to: cmView.state.doc.length, insert: content } });
}

export const noteView = {
  async mount(screenEl, params) {
    // filename 이 있으면 그 파일을 편집. 새 노트의 첫 저장 후엔 발급된 파일명을 여기에 담아 같은 파일로 덮어쓴다.
    let currentFilename = params?.filename || null;
    const startedNew = !currentFilename; // 이 마운트가 '새 노트'로 시작했는지(로드 실패로 null 된 기존 노트와 구분).
    // 의도적 위반: shake 애니메이션은 외부 chrome(.screen-wrap=#computer-wrap)에 정의됨 — screenEl 만 흔들면 시각 효과가 깨진다.
    const container = document.getElementById("computer-wrap");

    const toast = el("div", { id: "saved-toast", class: "saved-toast", text: "[ SAVED ]" });
    const saveBtn = el("button", { class: "btn save-btn", id: "save-btn", title: "Save", text: "[ SAVE ]" });

    const { host, view } = createMarkdownEditor(currentFilename ? "" : draftStore.seed());
    cmView = view;
    // 초안 보존 대상 = "새 노트로 시작 && 아직 첫 저장 전". 로드 실패로 currentFilename 이 null 된
    // 기존 노트는 startedNew=false 라 여기서 제외된다(디스크 저장본이 있으므로 초안 미보존).
    const isUnsavedNewNote = () => startedNew && !currentFilename;
    draftStore.arm(() => view.state.doc.toString(), isUnsavedNewNote);

    saveBtn.addEventListener("click", async () => {
      const content = cmView ? cmView.state.doc.toString() : "";
      if (content.length === 0) {
        shake(container);
        return;
      }
      try {
        // 불러온(또는 이미 한 번 저장된) 노트는 같은 파일에 덮어쓰고(확장자 보존),
        // 새 노트는 .md 로 파일명을 발급받아 캡처한다.
        if (currentFilename) await writeNote(currentFilename, content);
        else {
          currentFilename = await saveNote(content, { markdown: true });
          draftStore.clearOnSave(); // 저장 완료 → 초안이 다음 새 노트에 재등장하지 않도록.
        }
        showSavedToast(toast);
      } catch (err) {
        console.error("save failed:", err);
        shake(container);
      }
    });

    screenEl.append(host, toast, saveBtn);

    if (currentFilename) {
      // 불러오기: 로드가 늦게 끝나는 사이 사용자가 친 글자를 덮어쓰지 않도록 로드 중 입력 차단 후 완료 시 포커스.
      setReadOnly(true);
      try {
        const content = await readNote(currentFilename);
        if (!host.isConnected) return; // 로드 중 다른 화면으로 이동(router 가 replaceChildren)
        setContent(content);
      } catch (err) {
        console.error("load failed:", err);
        if (host.isConnected) setContent("");
        alertDialog("Failed to load note.");
        currentFilename = null; // 알 수 없는 경로를 덮어쓰지 않도록 새 파일로 저장되게 함
      } finally {
        if (host.isConnected) setReadOnly(false);
      }
    }

    // 마운트/레이아웃 레이스 회피 — 포커스는 다음 틱으로 미룬다(기존 textarea 패턴과 동일).
    setTimeout(() => cmView?.focus(), 0);
  },

  // 라우터가 navigate 시 호출 → CM 정리(메모리 누수 방지). DOM 제거는 라우터가 한다.
  unmount() {
    if (cmView) {
      draftStore.captureAndDisarm(); // destroy 전에 doc 을 읽어 초안 보존 + 캡처 해제.
      cmView.destroy();
      cmView = null;
    }
  },
};

// 로그아웃(SIGNED_OUT) 시 main.js 가 호출 — 세션 내 사용자 전환 시 이전 초안 노출 방지.
// clear() 가 진행 중 캡처도 해제하므로 navigate 와의 호출 순서와 무관하게 초안이 노출되지 않는다.
export function clearDraft() {
  draftStore.clear();
}
