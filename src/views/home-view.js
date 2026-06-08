// 홈 화면: [NOTE] / [CHAT] 선택. Supabase 미설정이면 CHAT은 비활성.
import { el } from "../core/dom.js";
import { isChatConfigured } from "../config.js";
import { getNickname } from "../chat/session.js";

export const homeView = {
  mount(screenEl, params, ctx) {
    const chatEnabled = isChatConfigured();

    const title = el("div", { class: "menu-title", text: "RETRO NOTE" });
    const noteBtn = el("button", {
      class: "btn menu-btn",
      text: "[ NOTE ]",
      onClick: () => ctx.navigate("note"),
    });
    const chatBtn = el("button", {
      class: "btn menu-btn" + (chatEnabled ? "" : " disabled"),
      text: "[ CHAT ]",
      title: chatEnabled ? "Chat" : "Chat unavailable — Supabase not configured",
      onClick: () => {
        if (!chatEnabled) return;
        ctx.navigate(getNickname() ? "lobby" : "nickname");
      },
    });

    screenEl.append(el("div", { class: "menu" }, [title, noteBtn, chatBtn]));
  },
};
