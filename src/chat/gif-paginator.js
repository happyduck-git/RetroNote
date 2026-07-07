// GIF 무한 스크롤 페이지네이터. 순수 로직(DOM/fetch 없음) — fetchPage 를 DI 로 받는다.
// history-loader.js 와 같은 패턴: 클로저 상태 + loading 인플라이트 가드 + { hasMore } 계약.
// picker(뷰)는 이 위에 얇게 얹혀 렌더/스크롤/abort/상태DOM 만 담당한다.
//
// 쿼리별로 { items, offset, hasMore, seen, pages } 스냅샷을 cache 에 값-복사로 저장해,
// 검색어를 오갔다 돌아와도 로드된 페이지와 스크롤 재개 지점을 그대로 복원한다.
// Giphy beta 키의 시간당 100회(앱 전체 공유) 한도 때문에 maxPages 로 검색어당 호출 수를 상한한다.
//
// fetchPage({ query, offset, signal }) -> Promise<gif[]>  (picker 가 실제 giphy 호출을 주입)
export function createGifPaginator({ fetchPage, pageSize = 24, maxPages = 5 }) {
  let query = null;     // 현재 쿼리("" = 트렌딩). fetchPage 에 그대로 넘긴다.
  let offset = 0;
  let hasMore = false;
  let loading = false;  // loadFirst/loadMore 겸용 인플라이트 가드
  let seq = 0;          // 세대 토큰: 새 쿼리(beginQuery)가 올리면 진행 중이던 호출이 stale 판정된다.
  let seen = new Set(); // 중복 id 제거(트렌딩은 페이지가 시프트되며 같은 GIF 가 섞여 나온다).
  let items = [];       // 현재 쿼리의 누적 결과.
  let pages = 0;
  const cache = new Map(); // query -> 스냅샷(값 복사본).

  // seen 에 없는 id 만 남기고 그 id 를 seen 에 추가한 신규 배열을 반환.
  function dedup(page) {
    const fresh = [];
    for (const gif of page) {
      if (seen.has(gif.id)) continue;
      seen.add(gif.id);
      fresh.push(gif);
    }
    return fresh;
  }

  // 현재 상태를 쿼리 스냅샷으로 저장. 배열/Set 은 값-복사해 공유 가변 참조를 없앤다
  // (쿼리를 전환하며 계속 push 해도 캐시된 다른 쿼리 스냅샷이 오염되지 않도록).
  function writeCache() {
    cache.set(query, {
      items: items.slice(),
      offset,
      hasMore,
      seen: new Set(seen),
      pages,
    });
  }

  // 새 쿼리 진입. seq 를 올려 진행 중 호출을 무효화하고 loading 을 푼다(stale 호출의 finally 는
  // seq 불일치로 loading 리셋을 건너뛰므로, 새 쿼리가 스스로 풀어줘야 loadMore 가 다시 가능).
  // 캐시 히트면 스냅샷을 복사해 복원(로드된 페이지 이어서 재개), 미스면 새 컨테이너로 초기화.
  function beginQuery(nextQuery) {
    query = nextQuery;
    seq++;
    loading = false;
    const snap = cache.get(nextQuery);
    if (snap) {
      items = snap.items.slice();
      offset = snap.offset;
      hasMore = snap.hasMore;
      seen = new Set(snap.seen);
      pages = snap.pages;
      return { hit: true, items };
    }
    // 미스: 기존 배열/Set 을 clear 하지 말고 새로 만든다(이전 쿼리 스냅샷 보존).
    items = [];
    seen = new Set();
    offset = 0;
    pages = 0;
    hasMore = true;
    return { hit: false };
  }

  // 1페이지(offset 0). 저장된 query 를 사용. stale/abort 면 상태 미변경으로 빠진다.
  // fetchPage 가 throw 하면 finally 로 loading 만 풀고 에러를 그대로 전파(picker 가 상태DOM 담당).
  async function loadFirst(signal) {
    const s = seq;
    loading = true;
    try {
      const page = await fetchPage({ query, offset: 0, signal });
      if (s !== seq || signal.aborted) return { stale: true };
      items = dedup(page); // seen 이 비어 전부 신규
      offset = pageSize;
      pages = 1;
      hasMore = page.length >= pageSize && pages < maxPages;
      writeCache();
      return { items, hasMore };
    } finally {
      if (s === seq) loading = false;
    }
  }

  // 다음 페이지. loading/hasMore 가드로 인플라이트 1개·소진 후 no-op.
  async function loadMore(signal) {
    if (loading || !hasMore) return { skipped: true };
    const s = seq;
    loading = true;
    try {
      const page = await fetchPage({ query, offset, signal });
      if (s !== seq || signal.aborted) return { stale: true };
      const newItems = dedup(page);
      // offset 은 요청한 pageSize 만큼 전진(정규화로 걸러진 개수가 아님) — Giphy 원본 인덱싱 정렬 유지.
      offset += pageSize;
      pages++;
      items.push(...newItems);
      // 풀 페이지 + 실제 신규분이 있고 + 상한 미만일 때만 계속. 전부 중복이면 멈춰 스핀 루프 방지
      // (history-loader.js 의 newlyAdded>0 가드와 동일 취지).
      hasMore = page.length >= pageSize && newItems.length > 0 && pages < maxPages;
      writeCache();
      return { newItems, hasMore };
    } finally {
      if (s === seq) loading = false;
    }
  }

  return { beginQuery, loadFirst, loadMore };
}

// loadMore 실패를 이 쿼리 세션 동안 완전히 중단(halt)해야 하는지 판정하는 순수 정책.
// 429(GiphyRateLimitError, 앱 전체 공유 한도)만 halt — 재시도해도 한도만 더 깎이고 무의미하므로
// 새 검색 전까지 멈춘다. 그 외(네트워크 등 일시적 오류)는 halt 하지 않아 다음 스크롤에서 재시도된다.
// (AbortError 는 뷰에서 먼저 걸러져 여기까지 오지 않는다.)
export function shouldHaltLoadMore(err) {
  return err?.name === "GiphyRateLimitError";
}
