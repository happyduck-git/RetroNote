// 외부 URL을 사용자 OS의 기본 브라우저로 연다 (Tauri opener 플러그인).
// Tauri 외 환경(브라우저에서 채팅만 테스트할 때 등)에서는 window.open 으로 폴백한다.
const opener = window.__TAURI__?.opener;

export function openExternal(url) {
  if (opener?.openUrl) {
    // fire-and-forget. 권한/스킴 문제로 실패해도 앱 흐름은 막지 않는다.
    opener.openUrl(url).catch((e) => console.error("openUrl failed:", e));
  } else {
    window.open(url, "_blank", "noopener");
  }
}
