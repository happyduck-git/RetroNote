// 본인 닉네임 라벨 + [✎] 인라인 에디터. alias 편집과 동일한 commit/cancel 패턴.
import { el } from "../../core/dom.js";
import { playKey } from "../../platform/sound.js";

const NICK_MAX = 16;

// 본인 닉네임 라벨 + [✎] 인라인 에디터. alias 편집과 동일한 commit/cancel 패턴.
// getCurrentNick: 호출 시 라이브로 현재 표시값 조회 → openRoom 양방향 sync 결과를 반영.
// onCommit(newNick): 새 값 commit 콜백 (실제 changeRoomNickname 호출자가 주입). throw 시 표시는 기존 값으로 복귀.
export function buildNickEditor(getCurrentNick, onCommit) {
  const nickLabel = el("span", { class: "room-nick", text: getCurrentNick() });
  const nickAs = el("span", { class: "room-nick-as", text: "as:" });
  const nickEditBtn = el("button", { class: "btn room-nick-edit", title: "Edit nickname", text: "[✎]" });
  const nickWrap = el("span", { class: "room-nick-wrap" }, [nickAs, nickLabel, nickEditBtn]);

  function startNickEdit() {
    if (!nickLabel.isConnected) return;
    const currentNick = getCurrentNick() || nickLabel.textContent;
    const input = el("input", {
      class: "field room-nick-input",
      type: "text",
      maxlength: String(NICK_MAX),
      value: currentNick,
      placeholder: "nickname",
      spellcheck: "false",
      autocomplete: "off",
      dataset: { noDrag: "" },
    });
    let done = false;
    const finish = (next) => {
      if (done) return;
      done = true;
      nickLabel.textContent = next;
      input.replaceWith(nickLabel);
    };
    const commit = async () => {
      const v = input.value.trim();
      const currentLive = getCurrentNick();
      if (!v) {
        input.classList.add("invalid");
        input.focus();
        input.select();
        setTimeout(() => input.classList.remove("invalid"), 400);
        return;
      }
      if (v.length > NICK_MAX) {
        input.classList.add("invalid");
        setTimeout(() => input.classList.remove("invalid"), 400);
        return;
      }
      if (v === currentLive) {
        finish(currentLive);
        return;
      }
      try {
        await onCommit(v);
        finish(v);
      } catch (e) {
        console.error("changeRoomNickname failed:", e);
        finish(currentLive || currentNick);
      }
    };
    const cancel = () => finish(getCurrentNick() || currentNick);

    input.addEventListener("keydown", (e) => {
      playKey();
      // IME composition 중 Enter 는 commit 키 → 무시. 한글/일본어/중국어 입력 시 마지막 글자 중복 방지.
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
    // blur 는 commit 으로 처리 — alias 편집과 동일 패턴. 실패하면 finish 가 기존 값 복원.
    input.addEventListener("blur", commit);

    nickLabel.replaceWith(input);
    input.focus();
    input.select();
  }

  nickEditBtn.addEventListener("click", () => {
    playKey();
    startNickEdit();
  });

  return nickWrap;
}
