// 첨부 UI: 미리보기 칩(buildAttachPreview) + [+] 메뉴(buildAttachMenu).
import { el } from "../../core/dom.js";

function fmtBytes(n) {
  if (n == null) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}kb`;
  return `${(n / 1024 / 1024).toFixed(1)}mb`;
}

// 첨부 미리보기 칩. 입력 행 위에 한 줄로 떠 있다가 첨부 해제 시 자동 숨김.
// 상태:
//   - uploading : 파일명 + "uploading…"     (X 비활성)
//   - ready     : 파일명 + 크기 + [×]       (X 클릭 시 onRemove)
//   - error     : 파일명 + 에러 메시지      (X 로 닫기)
export function buildAttachPreview({ onRemove }) {
  const labelEl = el("span", { class: "room-attach-label", text: "" });
  const removeBtn = el("button", {
    class: "btn room-attach-remove",
    text: "[×]",
    title: "Remove",
    type: "button",
  });
  removeBtn.addEventListener("click", () => onRemove());
  const rootEl = el("div", { class: "room-attach-preview", hidden: true, dataset: { noDrag: "" } }, [
    removeBtn,
    labelEl,
  ]);

  function show({ filename, status, bytes, message }) {
    let text = filename || "attachment";
    if (status === "uploading") text += "  uploading…";
    else if (status === "ready" && bytes != null) text += `  ${fmtBytes(bytes)}`;
    else if (status === "error") text += `  ${message || "upload failed"}`;
    labelEl.textContent = text;
    rootEl.hidden = false;
    rootEl.classList.toggle("room-attach-preview--error", status === "error");
    removeBtn.disabled = status === "uploading";
  }

  function hide() {
    rootEl.hidden = true;
    labelEl.textContent = "";
    rootEl.classList.remove("room-attach-preview--error");
    removeBtn.disabled = false;
  }

  return { el: rootEl, show, hide };
}

// 첨부 메뉴 팝업. [+] 버튼 클릭 시 input row 위쪽에 작게 떠서 [img]/[gif] 두 항목을 보여 준다.
// 이모지/GIF picker 와 동일한 popup 패턴(absolute, 바깥 클릭·ESC 로 닫힘). 항목 클릭 → 메뉴 닫고 콜백.
export function buildAttachMenu({ onPickImage, onPickGif }) {
  let visible = false;

  const imgItem = el("button", {
    class: "btn room-attach-menu-item",
    text: "[img]",
    title: "Attach image",
    type: "button",
  });
  const gifItem = el("button", {
    class: "btn room-attach-menu-item",
    text: "[gif]",
    title: "Find a GIF",
    type: "button",
  });
  imgItem.addEventListener("click", () => {
    hide();
    onPickImage();
  });
  gifItem.addEventListener("click", () => {
    hide();
    onPickGif();
  });

  const popupEl = el("div", { class: "room-attach-menu", hidden: true }, [imgItem, gifItem]);

  function show() {
    if (visible) return;
    visible = true;
    popupEl.hidden = false;
    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onDocKeyDown, true);
  }

  function hide() {
    if (!visible) return;
    visible = false;
    popupEl.hidden = true;
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onDocKeyDown, true);
  }

  function toggle() {
    if (visible) hide();
    else show();
  }

  function onDocMouseDown(e) {
    if (popupEl.contains(e.target)) return;
    if (e.target.closest?.(".room-media-btn")) return; // 트리거 버튼은 자체 토글에 맡긴다
    hide();
  }

  function onDocKeyDown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      hide();
    }
  }

  function cleanup() {
    if (visible) hide();
  }

  return { popupEl, toggle, hide, cleanup };
}
