// 노트 뷰: 기존 textarea + 저장 버튼 + 저장 토스트. 동작은 리팩터 이전과 동일.
import { el } from "../core/dom.js";
import { saveNote } from "../platform/notes-fs.js";
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
  mount(screenEl) {
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
        await saveNote(content);
        showSavedToast(toast);
      } catch (err) {
        console.error("save failed:", err);
        shake(container);
      }
    });

    screenEl.append(note, toast, saveBtn);

    // Autofocus on launch
    setTimeout(() => note.focus(), 0);
  },
};
