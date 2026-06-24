// Giphy GIF picker. 검색 입력 + 결과 그리드 + 하단 attribution.
import { el } from "../../core/dom.js";
import { searchGifs, featuredGifs } from "../../chat/giphy.js";

// Giphy beta 키는 시간당 100회(앱 전체 공유) 한도라 호출을 아껴야 한다 — 디바운스를 넉넉히.
const GIF_SEARCH_DEBOUNCE_MS = 600;

// 상황별 카테고리 — 라벨이 곧 Giphy 검색어(영어). 미리 정한 쿼리라 호출이 예측 가능하고 캐싱이 잘 먹는다.
const GIF_CATEGORIES = ["lol", "love", "yes", "no", "sad", "party", "hello", "wow", "clap", "cool"];

// Giphy GIF picker. 검색 입력 + 결과 그리드 + 하단 attribution.
// 이모지 picker 와 동일한 popup 패턴(absolute, input-row 위쪽). 셀 클릭 → onPick(gif) → picker 닫힘.
export function buildGifPicker(onPick) {
  let visible = false;
  let abortCtl = null;
  let debounceTimer = null;
  let lastQuery = null;
  // 같은 검색어를 다시 조회하지 않도록 결과를 캐싱한다(key: 쿼리, "" = 트렌딩).
  // Giphy beta 키의 시간당 100회 공유 한도를 아끼기 위함.
  const cache = new Map();

  const searchInput = el("input", {
    class: "field room-gif-search",
    type: "text",
    placeholder: "search gifs…",
    spellcheck: "false",
    autocomplete: "off",
    dataset: { noDrag: "" },
  });
  const gridEl = el("div", { class: "room-gif-grid", dataset: { noDrag: "" } });
  const statusEl = el("div", { class: "room-gif-status", text: "", hidden: true });
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

  function renderResults(results) {
    gridEl.replaceChildren();
    if (!results.length) {
      setStatus("no results");
      return;
    }
    setStatus("");
    const frag = document.createDocumentFragment();
    for (const gif of results) {
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
      frag.append(cell);
    }
    gridEl.append(frag);
    gridEl.scrollTop = 0;
  }

  async function load(query) {
    // 캐시 적중이면 네트워크 호출 없이 바로 렌더(진행 중 요청은 취소).
    if (cache.has(query)) {
      if (abortCtl) abortCtl.abort();
      abortCtl = null;
      renderResults(cache.get(query));
      return;
    }
    if (abortCtl) abortCtl.abort();
    abortCtl = new AbortController();
    const signal = abortCtl.signal;
    setStatus("loading…");
    gridEl.replaceChildren();
    try {
      const results = query
        ? await searchGifs(query, { signal })
        : await featuredGifs({ signal });
      if (signal.aborted) return;
      cache.set(query, results);
      renderResults(results);
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
    attribEl,
  ]);

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
  }

  return { popupEl, show, toggle, hide, cleanup };
}
