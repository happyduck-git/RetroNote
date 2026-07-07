// Giphy v1 검색 API 래퍼. Tenor 가 신규 발급/운영을 종료(2026-06-30 전면 종료)해 이쪽으로 교체했다.
// docs: developers.giphy.com/docs/api  (search + trending 엔드포인트)
//
// 키 노출에 대하여: Giphy 키는 클라이언트 사용을 전제로 하며 — Tenor 와 달리 referer/도메인
// 제한 장치가 없다. 앱에 박힌 키는 누구나 읽어 쓸 수 있고, 방어는 Giphy 의 백엔드 abuse
// 모니터링에 의존한다. 신규(beta) 키는 과금이 없고 시간당 100회로 제한될 뿐(초과 시 throttle/
// 정지)이지만, 이 한도는 앱 전체 사용자가 공유한다. 그래서 호출 측(room-view)에서 디바운스/
// 최소 글자수/캐싱으로 호출을 아낀다. config.local.js 에 giphyApiKey 가 없으면 [gif] 버튼은 숨김.
//
// rating=pg-13 을 매 호출에 넣어 성인물을 거른다(미지정 시 전체 등급이 섞여 나온다; best-effort).
//
// 정규화 결과: { id, title, thumbUrl, thumbW, thumbH, gifUrl, gifW, gifH, gifBytes }
// onPick 핸들러는 gifUrl/gifW/gifH 만 가지고 메시지를 보낸다. (tenor.js 와 동일한 형태 유지)

import { CHAT } from "../config.js";

const BASE = "https://api.giphy.com/v1/gifs";
// 한 페이지 크기. picker/paginator 가 무한 스크롤 페이지 크기로 재사용하므로 export.
export const DEFAULT_LIMIT = 24;
const RATING = "pg-13";

// 속도 제한(HTTP 429) 을 일반 네트워크 오류와 구분하기 위한 표식.
// 호출 측은 이걸 받아 "잠시 후 다시 시도" 안내만 하고 자동 재시도는 하지 않는다(한도 추가 소모 방지).
export class GiphyRateLimitError extends Error {
  constructor() {
    super("GIPHY_RATE_LIMITED");
    this.name = "GiphyRateLimitError";
  }
}

export function isGiphyConfigured() {
  return !!CHAT.giphyApiKey;
}

// rendition 객체 → { url, w, h, bytes }. Giphy 는 width/height/size 를 문자열로 주므로 숫자화.
// size 는 일부 rendition 에 없을 수 있어 가드(Tenor 의 size || null 과 동일 정책).
function rendition(r) {
  if (!r || !r.url) return null;
  return {
    url: r.url,
    w: parseInt(r.width, 10) || 0,
    h: parseInt(r.height, 10) || 0,
    bytes: r.size != null ? (Number(r.size) || null) : null,
  };
}

// 이름 목록을 순서대로 훑어 url 이 있는 첫 rendition 을 고른다(특정 rendition 누락 대비 fallback).
function pickRendition(images, names) {
  for (const name of names) {
    const r = rendition(images?.[name]);
    if (r) return r;
  }
  return null;
}

function normalize(result) {
  const images = result.images || {};
  // 썸네일·본문 모두 작은 렌디션(~100px)을 쓴다. 채팅은 GIF 를 작게(폭 31%) + pixelated 로
  // 표시하므로 100px 소스로 충분하고, 저장하는 URL 이 가리키는 파일이 가벼워 전송·로딩이 빠르다.
  // (DB 에는 URL 만 들어가지만, 받는 쪽이 불러올 실제 GIF 용량을 최소화하는 효과.)
  const thumb = pickRendition(images, ["fixed_width_small", "fixed_width", "downsized"]);
  const body = pickRendition(images, ["fixed_width_small", "fixed_width", "downsized"]);
  if (!thumb || !body) return null;
  return {
    id: result.id,
    title: result.title || "",
    thumbUrl: thumb.url,
    thumbW: thumb.w,
    thumbH: thumb.h,
    gifUrl: body.url,
    gifW: body.w,
    gifH: body.h,
    gifBytes: body.bytes,
  };
}

async function call(endpoint, params, signal) {
  if (!isGiphyConfigured()) throw new Error("GIPHY_NOT_CONFIGURED");
  const qs = new URLSearchParams({
    api_key: CHAT.giphyApiKey,
    rating: RATING,
    // limit 은 호출자(searchGifs/featuredGifs)가 항상 지정한다 — 여기 기본값을 두면 늘 덮어써지는 죽은 코드.
    ...params,
  });
  const res = await fetch(`${BASE}/${endpoint}?${qs}`, { signal });
  if (res.status === 429) throw new GiphyRateLimitError();
  if (!res.ok) throw new Error(`Giphy ${endpoint} ${res.status}`);
  const data = await res.json();
  // Giphy 응답 봉투: { data: [...], pagination, meta } — Tenor 의 results 와 헷갈리지 말 것.
  return (data.data || []).map(normalize).filter(Boolean);
}

// offset(무한 스크롤 다음 페이지)을 params 로 변환한다. offset:0 은 URL 에서 생략해
// 1페이지 요청을 기존과 바이트 단위로 동일하게 유지한다(캐시·동작 무변화).
function offsetParam(offset) {
  return offset > 0 ? { offset: String(offset) } : {};
}

// 검색. 빈 쿼리면 trending 과 동일 결과 — 호출 측 분기 부담을 줄임.
export function searchGifs(query, { limit = DEFAULT_LIMIT, offset = 0, signal } = {}) {
  const q = String(query || "").trim();
  if (!q) return featuredGifs({ limit, offset, signal });
  return call("search", { q, limit: String(limit), ...offsetParam(offset) }, signal);
}

// 트렌딩 GIF. 검색창이 비어 있는 초기 상태에서 표시. (Tenor 의 featured 대응 — 이름은 그대로 유지)
export function featuredGifs({ limit = DEFAULT_LIMIT, offset = 0, signal } = {}) {
  return call("trending", { limit: String(limit), ...offsetParam(offset) }, signal);
}
