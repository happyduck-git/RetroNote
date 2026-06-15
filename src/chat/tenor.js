// Tenor v2 검색 API 래퍼. Facebook/Discord 가 쓰는 그 API.
// docs: developers.google.com/tenor/guidelines, tenor.com/gifapi/documentation
//
// 키는 client-side 노출이 정상 운용 — Google Cloud Console 에서 발급할 때 referer/API 제한으로
// abuse 를 차단한다. config.local.js 에 TENOR_API_KEY 가 없으면 [gif] 버튼은 비활성/숨김.
//
// media_filter 로 응답 페이로드 최소화:
//   - nanogif  : ~90px,  picker 썸네일용 (그리드)
//   - tinygif  : ~220px, 채팅에 박을 본문용 (CSS 로 더 키워 pixelated 렌더링)
// 두 사이즈 모두 dims=[w,h] 와 size 를 동봉 → layout shift 방지에 사용.
//
// 정규화 결과: { id, title, thumbUrl, thumbW, thumbH, gifUrl, gifW, gifH, gifBytes }
// onPick 핸들러는 gifUrl/gifW/gifH 만 가지고 메시지를 보낸다.

import { CHAT } from "../config.js";

const BASE = "https://tenor.googleapis.com/v2";
const CLIENT_KEY = "retro-note";
const DEFAULT_LIMIT = 24;
const MEDIA_FILTER = "nanogif,tinygif";

export function isTenorConfigured() {
  return !!CHAT.tenorApiKey;
}

function normalize(result) {
  const f = result.media_formats || {};
  const nano = f.nanogif || f.tinygif || f.gif;
  const tiny = f.tinygif || f.gif || f.nanogif;
  if (!nano || !tiny) return null;
  return {
    id: result.id,
    title: result.title || result.content_description || "",
    thumbUrl: nano.url,
    thumbW: nano.dims?.[0] || 0,
    thumbH: nano.dims?.[1] || 0,
    gifUrl: tiny.url,
    gifW: tiny.dims?.[0] || 0,
    gifH: tiny.dims?.[1] || 0,
    gifBytes: tiny.size || null,
  };
}

async function call(endpoint, params, signal) {
  if (!isTenorConfigured()) throw new Error("TENOR_NOT_CONFIGURED");
  const qs = new URLSearchParams({
    key: CHAT.tenorApiKey,
    client_key: CLIENT_KEY,
    media_filter: MEDIA_FILTER,
    ...params,
  });
  const res = await fetch(`${BASE}/${endpoint}?${qs}`, { signal });
  if (!res.ok) throw new Error(`Tenor ${endpoint} ${res.status}`);
  const data = await res.json();
  return (data.results || []).map(normalize).filter(Boolean);
}

// 검색. 빈 쿼리면 featured 와 동일 결과 — 호출 측에서 분기 부담을 줄임.
export function searchGifs(query, { limit = DEFAULT_LIMIT, signal } = {}) {
  const q = String(query || "").trim();
  if (!q) return featuredGifs({ limit, signal });
  return call("search", { q, limit: String(limit) }, signal);
}

// 인기/트렌딩 GIF. 검색창이 비어 있는 초기 상태에서 표시.
export function featuredGifs({ limit = DEFAULT_LIMIT, signal } = {}) {
  return call("featured", { limit: String(limit) }, signal);
}
