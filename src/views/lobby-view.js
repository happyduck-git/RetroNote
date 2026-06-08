// 로비: 방 생성(코드 발급) 또는 코드로 입장.
import { el } from "../core/dom.js";
import { generate6, isValid, normalize, CODE_LENGTH } from "../chat/room-code.js";

export const lobbyView = {
  mount(screenEl, params, ctx) {
    const createBtn = el("button", {
      class: "btn lobby-btn",
      text: "[ CREATE ROOM ]",
      onClick: () => ctx.navigate("room", { code: generate6() }),
    });
    const sep = el("div", { class: "lobby-sep", text: "— or —" });
    const input = el("input", {
      class: "field",
      type: "text",
      maxlength: String(CODE_LENGTH),
      placeholder: "CODE",
      spellcheck: "false",
      autocomplete: "off",
      dataset: { noDrag: "" },
    });
    const joinBtn = el("button", { class: "btn lobby-btn", text: "[ JOIN ]" });
    const err = el("div", { class: "form-error" });

    function join() {
      const code = normalize(input.value);
      if (!isValid(code)) {
        err.textContent = "invalid code";
        input.focus();
        return;
      }
      ctx.navigate("room", { code });
    }

    joinBtn.addEventListener("click", join);
    input.addEventListener("input", () => {
      input.value = normalize(input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        join();
      }
    });

    screenEl.append(el("div", { class: "lobby" }, [createBtn, sep, input, joinBtn, err]));
  },
};
