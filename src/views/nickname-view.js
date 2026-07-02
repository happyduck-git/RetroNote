// 방별 닉네임 입력 화면. 로비에서 방 입장 직전(첫 입장 시) 이 화면이 끼어든다.
// params.code 가 필요하다 — 없으면 로비로 돌려보낸다.
// 저장 후 해당 방으로 이동.
import { el, onEnter } from "../core/dom.js";
import { playKey } from "../platform/sound.js";
import { getNickname, getRoomNickname, setRoomNickname } from "../chat/session.js";

export const nicknameView = {
  mount(screenEl, params, ctx) {
    const code = params?.code;
    if (!code) {
      ctx.navigate("lobby");
      return;
    }

    // prefill 우선순위: 이 방의 기존 닉네임 → (없으면) 글로벌 힌트 → ""
    const prefill = getRoomNickname(code) || getNickname() || "";

    const label = el("div", { class: "form-label", text: `NICKNAME FOR ${code}` });
    const input = el("input", {
      class: "field",
      type: "text",
      maxlength: "16",
      placeholder: "nickname",
      spellcheck: "false",
      autocomplete: "off",
      value: prefill,
      dataset: { noDrag: "" },
    });
    const okBtn = el("button", { class: "btn form-btn", text: "[ ENTER ]" });
    const err = el("div", { class: "form-error" });

    function submit() {
      const v = input.value.trim();
      if (!v) {
        err.textContent = "nickname required";
        input.focus();
        return;
      }
      setRoomNickname(code, v);
      ctx.navigate("room", { code });
    }

    okBtn.addEventListener("click", submit);
    // 레트로 일관성: 닉네임 입력도 글자마다 키사운드.
    input.addEventListener("keydown", () => playKey());
    onEnter(input, submit);

    screenEl.append(el("div", { class: "form" }, [label, input, okBtn, err]));
    setTimeout(() => {
      input.focus();
      input.select();
    }, 0);
  },
};
