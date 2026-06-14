// 인앱 확인 모달. Tauri(wry) webview의 macOS에서 네이티브 window.confirm()이
// 다이얼로그를 띄우지 못하고 항상 false를 반환하는 문제를 우회한다.
// Promise<boolean> 반환: OK=true, CANCEL/Esc/배경 클릭=false.
import { el } from "./dom.js";

// 단순 정보성 알림. native alert()가 Tauri macOS webview에서 비신뢰 동작이라 우회.
export function alertDialog(message, { okLabel = "OK", host } = {}) {
  return confirmDialog(message, { okLabel, cancelLabel: null, host });
}

export function confirmDialog(message, { okLabel = "OK", cancelLabel = "CANCEL", host } = {}) {
  return new Promise((resolve) => {
    // 호출 측이 host 를 명시하면 그 위에 올린다(테스트/하위 컨테이너 한정용).
    // 미지정 시 뷰와 동일하게 화면(.screen) 영역 위에 올린다. 없으면 body로 폴백.
    const hostEl = host || document.getElementById("screen") || document.body;

    let done = false;
    function close(result) {
      if (done) return;
      done = true;
      document.removeEventListener("keydown", onKey, true);
      overlay.remove();
      resolve(result);
    }

    function onKey(e) {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        close(false);
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        close(true);
      }
    }

    // 줄바꿈(\n) 보존하며 안전하게 텍스트 노드로 삽입(XSS 차단).
    const msgEl = el("div", { class: "modal-message" });
    message.split("\n").forEach((line, i) => {
      if (i > 0) msgEl.append(el("br"));
      msgEl.append(document.createTextNode(line));
    });

    const okBtn = el("button", {
      class: "btn modal-btn modal-ok",
      text: `[ ${okLabel} ]`,
      onClick: () => close(true),
    });
    const actions = el("div", { class: "modal-actions" });
    if (cancelLabel) {
      const cancelBtn = el("button", {
        class: "btn modal-btn modal-cancel",
        text: `[ ${cancelLabel} ]`,
        onClick: () => close(false),
      });
      actions.append(cancelBtn);
    }
    actions.append(okBtn);

    const box = el("div", { class: "modal-box" }, [msgEl, actions]);
    // 박스 내부 클릭이 배경(취소)으로 전파되지 않도록.
    box.addEventListener("click", (e) => e.stopPropagation());

    const overlay = el(
      "div",
      {
        class: "modal-overlay",
        dataset: { noDrag: "" },
        onClick: () => close(false), // 배경 클릭 = 취소
      },
      [box],
    );

    // 캡처 단계로 등록해 다른 뷰의 keydown 리스너(예: 로비 입력의 Enter)보다 먼저 가로챈다.
    document.addEventListener("keydown", onKey, true);
    hostEl.append(overlay);
    okBtn.focus();
  });
}
