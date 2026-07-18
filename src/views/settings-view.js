// 설정 화면: 설정 항목 목록. 지금은 [PET] 하나(음소거·화면모드는 상단 크롬에 그대로 둔다).
import { el } from "../core/dom.js";

export const settingsView = {
  mount(screenEl, params, ctx) {
    const title = el("div", { class: "menu-title", text: "SETTINGS" });
    const petBtn = el("button", {
      class: "btn menu-btn",
      text: "[ PET ]",
      onClick: () => ctx.navigate("pet-settings"),
    });
    screenEl.append(el("div", { class: "menu" }, [title, petBtn]));
  },
};
