// Giphy GIF picker. 검색 입력 + 결과 그리드 + 하단 attribution.
import { el } from "../../core/dom.js";
import { playKey } from "../../platform/sound.js";
import { searchGifs, featuredGifs, DEFAULT_LIMIT } from "../../chat/giphy.js";
import { createGifPaginator } from "../../chat/gif-paginator.js";

// Giphy beta 키는 시간당 100회(앱 전체 공유) 한도라 호출을 아껴야 한다 — 디바운스를 넉넉히.
const GIF_SEARCH_DEBOUNCE_MS = 600;

// 상황별 카테고리 — 라벨이 곧 Giphy 검색어(영어). 미리 정한 쿼리라 호출이 예측 가능하고 캐싱이 잘 먹는다.
const GIF_CATEGORIES = ["lol", "love", "yes", "no", "sad", "party", "hello", "wow", "clap", "cool"];

// 무한 스크롤 바닥 근접 판정(px). room-view 의 near-top/near-bottom 과 같은 house style.
const GIF_NEAR_BOTTOM_PX = 48;
// 검색어당 페이지 상한 — Giphy 공유 한도(시간당 100회) 보호. 5페이지 = offset 0/24/48/72/96 = 최대 120개.
const GIF_MAX_PAGES = 5;

// Giphy GIF picker. 검색 입력 + 결과 그리드 + 하단 attribution.
// 이모지 picker 와 동일한 popup 패턴(absolute, input-row 위쪽). 셀 클릭 → onPick(gif) → picker 닫힘.
export function buildGifPicker(onPick) {
  let visible = false;
  let abortCtl = null;
  let debounceTimer = null;
  let lastQuery = null;
  // loadMore 가 429/에러로 멈춘 뒤, 스크롤마다 같은 offset 을 재시도해 공유 한도를 소진하는 것을
  // 막는 플래그. 새 쿼리(load)에서 해제된다 → "재검색으로 재시도".
  let moreHalted = false;
  // 페이지네이션 로직(offset/중복제거/hasMore/캐시)은 순수 모듈에 위임. 여기선 렌더·스크롤·abort 만.
  const paginator = createGifPaginator({
    fetchPage: ({ query, offset, signal }) =>
      query ? searchGifs(query, { offset, signal }) : featuredGifs({ offset, signal }),
    pageSize: DEFAULT_LIMIT,
    maxPages: GIF_MAX_PAGES,
  });

  const searchInput = el("input", {
    class: "field room-gif-search",
    type: "text",
    placeholder: "search gifs…",
    spellcheck: "false",
    autocomplete: "off",
    dataset: { noDrag: "" },
  });
  searchInput.addEventListener("keydown", () => playKey()); // 레트로 일관성: GIF 검색도 키사운드
  const gridEl = el("div", { class: "room-gif-grid", dataset: { noDrag: "" } });
  const statusEl = el("div", { class: "room-gif-status", text: "", hidden: true });
  // loadMore(다음 페이지) 전용 상태줄. 그리드 '아래'에 두어 페이지 로드 시 그리드가 흔들리지 않게
  // 한다(그리드 위의 statusEl 을 재사용하면 매 페이지마다 그리드가 위/아래로 밀린다).
  const moreStatusEl = el("div", { class: "room-gif-status", text: "", hidden: true });
  // Giphy 약관(5A)은 공식 "Powered By GIPHY" 로고 마크를 눈에 띄게 표시하도록 요구한다 —
  // 단순 텍스트 링크로는 약관 미준수. 로고(흰색 변형)는 styles.css 에 data URI 배경으로 박아 둔다
  // (dev 서버가 실행 중 추가된 파일을 못 잡는 문제를 피하고, 정적 파일 서빙에 의존하지 않기 위함).
  const attribImg = el("span", {
    class: "room-gif-attrib-logo",
    role: "img",
    "aria-label": "Powered By GIPHY",
  });
  const attribEl = el("a", {
    class: "room-gif-attrib",
    href: "https://giphy.com",
    target: "_blank",
    rel: "noreferrer noopener",
    dataset: { noDrag: "" },
  }, [attribImg]);

  function setStatus(text) {
    statusEl.textContent = text;
    statusEl.hidden = !text;
  }
  function setMoreStatus(text) {
    moreStatusEl.textContent = text;
    moreStatusEl.hidden = !text;
  }

  // 결과 GIF 하나를 셀 버튼으로. 클릭 → picker 닫고 onPick(첨부로 스테이징).
  function buildCell(gif) {
    const thumb = el("img", {
      class: "room-gif-thumb",
      src: gif.thumbUrl,
      alt: gif.title || "",
      loading: "lazy",
    });
    const cell = el("button", {
      class: "btn room-gif-cell",
      type: "button",
      title: gif.title || "",
    }, [thumb]);
    cell.addEventListener("click", () => {
      hide();
      onPick(gif);
    });
    return cell;
  }

  function cellsFragment(gifs) {
    const frag = document.createDocumentFragment();
    for (const gif of gifs) frag.append(buildCell(gif));
    return frag;
  }

  // 첫 페이지/캐시 복원: 그리드를 통째로 교체하고 스크롤을 맨 위로.
  function renderResults(results) {
    gridEl.replaceChildren();
    if (!results.length) {
      setStatus("no results");
      return;
    }
    setStatus("");
    gridEl.append(cellsFragment(results));
    gridEl.scrollTop = 0;
  }

  // 다음 페이지: 아래로 이어 붙이기만 — scrollTop 은 건드리지 않는다(아래로 성장해 위치 자동 유지).
  function appendResults(newItems) {
    if (!newItems.length) return;
    gridEl.append(cellsFragment(newItems));
  }

  async function load(query) {
    const { hit, items } = paginator.beginQuery(query);
    // 새 쿼리는 loadMore 를 다시 허용하고, 이전 쿼리의 loadMore 상태줄(예: 한도 초과) 잔상을 지운다.
    moreHalted = false;
    setMoreStatus("");
    // 진행 중 요청을 취소하고 항상 새 컨트롤러를 만든다 — 캐시 히트라 fetch 가 없어도, 이후
    // loadMore 가 abortCtl.signal 을 읽으므로 null 로 두면 안 된다.
    if (abortCtl) abortCtl.abort();
    abortCtl = new AbortController();
    if (hit) {
      renderResults(items);
      return;
    }
    const signal = abortCtl.signal;
    setStatus("loading…");
    gridEl.replaceChildren();
    try {
      const res = await paginator.loadFirst(signal);
      if (res.stale) return;
      renderResults(res.items);
    } catch (e) {
      if (e?.name === "AbortError") return;
      // 오류로 끝난 쿼리는 캐시되지 않는다. lastQuery 도 비워, 같은 검색어를 다시 입력만 해도
      // (input 핸들러의 q === lastQuery 가드에 막히지 않고) 재시도되게 한다.
      lastQuery = null;
      // 속도 제한(429): 자동 재시도하면 한도를 더 깎으므로 안내만 하고 멈춘다.
      if (e?.name === "GiphyRateLimitError") {
        setStatus("검색 한도 초과 — 잠시 후 다시 시도");
        return;
      }
      console.error("giphy load failed:", e);
      setStatus("error — try again");
    }
  }

  // 다음 페이지 로드 → 그리드 아래로 append. paginator 가 인플라이트/hasMore/상한을 관리한다.
  async function loadMore() {
    if (!visible || moreHalted) return;
    // hide() 는 abortCtl 을 null 로 두고, show() 는 그리드가 차 있으면 load()를 부르지 않는다.
    // 그 경로(hide→show→scroll)에선 컨트롤러가 없으므로 여기서 만들어 null.signal 크래시를 막는다.
    if (!abortCtl) abortCtl = new AbortController();
    setMoreStatus("loading more…");
    try {
      const res = await paginator.loadMore(abortCtl.signal);
      // stale(새 쿼리가 끼어듦) 또는 skipped(로딩 중/소진) — 조용히 상태줄만 정리.
      if (res.stale || res.skipped) {
        setMoreStatus("");
        return;
      }
      appendResults(res.newItems);
      setMoreStatus("");
    } catch (e) {
      if (e?.name === "AbortError") return; // 상태줄 그대로 — 새 로드가 갈아끼운다.
      // 429/기타: 이 쿼리 세션 동안 loadMore 를 중단한다. paginator 의 hasMore 는 true 로 남아 있어
      // (캐시 오염 방지) 이 플래그가 없으면 스크롤마다 같은 offset 을 재시도해 공유 한도를 소진한다.
      moreHalted = true;
      if (e?.name === "GiphyRateLimitError") {
        setMoreStatus("검색 한도 초과 — 잠시 후 다시 시도");
        return;
      }
      console.error("giphy loadMore failed:", e);
      setMoreStatus("error — try again");
    }
  }

  // 그리드가 바닥 근처까지 스크롤되면 다음 페이지를 당긴다(house style: passive scroll 리스너).
  function onGridScroll() {
    if (!visible || moreHalted) return;
    const distFromBottom = gridEl.scrollHeight - gridEl.scrollTop - gridEl.clientHeight;
    if (distFromBottom < GIF_NEAR_BOTTOM_PX) loadMore();
  }

  function scheduleLoad(query) {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => load(query), GIF_SEARCH_DEBOUNCE_MS);
  }

  // --- 상황별 카테고리 바 (카오모지 sub-tab 과 동일 패턴) ---
  const catBtns = new Map();
  const categoriesEl = el("div", { class: "room-gif-cats", dataset: { noDrag: "" } });
  for (const term of GIF_CATEGORIES) {
    const btn = el("button", { class: "btn room-gif-cat", text: term, title: term, type: "button" });
    btn.addEventListener("click", () => {
      searchInput.value = term;
      lastQuery = term;
      setActiveCat(term);
      clearTimeout(debounceTimer); // 카테고리는 즉시 로드(캐시 적중이면 네트워크 호출 없음)
      load(term);
    });
    catBtns.set(term, btn);
    categoriesEl.append(btn);
  }
  function setActiveCat(active) {
    for (const [term, btn] of catBtns) btn.classList.toggle("active", term === active);
  }

  searchInput.addEventListener("input", () => {
    const q = searchInput.value.trim();
    if (q === lastQuery) return;
    lastQuery = q;
    setActiveCat(q); // 카테고리와 일치하면 강조, 아니면 강조 해제
    // 1글자는 입력 도중으로 보고 호출을 보류한다(한도 절약). 빈 칸은 트렌딩으로 허용.
    if (q.length === 1) return;
    scheduleLoad(q);
  });

  const popupEl = el("div", { class: "room-gif-popup", hidden: true }, [
    searchInput,
    categoriesEl,
    statusEl,
    gridEl,
    moreStatusEl,
    attribEl,
  ]);
  // 무한 스크롤: 그리드가 바닥 근처면 다음 페이지 로드. 빌드 시 1회 부착, cleanup 에서 제거.
  gridEl.addEventListener("scroll", onGridScroll, { passive: true });

  function show() {
    if (visible) return;
    visible = true;
    popupEl.hidden = false;
    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onDocKeyDown, true);
    if (!gridEl.children.length) load(searchInput.value.trim());
    setTimeout(() => searchInput.focus(), 0);
  }

  function hide() {
    if (!visible) return;
    visible = false;
    popupEl.hidden = true;
    if (abortCtl) abortCtl.abort();
    abortCtl = null;
    clearTimeout(debounceTimer);
    // 진행 중이던 "loading more…" 잔상을 지운다(재오픈 시 load()가 안 불릴 수 있으므로).
    // 단, halt 상태의 종료 메시지(한도 초과/에러)는 재오픈해도 유지되게 남겨 둔다.
    if (!moreHalted) setMoreStatus("");
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onDocKeyDown, true);
  }

  function toggle() {
    if (visible) hide();
    else show();
  }

  function onDocMouseDown(e) {
    if (popupEl.contains(e.target)) return;
    hide();
  }

  function onDocKeyDown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      hide();
    }
  }

  function cleanup() {
    if (visible) hide();
    clearTimeout(debounceTimer);
    if (abortCtl) abortCtl.abort();
    gridEl.removeEventListener("scroll", onGridScroll);
  }

  return { popupEl, show, toggle, hide, cleanup };
}
