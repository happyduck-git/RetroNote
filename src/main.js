// 부트스트랩: 플랫폼 모듈 초기화 + 뷰 라우터 시작.
import { loadConfig, isChatConfigured } from "./config.js";
import { createRouter } from "./core/router.js";
import { initWindowControls } from "./platform/window-controls.js";
import { initSound } from "./platform/sound.js";
import { homeView } from "./views/home-view.js";
import { noteView } from "./views/note-view.js";
import { nicknameView } from "./views/nickname-view.js";
import { lobbyView } from "./views/lobby-view.js";
import { roomView } from "./views/room-view.js";
import { loginView } from "./views/login-view.js";
import { resetView } from "./views/reset-view.js";
import { getSession, onAuthChange } from "./auth/auth.js";

// 구버전(로컬 영속화) 잔여 메시지 키 정리. 메시지는 Postgres가 source of truth.
function purgeLegacyMessageKeys() {
  try {
    const toDelete = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("retro-chat.msgs:")) toDelete.push(k);
    }
    for (const k of toDelete) localStorage.removeItem(k);
  } catch {
    // localStorage 접근 불가 환경 — 무시
  }
}

window.addEventListener("DOMContentLoaded", async () => {
  const container = document.getElementById("computer-wrap");
  initWindowControls(container);
  initSound();
  purgeLegacyMessageKeys();

  // 로컬 키(config.local.js)를 먼저 불러온 뒤 홈을 그린다(없으면 채팅만 비활성).
  await loadConfig();

  const screen = document.getElementById("screen");
  const homeBtn = document.getElementById("home-btn");

  // 홈/로그인/비번재설정 화면에서는 홈 버튼 숨김(세션 없는 상태에선 home 진입 금지).
  const router = createRouter(screen, (name) => {
    if (homeBtn) homeBtn.hidden = name === "home" || name === "login" || name === "reset";
  });

  router.register("home", homeView);
  router.register("note", noteView);
  router.register("nickname", nicknameView);
  router.register("lobby", lobbyView);
  router.register("room", roomView);
  router.register("login", loginView);
  router.register("reset", resetView);

  if (homeBtn) homeBtn.addEventListener("click", () => router.navigate("home"));

  // Supabase 설정된 경우만 auth를 강제한다. 미설정 시 NOTE만 사용하는 기존 흐름 유지.
  if (isChatConfigured()) {
    try {
      const session = await getSession();
      router.navigate(session ? "home" : "login");
    } catch (e) {
      console.error("session check failed:", e);
      router.navigate("login");
    }
    // 로그아웃 이벤트 시 강제로 login 화면으로 복귀.
    onAuthChange((event) => {
      if (event === "SIGNED_OUT") router.navigate("login");
    }).catch((e) => console.error("auth subscribe failed:", e));
  } else {
    router.navigate("home");
  }
});
