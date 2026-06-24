// 카오모지 picker 팝업. 단일 패널: 검색 input → 카테고리 sub-tab → 스크롤 grid.
import { el } from "../../core/dom.js";
import { KAOMOJI_GROUPS } from "../../chat/kaomoji-data.js";

// 카오모지 picker 팝업. 단일 패널: 검색 input → 카테고리 sub-tab → 스크롤 grid.
// 셀 클릭은 input 의 캡쳐된 selectionStart/End 위치에 문자열을 끼워넣고 팝업을 닫는다.
// 팝업이 열리는 순간 selection 을 캡쳐 — 입력 도중 emoji 버튼을 눌러도 input 은 selectionStart 를
// blur 후에도 유지하기 때문에 마지막 커서 위치 보존이 안정적.
export function buildEmojiPicker(input) {
  let activeCategorySlug = KAOMOJI_GROUPS[0].slug;
  let searchQuery = "";
  let savedStart = null;
  let savedEnd = null;
  let visible = false;

  function captureSelection() {
    savedStart = input.selectionStart ?? input.value.length;
    savedEnd = input.selectionEnd ?? input.value.length;
  }

  function insertAtCaret(text) {
    const start = savedStart ?? input.value.length;
    const end = savedEnd ?? input.value.length;
    input.value = input.value.slice(0, start) + text + input.value.slice(end);
    const pos = start + text.length;
    input.focus();
    input.setSelectionRange(pos, pos);
    // 다음 삽입을 위해 새 커서 위치를 저장(연속 삽입 케이스).
    savedStart = pos;
    savedEnd = pos;
  }

  // --- 검색 input ---
  const searchInput = el("input", {
    class: "field room-emoji-search",
    type: "text",
    placeholder: "search kaomoji…",
    spellcheck: "false",
    autocomplete: "off",
    dataset: { noDrag: "" },
  });

  // --- 카테고리 sub-tab 바 ---
  const subTabsEl = el("div", { class: "room-emoji-subtabs", dataset: { noDrag: "" } });
  const subTabBtns = new Map();
  for (const grp of KAOMOJI_GROUPS) {
    const tab = el("button", {
      class: "btn room-emoji-subtab",
      text: grp.name,
      title: grp.name,
      type: "button",
    });
    tab.addEventListener("click", () => {
      if (searchInput.value) {
        searchInput.value = "";
        searchQuery = "";
      }
      activeCategorySlug = grp.slug;
      renderSubTabs();
      renderGrid();
      gridEl.scrollTop = 0;
    });
    subTabBtns.set(grp.slug, tab);
    subTabsEl.append(tab);
  }

  // --- 스크롤 grid ---
  const gridEl = el("div", { class: "room-emoji-grid", dataset: { noDrag: "" } });

  function renderSubTabs() {
    for (const [slug, btn] of subTabBtns) {
      btn.classList.toggle("active", !searchQuery && slug === activeCategorySlug);
      btn.disabled = !!searchQuery;
    }
  }

  // 검색 매칭 룰: (1) 카오모지 자체에 쿼리 포함 (예 ":D")
  //              (2) 카테고리명/slug 에 쿼리 포함 (예 "love" → Love 카테고리 전체)
  function renderGrid() {
    let list;
    if (searchQuery) {
      const q = searchQuery;
      list = [];
      for (const grp of KAOMOJI_GROUPS) {
        const groupMatch = grp.name.toLowerCase().includes(q) || grp.slug.includes(q);
        for (const k of grp.kaomojis) {
          if (groupMatch || k.toLowerCase().includes(q)) list.push(k);
        }
      }
    } else {
      const grp = KAOMOJI_GROUPS.find((g) => g.slug === activeCategorySlug);
      list = grp ? grp.kaomojis : [];
    }
    gridEl.replaceChildren();
    if (list.length === 0) {
      gridEl.append(el("div", { class: "room-emoji-empty", text: "no results" }));
      return;
    }
    const frag = document.createDocumentFragment();
    for (const k of list) {
      const cell = el("button", {
        class: "btn room-emoji-cell",
        text: k,
        type: "button",
      });
      cell.addEventListener("click", () => { insertAtCaret(k); hide(); });
      frag.append(cell);
    }
    gridEl.append(frag);
  }

  searchInput.addEventListener("input", () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    renderSubTabs();
    renderGrid();
    gridEl.scrollTop = 0;
  });

  // 팝업 컨테이너 (단일 패널)
  const popupEl = el("div", { class: "room-emoji-popup", hidden: true }, [searchInput, subTabsEl, gridEl]);

  function show() {
    if (visible) return;
    captureSelection();
    visible = true;
    popupEl.hidden = false;
    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onDocKeyDown, true);
  }

  function hide() {
    if (!visible) return;
    visible = false;
    popupEl.hidden = true;
    // 다음 열기 위해 상태 초기화 — 첫 카테고리, 검색 비움.
    activeCategorySlug = KAOMOJI_GROUPS[0].slug;
    searchInput.value = "";
    searchQuery = "";
    renderSubTabs();
    renderGrid();
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onDocKeyDown, true);
  }

  function toggle() {
    if (visible) hide();
    else show();
  }

  // 외부 클릭으로 닫기 — emoji 버튼 본인의 클릭은 toggle 로 처리되므로 여기서 무시.
  function onDocMouseDown(e) {
    if (popupEl.contains(e.target)) return;
    if (e.target.closest?.(".room-emoji-btn")) return;
    hide();
  }

  function onDocKeyDown(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      hide();
    }
  }

  // 초기 렌더
  renderSubTabs();
  renderGrid();

  function cleanup() {
    if (visible) hide();
  }

  return { popupEl, toggle, hide, cleanup };
}
