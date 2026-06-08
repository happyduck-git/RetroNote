// 닉네임 1회 설정 화면 (채팅 첫 입장 시). 저장 후 로비로 이동.
import { el } from "../core/dom.js";
import { getNickname, setNickname } from "../chat/session.js";

export const nicknameView = {
  mount(screenEl, params, ctx) {
    const label = el("div", { class: "form-label", text: "ENTER NICKNAME" });
    const input = el("input", {
      class: "field",
      type: "text",
      maxlength: "16",
      spellcheck: "false",
      autocomplete: "off",
      value: getNickname() || "",
      dataset: { noDrag: "" },
    });
    const okBtn = el("button", { class: "btn form-btn", text: "[ OK ]" });
    const err = el("div", { class: "form-error" });

    function submit() {
      const v = input.value.trim();
      if (!v) {
        err.textContent = "nickname required";
        input.focus();
        return;
      }
      setNickname(v);
      ctx.navigate("lobby");
    }

    okBtn.addEventListener("click", submit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        submit();
      }
    });

    screenEl.append(el("div", { class: "form" }, [label, input, okBtn, err]));
    setTimeout(() => input.focus(), 0);
  },
};
