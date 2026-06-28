// 앱 아이콘 배지(issue #52). 새 메시지가 오면 Dock/작업표시줄 아이콘에 안 읽은 수를 표시한다.
// 배너 알림 대신 배지만 쓴다(사용자 선택).
//
// 플랫폼 차이:
//   - macOS/Linux: setBadgeCount(n) → Dock/런처 아이콘에 숫자.
//   - Windows: 작업표시줄은 숫자 배지를 기본 지원하지 않음 → setOverlayIcon 으로 작은 점(안 읽음 있음)만
//     얹는다. 숫자는 못 보여 주고 "있다/없다"만 표시한다.
//
// 이 앱은 번들러가 없어 @tauri-apps/* 를 import 하지 않고 전역(window.__TAURI__)을 쓴다.
// Tauri 가 아닌 환경(브라우저 단독·단위 테스트)에서는 전역이 없으므로 조용히 no-op.

function getWin() {
  return typeof window !== "undefined" ? window.__TAURI__?.window?.getCurrentWindow?.() : undefined;
}

function isWindows() {
  return typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent || "");
}

// 앱 창이 포커스 상태인지(게이팅용). 한 군데로 모아 나중에 교체하기 쉽게 한다.
export function isAppFocused() {
  return typeof document !== "undefined" ? document.hasFocus() : false;
}

// Windows 오버레이용 작은 점 아이콘을 canvas 로 만들어 Tauri Image 로 변환(파일 번들 불필요).
// Image API 미주입이면 null → 호출 측에서 no-op.
async function dotImage() {
  try {
    const canvas = document.createElement("canvas");
    canvas.width = 32;
    canvas.height = 32;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#e23b3b";
    ctx.beginPath();
    ctx.arc(16, 16, 15, 0, Math.PI * 2);
    ctx.fill();
    const blob = await new Promise((res) => canvas.toBlob(res, "image/png"));
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const ImageCls = window.__TAURI__?.image?.Image;
    return ImageCls ? await ImageCls.fromBytes(bytes) : null;
  } catch (e) {
    console.error("dotImage failed:", e);
    return null;
  }
}

let overlayShown = false;

// 안 읽은 수를 배지에 반영. count<=0 이면 지운다. 미주입/실패는 조용히 흡수.
export async function setUnread(count) {
  const win = getWin();
  if (!win) return;
  try {
    if (isWindows()) {
      // 숫자 대신 점 오버레이. 이미 떠 있으면 다시 그리지 않는다(불필요한 깜빡임 방지).
      if (count > 0) {
        if (!overlayShown) {
          const img = await dotImage();
          if (img) {
            await win.setOverlayIcon?.(img);
            overlayShown = true;
          }
        }
      } else if (overlayShown) {
        await win.setOverlayIcon?.(null);
        overlayShown = false;
      }
    } else {
      // macOS/Linux: 숫자(0/undefined 면 배지 제거).
      await win.setBadgeCount?.(count > 0 ? count : undefined);
    }
  } catch (e) {
    console.error("setUnread failed:", e);
  }
}
