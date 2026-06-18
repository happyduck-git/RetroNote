// 노트 뷰: textarea + 저장 버튼 + 저장 토스트.
// params.filename 이 있으면 그 노트를 불러와 편집(같은 파일 덮어쓰기), 없으면 새 노트(첫 저장 시 파일 발급).
import { el } from "../core/dom.js";
import { saveNote, writeNote, readNote } from "../platform/notes-fs.js";
import { alertDialog } from "../core/confirm.js";
import { playKey } from "../platform/sound.js";

// CSS .shake 애니메이션 duration과 일치해야 한다 (style.css 참조).
const SHAKE_DURATION_MS = 450;
const TOAST_DURATION_MS = 1500;

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

export const noteView = {
  async mount(screenEl, params) {
    // filename 이 있으면 그 파일을 편집. 새 노트의 첫 저장 후엔 발급된 파일명을 여기에 담아 같은 파일로 덮어쓴다.
    let currentFilename = params?.filename || null;
    // 의도적 위반: shake 애니메이션은 외부 chrome(.screen-wrap=#computer-wrap)에 정의됨 — screenEl 만 흔들면 시각 효과가 깨진다.
    const container = document.getElementById("computer-wrap");

    const note = el("textarea", {
      id: "note",
      spellcheck: "false",
      autocomplete: "off",
      autocorrect: "off",
      autocapitalize: "off",
    });
    // 단축키 안내 문구를 OS에 맞춰 표기 (macOS: ⌘, Windows: Ctrl).
    const mod = navigator.userAgent.includes("Mac") ? "⌘" : "Ctrl";
    note.placeholder = `${mod}+= / ${mod}+- to resize · ${mod}+0 to reset`;

    const toast = el("div", { id: "saved-toast", class: "saved-toast", text: "[ SAVED ]" });
    const saveBtn = el("button", { class: "btn save-btn", id: "save-btn", title: "Save", text: "[ SAVE ]" });

    note.addEventListener("keydown", () => playKey());

    saveBtn.addEventListener("click", async () => {
      const content = note.value;
      if (content.length === 0) {
        shake(container);
        return;
      }
      try {
        // 불러온(또는 이미 한 번 저장된) 노트는 같은 파일에 덮어쓰고, 새 노트는 파일명을 발급받아 캡처.
        if (currentFilename) await writeNote(currentFilename, content);
        else currentFilename = await saveNote(content);
        showSavedToast(toast);
      } catch (err) {
        console.error("save failed:", err);
        shake(container);
      }
    });

    screenEl.append(note, toast, saveBtn);

    if (currentFilename) {
      // 불러오기: 로드가 늦게 끝나는 사이 사용자가 친 글자를 덮어쓰지 않도록 로드 중 입력 차단 후 완료 시 포커스.
      note.readOnly = true;
      try {
        const content = await readNote(currentFilename);
        if (!note.isConnected) return; // 로드 중 다른 화면으로 이동(router 가 replaceChildren)
        note.value = content;
      } catch (err) {
        console.error("load failed:", err);
        if (note.isConnected) note.value = "";
        alertDialog("Failed to load note.");
        currentFilename = null; // 알 수 없는 경로를 덮어쓰지 않도록 새 파일로 저장되게 함
      } finally {
        if (note.isConnected) {
          note.readOnly = false;
          note.focus();
        }
      }
    } else {
      // 새 노트: 기존 동작(즉시 포커스).
      setTimeout(() => note.focus(), 0);
    }
  },
};
