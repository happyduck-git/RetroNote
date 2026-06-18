// 부트스트랩: 플랫폼 모듈 초기화 + 뷰 라우터 시작.
import { loadConfig, isChatConfigured } from "./config.js";
import { createRouter } from "./core/router.js";
import { initWindowControls } from "./platform/window-controls.js";
import { initSound } from "./platform/sound.js";
import { homeView } from "./views/home-view.js";
import { noteView } from "./views/note-view.js";
import { noteListView } from "./views/note-list-view.js";
import { nicknameView } from "./views/nickname-view.js";
import { lobbyView } from "./views/lobby-view.js";
import { roomView } from "./views/room-view.js";
import { loginView } from "./views/login-view.js";
import { resetView } from "./views/reset-view.js";
import { getSession, onAuthChange } from "./auth/auth.js";
import { clearLocalSession, getLastUid, setLastUid } from "./chat/session.js";

// 사용자 전환(A→B) 감지: 마지막으로 본 uid 와 현재 uid 가 다르면 device-local 데이터 정리.
// 처음 로그인 (last 가 null) 일 때는 정리할 게 없으므로 last 만 갱신.
// 로그아웃 (current 가 null) 일 때도 last 만 비워둔다 — 정리는 SIGNED_OUT 핸들러에서 별도 수행.
function syncSessionScope(currentUid) {
  const last = getLastUid();
  // last 가 null 이어도 currentUid 와 다르면 정리 — fix 이전부터 누수된 stale 상태가
  // 첫 부팅에서 한 번 정리되도록(이미 추적된 후엔 last === current 라 no-op).
  if (currentUid && last !== currentUid) {
    clearLocalSession();
  }
  setLastUid(currentUid);
}

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

  // 상단 [≡] 버튼은 "한 단계 위" 뷰로 이동한다. 명시되지 않은 뷰는 home 으로.
  // note(편집기)는 항상 notes(목록)에서 진입하므로 목록으로 돌아가는 게 자연스럽다.
  const PARENT_VIEW = { note: "notes" };
  let currentView = null;

  // 홈/로그인/비번재설정 화면에서는 홈 버튼 숨김(세션 없는 상태에선 home 진입 금지).
  const router = createRouter(screen, (name) => {
    currentView = name;
    if (homeBtn) homeBtn.hidden = name === "home" || name === "login" || name === "reset";
  });

  router.register("home", homeView);
  router.register("notes", noteListView);
  router.register("note", noteView);
  router.register("nickname", nicknameView);
  router.register("lobby", lobbyView);
  router.register("room", roomView);
  router.register("login", loginView);
  router.register("reset", resetView);

  if (homeBtn) homeBtn.addEventListener("click", () => router.navigate(PARENT_VIEW[currentView] || "home"));

  // Supabase 설정된 경우만 auth를 강제한다. 미설정 시 NOTE만 사용하는 기존 흐름 유지.
  if (isChatConfigured()) {
    try {
      const session = await getSession();
      // 부팅 시점에 사용자가 바뀌어 있다면(앱 종료 중 다른 계정으로 로그인 등) 정리.
      syncSessionScope(session?.user?.id || null);
      router.navigate(session ? "home" : "login");
    } catch (e) {
      console.error("session check failed:", e);
      router.navigate("login");
    }
    // 로그아웃 시: device-local 데이터 정리 후 login 화면으로 복귀.
    // 새 로그인 시: 이전 uid 와 다르면 정리 (A→B 전환 보호).
    onAuthChange((event, session) => {
      if (event === "SIGNED_OUT") {
        clearLocalSession();
        setLastUid(null);
        router.navigate("login");
      } else if (event === "SIGNED_IN") {
        syncSessionScope(session?.user?.id || null);
      }
    }).catch((e) => console.error("auth subscribe failed:", e));
  } else {
    router.navigate("home");
  }
});
