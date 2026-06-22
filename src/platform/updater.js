// 앱 시작 시 자동 업데이트 확인. tauri-plugin-updater(전역 window.__TAURI__.updater)로
// GitHub Releases 의 latest.json 을 폴링해 새 버전이 있으면 레트로 다이얼로그로 안내한다.
// 동의 시 다운로드·설치 후 process.relaunch() 로 재시작.
//
// 이 앱은 번들러가 없어 @tauri-apps/* 를 import 하지 않고 전역을 쓴다(notes-fs.js 등과 동일).
// withGlobalTauri:true + Rust 측 플러그인 등록으로 window.__TAURI__.updater / .process 가 주입된다.
// Tauri 가 아닌 환경(브라우저 단독 실행 등)에서는 전역이 없으므로 조용히 no-op.
import { confirmDialog, alertDialog, progressDialog } from "../core/confirm.js";

// 다이얼로그는 라우터가 비우는 #screen 이 아니라 그 바깥(#computer-wrap)에 올려
// 초기 라우팅(navigate 의 replaceChildren)에도 지워지지 않게 한다.
function dialogHost() {
  return document.getElementById("computer-wrap") || undefined;
}

// 릴리스 노트(update.body)를 다이얼로그용 텍스트로 정리. 내용이 없으면 undefined
// (그러면 노트 박스 없이 버전만 표시). 모달이 스크롤되지만 과도하게 길면 안전하게 자른다.
const NOTES_MAX = 1200;
export function releaseNotes(update) {
  const body = (update?.body || "").trim();
  if (!body) return undefined;
  return body.length > NOTES_MAX ? `${body.slice(0, NOTES_MAX)}\n…` : body;
}

// 협력자(전역 Tauri API·다이얼로그)를 주입받는 팩토리 — 테스트는 fake 를 넣는다.
// 실제 wiring 은 아래 기본 export(checkForUpdate)가 한다(session.js 의 make* 패턴과 동일).
//   getUpdater() : window.__TAURI__.updater 네임스페이스(없으면 undefined)
//   relaunch()   : 설치 후 재시작(plugin-process). 미주입 환경에선 조용한 no-op.
//   confirm/alert: core/confirm.js 의 다이얼로그(레트로 모달).
//   progress()   : 진행 표시 모달. { set, close } 핸들을 돌려준다.
//   host()       : 다이얼로그를 붙일 DOM 노드.
export function makeCheckForUpdate({ getUpdater, relaunch, confirm, alert, progress, host }) {
  // 앱 시작 시 1회 호출(best-effort). check 단계 실패(네트워크/엔드포인트 404 등)는 조용히 넘어간다 —
  // 사용자가 업데이트를 명시적으로 수락한 뒤의 다운로드/설치 실패만 가볍게 알린다.
  return async function checkForUpdate() {
    const updater = getUpdater();
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

    // 2) 사용자 동의. 릴리스 노트(update.body)가 있으면 변경 내용을 함께 보여준다.
    const notes = releaseNotes(update);
    const ok = await confirm(
      `NEW VERSION ${update.version} AVAILABLE.\nUPDATE NOW?`,
      { okLabel: "UPDATE", cancelLabel: "LATER", host: host(), details: notes },
    );
    if (!ok) return;

    // 3) 다운로드·설치. 진행 상황을 모달로 보여준다(버튼 없음 — 중간 취소 방지).
    //    이 단계의 실패만 "업데이트 실패"로 알린다.
    const prog = progress("DOWNLOADING…", { host: host() });
    let total = 0; // 전체 바이트(서버가 알려주면)
    let received = 0; // 받은 바이트 누적
    try {
      await update.downloadAndInstall((e) => {
        switch (e?.event) {
          case "Started":
            total = e.data?.contentLength ?? 0;
            received = 0;
            // 총 크기를 알 때만 퍼센트로 시작(모르면 아래 Progress 에서 MB 표시).
            prog.set(total > 0 ? "DOWNLOADING… 0%" : "DOWNLOADING…");
            break;
          case "Progress":
            received += e.data?.chunkLength ?? 0;
            // 총 크기를 모르면(서버 미제공) 퍼센트 대신 받은 용량(MB)을 보여준다.
            prog.set(
              total > 0
                ? `DOWNLOADING… ${Math.floor((received / total) * 100)}%`
                : `DOWNLOADING… ${(received / 1048576).toFixed(1)} MB`,
            );
            break;
          case "Finished":
            prog.set("INSTALLING…");
            break;
        }
      });
    } catch (e) {
      prog.close();
      console.error("update install failed:", e);
      try {
        await alert("UPDATE FAILED. PLEASE TRY AGAIN LATER.", { host: host() });
      } catch {
        // 다이얼로그조차 못 띄우는 환경 — 무시.
      }
      return;
    }

    // 4) 재시작. 설치는 이미 끝났으므로 여기서의 실패는 "실패"가 아니다 —
    //    수동 재시작을 안내한다. (Windows 는 인스톨러가 프로세스를 종료해 이 줄에
    //    도달하지 못할 수도 있는데, 그 경우엔 모달이 남은 채 프로세스가 끝나도 정상이다.)
    prog.set("RESTARTING…");
    try {
      await relaunch();
      // 성공 시 곧 프로세스가 재시작되므로 모달은 그대로 둔다.
    } catch (e) {
      prog.close();
      console.error("relaunch after update failed:", e);
      try {
        await alert("UPDATE INSTALLED. PLEASE RESTART THE APP.", { host: host() });
      } catch {
        // 다이얼로그조차 못 띄우는 환경 — 무시.
      }
    }
  };
}

// 기본 wiring: 실제 전역/다이얼로그를 연결. main.js 가 부팅 시 이걸 호출한다.
// relaunch 는 옵셔널 체이닝이라 process 플러그인 미주입 시 throw 없이 no-op.
export const checkForUpdate = makeCheckForUpdate({
  getUpdater: () => window.__TAURI__?.updater,
  relaunch: () => window.__TAURI__?.process?.relaunch?.(),
  confirm: confirmDialog,
  alert: alertDialog,
  progress: progressDialog,
  host: dialogHost,
});
