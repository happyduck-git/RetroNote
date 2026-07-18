// 설정 화면: 설정 항목 목록. [PET] 서브 화면 + [SOUND] 즉시 토글(뮤트 상태는 sound.js 소유).
import { el } from "../core/dom.js";
import { isMuted, toggleMute, playKey } from "../platform/sound.js";

const soundLabel = () => `[ SOUND: ${isMuted() ? "OFF" : "ON"} ]`;

export const settingsView = {
  mount(screenEl, params, ctx) {
    const title = el("div", { class: "menu-title", text: "SETTINGS" });
    const petBtn = el("button", {
      class: "btn menu-btn",
      text: "[ PET ]",
      onClick: () => ctx.navigate("pet-settings"),
    });
    const soundBtn = el("button", {
      class: "btn menu-btn",
      text: soundLabel(),
      onClick: () => {
        toggleMute();
        soundBtn.textContent = soundLabel();
        playKey(); // 켰으면 타건음이 확인음, 껐으면 playKey 의 뮤트 가드로 무음
      },
    });
    screenEl.append(el("div", { class: "menu" }, [title, petBtn, soundBtn]));
  },
};
