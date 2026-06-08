// 부트스트랩: 플랫폼 모듈 초기화 + 뷰 라우터 시작.
import { createRouter } from "./core/router.js";
import { initWindowControls } from "./platform/window-controls.js";
import { initSound } from "./platform/sound.js";
import { homeView } from "./views/home-view.js";
import { noteView } from "./views/note-view.js";
import { nicknameView } from "./views/nickname-view.js";
import { lobbyView } from "./views/lobby-view.js";
import { roomView } from "./views/room-view.js";

window.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("computer-wrap");
  initWindowControls(container);
  initSound();

  const screen = document.getElementById("screen");
  const homeBtn = document.getElementById("home-btn");

  // 홈이 아닌 화면에서만 홈 버튼 노출.
  const router = createRouter(screen, (name) => {
    if (homeBtn) homeBtn.hidden = name === "home";
  });

  router.register("home", homeView);
  router.register("note", noteView);
  router.register("nickname", nicknameView);
  router.register("lobby", lobbyView);
  router.register("room", roomView);

  if (homeBtn) homeBtn.addEventListener("click", () => router.navigate("home"));

  router.navigate("home");
});
