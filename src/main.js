// 부트스트랩: 플랫폼 모듈 초기화 + 뷰 라우터 시작.
import { createRouter } from "./core/router.js";
import { initWindowControls } from "./platform/window-controls.js";
import { initSound } from "./platform/sound.js";
import { noteView } from "./views/note-view.js";

window.addEventListener("DOMContentLoaded", () => {
  const container = document.getElementById("computer-wrap");
  initWindowControls(container);
  initSound();

  const screen = document.getElementById("screen");
  const router = createRouter(screen);
  router.register("note", noteView);

  // M1 단계: 채팅 도입 전이므로 기존과 동일하게 노트 화면으로 바로 진입.
  router.navigate("note");
});
