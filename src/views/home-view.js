// 홈 화면: [NOTE] / [CHAT] 선택. Supabase 미설정이면 CHAT은 비활성.
// Supabase 설정된 경우 하단에 [LOGOUT] 노출.
import { el } from "../core/dom.js";
import { isChatConfigured } from "../config.js";
import { signOut } from "../auth/auth.js";

export const homeView = {
  mount(screenEl, params, ctx) {
    const chatEnabled = isChatConfigured();

    const title = el("div", { class: "menu-title", text: "RETRO NOTE" });
    const noteBtn = el("button", {
      class: "btn menu-btn",
      text: "[ NOTE ]",
      onClick: () => ctx.navigate("notes"),
    });
    const chatBtn = el("button", {
      class: "btn menu-btn" + (chatEnabled ? "" : " disabled"),
      text: "[ CHAT ]",
      title: chatEnabled ? "Chat" : "Chat unavailable — Supabase not configured",
      onClick: () => {
        if (!chatEnabled) return;
        ctx.navigate("lobby"); // 닉네임은 각 방 첫 입장 시 lobby → nickname({code}) 경로로 받는다.
      },
    });

    const children = [title, noteBtn, chatBtn];

    if (chatEnabled) {
      const logoutBtn = el("button", {
        class: "btn menu-btn",
        text: "[ LOGOUT ]",
        onClick: async () => {
          try {
            await signOut();
            // main.js의 onAuthChange 핸들러가 login 화면으로 이동시킨다.
          } catch (e) {
            console.error("logout failed:", e);
          }
        },
      });
      children.push(logoutBtn);
    }

    screenEl.append(el("div", { class: "menu" }, children));
  },
};
