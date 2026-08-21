// Giphy v1 검색 API 래퍼. Tenor 가 신규 발급/운영을 종료(2026-06-30 전면 종료)해 이쪽으로 교체했다.
// docs: developers.giphy.com/docs/api  (search + trending 엔드포인트)
//
// GIF(/v1/gifs)와 스티커(/v1/stickers)는 경로 첫 조각만 다르고 응답 봉투·rendition 구조가 같다.
// 그래서 createGiphyApi(kind) 하나로 둘 다 만든다. 정규화·에러 처리·파라미터는 전부 공유한다.
//
// 키 노출에 대하여: Giphy 키는 클라이언트 사용을 전제로 하며, Tenor 와 달리 referer/도메인
// 제한 장치가 없다. 앱에 박힌 키는 누구나 읽어 쓸 수 있고, 방어는 Giphy 의 백엔드 abuse
// 모니터링에 의존한다. 신규(beta) 키는 과금이 없고 시간당 100회로 제한될 뿐(초과 시 throttle/
// 정지)이지만, 이 한도는 앱 전체 사용자가 공유한다. 그래서 호출 측(picker)에서 디바운스/
// 최소 글자수/캐싱으로 호출을 아낀다. config.local.js 에 giphyApiKey 가 없으면 [gif]·[sticker]
// 버튼은 숨김.
//
// rating=pg-13 을 매 호출에 넣어 성인물을 거른다(미지정 시 전체 등급이 섞여 나온다; best-effort).
//
// 정규화 결과: { id, title, thumbUrl, thumbW, thumbH, gifUrl, gifW, gifH, gifBytes }
// onPick 핸들러는 gifUrl/gifW/gifH 만 가지고 메시지를 보낸다. (tenor.js 와 동일한 형태 유지)

import { CHAT } from "../config.js";

const BASE = "https://api.giphy.com/v1";
// 한 페이지 크기. picker/paginator 가 무한 스크롤 페이지 크기로 재사용하므로 export.
export const DEFAULT_LIMIT = 24;
const RATING = "pg-13";

// 재시도해도 소용없는 응답(429 한도, 401/403 키 막힘)을 받으면 이 시각까지 모든 호출을 네트워크
// 없이 거절한다. 한도도 키도 API 키 단위(앱 전체 공유)라 picker 인스턴스마다 막아서는 소용이 없다.
// 이게 없으면 팝업을 닫았다 열 때마다(그리드가 비어 있어 load 가 다시 돈다), 그리고 바닥까지
// 스크롤할 때마다 확실히 실패할 요청이 또 나간다.
const BLOCK_COOLDOWN_MS = 60_000;
let blockedUntil = 0;
let blockedKind = null;

// 쿨다운 중에는 처음 받았던 것과 같은 종류의 오류를 다시 던진다. 화면 문구가 도중에 바뀌지 않도록.
function blockedError() {
  return blockedKind === "unavailable" ? new GiphyUnavailableError() : new GiphyRateLimitError();
}

function block(kind) {
  blockedUntil = Date.now() + BLOCK_COOLDOWN_MS;
  blockedKind = kind;
  return blockedError();
}

// 테스트가 모듈 상태를 되돌리기 위한 것. 앱 코드에서는 쓰지 않는다.
export function resetGiphyCooldown() {
  blockedUntil = 0;
  blockedKind = null;
}

// 속도 제한(HTTP 429) 을 일반 네트워크 오류와 구분하기 위한 표식.
// 호출 측은 이걸 받아 "잠시 후 다시 시도" 안내만 하고 자동 재시도는 하지 않는다(한도 추가 소모 방지).
export class GiphyRateLimitError extends Error {
  constructor() {
    super("GIPHY_RATE_LIMITED");
    this.name = "GiphyRateLimitError";
  }
}

// 키 자체가 막힌 상태(정지·오설정·abuse 차단). 429 와 달리 기다린다고 풀린다는 보장이 없지만,
// 재시도를 멈춰야 하는 점은 같다. 사용자에겐 "다시 시도"가 아니라 "지금은 못 쓴다"로 안내한다.
export class GiphyUnavailableError extends Error {
  constructor() {
    super("GIPHY_UNAVAILABLE");
    this.name = "GiphyUnavailableError";
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
  if (!result) return null;
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

async function call(path, params, signal) {
  if (!isGiphyConfigured()) throw new Error("GIPHY_NOT_CONFIGURED");
  if (Date.now() < blockedUntil) throw blockedError();
  const qs = new URLSearchParams({
    api_key: CHAT.giphyApiKey,
    rating: RATING,
    // limit 은 호출자(search/trending)가 항상 지정한다 — 여기 기본값을 두면 늘 덮어써지는 죽은 코드.
    ...params,
  });
  const res = await fetch(`${BASE}/${path}?${qs}`, { signal });
  if (res.status === 429) throw block("rate");
  if (res.status === 401 || res.status === 403) throw block("unavailable");
  if (!res.ok) throw new Error(`Giphy ${path} ${res.status}`);
  const data = await res.json();
  // Giphy 응답 봉투: { data: [...], pagination, meta } — Tenor 의 results 와 헷갈리지 말 것.
  const list = Array.isArray(data?.data) ? data.data : [];
  const items = list.map(normalize).filter(Boolean);
  // 서버는 줬는데 전부 걸러졌으면 화면엔 "no results" 로만 보여 원인을 알 수 없다. 콘솔에 남긴다.
  // (스티커는 GIF 와 rendition 구성이 다를 수 있어 이 경로가 실제로 열려 있다.)
  if (list.length && !items.length) {
    console.warn(`Giphy ${path}: ${list.length}건이 모두 rendition 누락으로 걸러졌다`);
  }
  // rawCount 는 걸러내기 전 개수. paginator 가 이걸로 hasMore 를 판정해서, 걸러진 한두 건 때문에
  // 아직 남았는데도 무한 스크롤이 끝나 버리는 일을 막는다.
  return { items, rawCount: list.length };
}

// offset(무한 스크롤 다음 페이지)을 params 로 변환한다. offset:0 은 URL 에서 생략해
// 1페이지 요청을 기존과 바이트 단위로 동일하게 유지한다(캐시·동작 무변화).
function offsetParam(offset) {
  return offset > 0 ? { offset: String(offset) } : {};
}

// kind: "gifs" | "stickers"
export function createGiphyApi(kind) {
  function trending({ limit = DEFAULT_LIMIT, offset = 0, signal } = {}) {
    return call(`${kind}/trending`, { limit: String(limit), ...offsetParam(offset) }, signal);
  }

  return {
    // 빈 쿼리면 trending 과 동일 결과 — 호출 측 분기 부담을 줄임.
    search(query, { limit = DEFAULT_LIMIT, offset = 0, signal } = {}) {
      const q = String(query || "").trim();
      if (!q) return trending({ limit, offset, signal });
      return call(`${kind}/search`, { q, limit: String(limit), ...offsetParam(offset) }, signal);
    },
  };
}
