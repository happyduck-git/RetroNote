// 첨부 URL 호스트 allowlist(M3-A). 악의적 멤버가 임의 호스트를 가리키는 attachment_url 을 넣어
// 수신자 클라이언트가 그 호스트로 요청하게 만드는 것(추적 비콘·IP/온라인 여부 유출)을 렌더 단계에서 차단한다.
// 허용: 우리 Supabase Storage 호스트(config.SUPABASE.url) + Giphy(*.giphy.com).
import { SUPABASE } from "../config.js";

export function isAllowedAttachmentUrl(url, supabaseUrl = SUPABASE.url) {
  let u;
  try {
    u = new URL(url);
  } catch {
    return false; // 비 URL / 위험 스킴(javascript:, data: 등)은 여기서 걸리거나 아래 호스트 매칭에서 탈락
  }
  if (u.hostname === "giphy.com" || u.hostname.endsWith(".giphy.com")) return true;
  if (supabaseUrl) {
    try {
      if (u.host === new URL(supabaseUrl).host) return true;
    } catch {
      /* 설정된 supabaseUrl 이 비정상이면 supabase 매칭만 건너뛴다 */
    }
  }
  return false;
}
