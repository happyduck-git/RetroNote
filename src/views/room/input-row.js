// 입력행: 이모지 버튼 + 첨부([+]) 버튼 + 메시지 input + 전송 버튼. 초기 상태는 비활성(연결 후 활성).
import { el } from "../../core/dom.js";

// 입력행: 이모지 버튼 + 첨부([+]) 버튼 + 메시지 input + 전송 버튼. 초기 상태는 비활성(연결 후 활성).
// [img]·[gif] 를 한 줄에 늘어놓는 대신 [+] 하나로 일원화 — 클릭 시 작은 메뉴([img]/[gif])를 띄운다.
// showGif=false(Giphy 키 미설정)면 GIF 가 없어 메뉴가 무의미하므로 [+] 대신 [img] 로 두고 곧장 파일 선택을 연다.
// fileInput 은 hidden 으로 행에 포함 — DOM tree 가 깨끗하고 별도 컨테이너 없이 트리거.
export function buildInputRow({ showGif }) {
  const emojiBtn = el("button", {
    class: "btn room-emoji-btn",
    text: "[^_^]",
    title: "Insert emoji",
    type: "button",
  });
  const mediaBtn = el("button", {
    class: "btn room-media-btn",
    text: showGif ? "[+]" : "[img]",
    title: showGif ? "Attach image or GIF" : "Attach image",
    type: "button",
    disabled: true,
  });
  const fileInput = el("input", {
    type: "file",
    accept: "image/png,image/jpeg,image/gif,image/webp",
    class: "room-file-input",
    hidden: true,
  });
  const input = el("input", {
    class: "field room-input",
    type: "text",
    maxlength: "500",
    placeholder: "message…",
    spellcheck: "false",
    autocomplete: "off",
    dataset: { noDrag: "" },
  });
  const sendBtn = el("button", { class: "btn room-send", text: "[ SEND ]", disabled: true });
  const inputRowEl = el("div", { class: "room-input-row", dataset: { noDrag: "" } }, [
    emojiBtn,
    mediaBtn,
    input,
    sendBtn,
    fileInput,
  ]);
  return { inputRowEl, emojiBtn, mediaBtn, fileInput, input, sendBtn };
}
