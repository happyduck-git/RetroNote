// 앱 시작 시 자동 업데이트 확인. tauri-plugin-updater(전역 window.__TAURI__.updater)로
// GitHub Releases 의 latest.json 을 폴링해 새 버전이 있으면 레트로 다이얼로그로 안내한다.
// 동의 시 다운로드·설치 후 process.relaunch() 로 재시작.
//
// 이 앱은 번들러가 없어 @tauri-apps/* 를 import 하지 않고 전역을 쓴다(notes-fs.js 등과 동일).
// withGlobalTauri:true + Rust 측 플러그인 등록으로 window.__TAURI__.updater / .process 가 주입된다.
// Tauri 가 아닌 환경(브라우저 단독 실행 등)에서는 전역이 없으므로 조용히 no-op.
import { confirmDialog, alertDialog } from "../core/confirm.js";

// 다이얼로그는 라우터가 비우는 #screen 이 아니라 그 바깥(#computer-wrap)에 올려
// 초기 라우팅(navigate 의 replaceChildren)에도 지워지지 않게 한다.
function dialogHost() {
  return document.getElementById("computer-wrap") || undefined;
}

// 앱 시작 시 1회 호출(best-effort). check 단계 실패(네트워크/엔드포인트 404 등)는 조용히 넘어간다 —
// 사용자가 업데이트를 명시적으로 수락한 뒤의 다운로드/설치 실패만 가볍게 알린다.
export async function checkForUpdate() {
  const updater = window.__TAURI__?.updater;
  if (!updater?.check) return; // 비-Tauri 또는 플러그인 미주입 — no-op

  // 1) 새 버전 확인 — 실패해도 조용히 종료(릴리스 발행 전 endpoint 404 등은 정상 상황).
  let update;
  try {
    update = await updater.check();
  } catch (e) {
    console.error("update check failed:", e);
    return;
  }
  if (!update) return; // 최신 버전 — 알릴 것 없음

  // 2) 사용자 동의.
  const ok = await confirmDialog(
    `NEW VERSION ${update.version} AVAILABLE.\nUPDATE NOW?`,
    { okLabel: "UPDATE", cancelLabel: "LATER", host: dialogHost() },
  );
  if (!ok) return;

  // 3) 다운로드·설치 후 재시작. 여기서부터의 실패는 사용자에게 알린다.
  try {
    // 다운로드 진행은 콘솔로만 노출(진행 UI 는 향후 보강).
    await update.downloadAndInstall((e) => {
      if (e?.event) console.log("updater:", e.event, e.data ?? "");
    });
    await window.__TAURI__?.process?.relaunch?.();
  } catch (e) {
    console.error("update install failed:", e);
    try {
      await alertDialog("UPDATE FAILED. PLEASE TRY AGAIN LATER.", { host: dialogHost() });
    } catch {
      // 다이얼로그조차 못 띄우는 환경 — 무시.
    }
  }
}
