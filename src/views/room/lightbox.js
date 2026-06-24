// 이미지 lightbox. 채팅 영역(.room)을 가득 채우는 overlay 로 큰 이미지를 보여준다.
import { el } from "../../core/dom.js";

// 이미지 lightbox. 채팅 영역(.room)을 가득 채우는 overlay 로 큰 이미지를 보여준다.
// 닫기: ESC, 바깥(backdrop) 클릭, [X] 버튼 — 세 가지 모두 동작.
// data-kind 를 root 에 박아 CSS 가 업로드 이미지(image)에만 216색 팔레트 필터를 걸도록 한다.
export function buildLightbox() {
  let visible = false;

  const imgEl = el("img", { class: "lightbox-image", alt: "" });
  const closeBtn = el("button", {
    class: "btn lightbox-close",
    text: "[X]",
    title: "Close",
    type: "button",
  });
  const rootEl = el("div", {
    class: "lightbox",
    hidden: true,
    dataset: { noDrag: "" },
  }, [imgEl, closeBtn]);

  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      hide();
    }
  }

  function show(src, { kind } = {}) {
    if (visible) return;
    visible = true;
    imgEl.src = src;
    rootEl.dataset.kind = kind || "";
    rootEl.hidden = false;
    // capture phase 로 등록 — emoji/gif picker 의 ESC 핸들러보다 먼저 받는다.
    document.addEventListener("keydown", onKey, true);
  }

  function hide() {
    if (!visible) return;
    visible = false;
    rootEl.hidden = true;
    imgEl.removeAttribute("src");
    rootEl.dataset.kind = "";
    document.removeEventListener("keydown", onKey, true);
  }

  closeBtn.addEventListener("click", hide);
  // backdrop 클릭은 닫기, 이미지/버튼 자체 클릭은 유지.
  rootEl.addEventListener("click", (e) => {
    if (e.target === rootEl) hide();
  });

  function cleanup() {
    if (visible) hide();
  }

  return { el: rootEl, show, hide, cleanup };
}
