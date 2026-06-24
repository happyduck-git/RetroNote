// 채팅방: 메시지 목록 + 입력 + 전송 + 나가기. 연결 상태/온라인 인원 표시.
// 영속 메시지는 Postgres에서 history fetch → store.seed. 새 메시지는 postgres_changes echo.
// 송신은 transport.send (DB INSERT) → echo로 자기 자신에게도 돌아오지만 store의 id dedup이 처리.
import { el, pad2 } from "../core/dom.js";
import { playKey } from "../platform/sound.js";
import { openExternal } from "../platform/opener.js";
import { getRoomNickname, getClientId, openRoom, closeRoom, saveRoom, changeRoomNickname } from "../chat/session.js";
import { KAOMOJI_GROUPS } from "../chat/kaomoji-data.js";
import { tokenizeMessage } from "../chat/linkify.js";
import { withDateDividers } from "../chat/date-divider.js";
import { uploadAttachment } from "../chat/attachment.js";
import { searchGifs, featuredGifs, isGiphyConfigured } from "../chat/giphy.js";

const COPY_FEEDBACK_MS = 1200;
const NEAR_BOTTOM_PX = 40;
// Giphy beta 키는 시간당 100회(앱 전체 공유) 한도라 호출을 아껴야 한다 — 디바운스를 넉넉히.
const GIF_SEARCH_DEBOUNCE_MS = 600;

// 상황별 카테고리 — 라벨이 곧 Giphy 검색어(영어). 미리 정한 쿼리라 호출이 예측 가능하고 캐싱이 잘 먹는다.
const GIF_CATEGORIES = ["lol", "love", "yes", "no", "sad", "party", "hello", "wow", "clap", "cool"];

function fmtBytes(n) {
  if (n == null) return "";
  if (n < 1024) return `${n}B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)}kb`;
  return `${(n / 1024 / 1024).toFixed(1)}mb`;
}

// mount 토큰: 동일 뷰 객체가 register-once 싱글톤이라 await 중 재mount가 끼어들 수 있다.
// mount 진입 시 myToken 캡처 → unmount/재mount는 mountToken 증가 → 이전 await 분기가 자기 myToken 과의 불일치로 빠진다.
let mountToken = 0;

const NICK_MAX = 16;

const STATUS_TEXT = {
  connecting: "connecting…",
  connected: "● online",
  reconnecting: "reconnecting…",
  closed: "offline",
  error: "error",
};

function fmtTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
}

// 헤더: 방 코드 라벨 + 복사 버튼 + (옵션) 닉네임 에디터 + 상태 + 나가기.
function buildHeader(code, { onLeave, nicknameEditor } = {}) {
  const codeLabel = el("span", { class: "room-code", text: code });
  const copyBtn = el("button", { class: "btn room-copy", title: "Copy code", text: "[copy]" });
  copyBtn.addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(code);
      copyBtn.textContent = "[copied]";
      setTimeout(() => (copyBtn.textContent = "[copy]"), COPY_FEEDBACK_MS);
    } catch (e) {
      console.error("copy failed:", e);
    }
  });
  const statusEl = el("span", { class: "room-status", text: STATUS_TEXT.connecting });
  const leaveBtn = el("button", { class: "btn room-leave", title: "Leave", text: "[X]", onClick: onLeave });
  const children = [codeLabel, copyBtn];
  if (nicknameEditor) children.push(nicknameEditor);
  children.push(statusEl, leaveBtn);
  const headerEl = el("div", { class: "room-header" }, children);
  return { headerEl, statusEl };
}

// 본인 닉네임 라벨 + [✎] 인라인 에디터. alias 편집과 동일한 commit/cancel 패턴.
// getCurrentNick: 호출 시 라이브로 현재 표시값 조회 → openRoom 양방향 sync 결과를 반영.
// onCommit(newNick): 새 값 commit 콜백 (실제 changeRoomNickname 호출자가 주입). throw 시 표시는 기존 값으로 복귀.
function buildNickEditor(getCurrentNick, onCommit) {
  const nickLabel = el("span", { class: "room-nick", text: getCurrentNick() });
  const nickAs = el("span", { class: "room-nick-as", text: "as:" });
  const nickEditBtn = el("button", { class: "btn room-nick-edit", title: "Edit nickname", text: "[✎]" });
  const nickWrap = el("span", { class: "room-nick-wrap" }, [nickAs, nickLabel, nickEditBtn]);

  function startNickEdit() {
    if (!nickLabel.isConnected) return;
    const currentNick = getCurrentNick() || nickLabel.textContent;
    const input = el("input", {
      class: "field room-nick-input",
      type: "text",
      maxlength: String(NICK_MAX),
      value: currentNick,
      placeholder: "nickname",
      spellcheck: "false",
      autocomplete: "off",
      dataset: { noDrag: "" },
    });
    let done = false;
    const finish = (next) => {
      if (done) return;
      done = true;
      nickLabel.textContent = next;
      input.replaceWith(nickLabel);
    };
    const commit = async () => {
      const v = input.value.trim();
      const currentLive = getCurrentNick();
      if (!v) {
        input.classList.add("invalid");
        input.focus();
        input.select();
        setTimeout(() => input.classList.remove("invalid"), 400);
        return;
      }
      if (v.length > NICK_MAX) {
        input.classList.add("invalid");
        setTimeout(() => input.classList.remove("invalid"), 400);
        return;
      }
      if (v === currentLive) {
        finish(currentLive);
        return;
      }
      try {
        await onCommit(v);
        finish(v);
      } catch (e) {
        console.error("changeRoomNickname failed:", e);
        finish(currentLive || currentNick);
      }
    };
    const cancel = () => finish(getCurrentNick() || currentNick);

    input.addEventListener("keydown", (e) => {
      playKey();
      // IME composition 중 Enter 는 commit 키 → 무시. 한글/일본어/중국어 입력 시 마지막 글자 중복 방지.
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        cancel();
      }
    });
    // blur 는 commit 으로 처리 — alias 편집과 동일 패턴. 실패하면 finish 가 기존 값 복원.
    input.addEventListener("blur", commit);

    nickLabel.replaceWith(input);
    input.focus();
    input.select();
  }

  nickEditBtn.addEventListener("click", () => {
    playKey();
    startNickEdit();
  });

  return nickWrap;
}

// 입력행: 이모지 버튼 + 첨부([+]) 버튼 + 메시지 input + 전송 버튼. 초기 상태는 비활성(연결 후 활성).
// [img]·[gif] 를 한 줄에 늘어놓는 대신 [+] 하나로 일원화 — 클릭 시 작은 메뉴([img]/[gif])를 띄운다.
// showGif=false(Giphy 키 미설정)면 GIF 가 없어 메뉴가 무의미하므로 [+] 대신 [img] 로 두고 곧장 파일 선택을 연다.
// fileInput 은 hidden 으로 행에 포함 — DOM tree 가 깨끗하고 별도 컨테이너 없이 트리거.
function buildInputRow({ showGif }) {
  const emojiBtn = el("button", {
    class: "btn room-emoji-btn",
    text: "[^_^]",
    title: "Insert emoji",
    type: "button",
  });
  const mediaBtn = el("button", {
    class: "btn room-media-btn",
    text: showGif ? "[+]" : "[img]",
    title: showGif ? "Attach image or GIF" : "Attach image",
    type: "button",
    disabled: true,
  });
  const fileInput = el("input", {
    type: "file",
    accept: "image/png,image/jpeg,image/gif,image/webp",
    class: "room-file-input",
    hidden: true,
  });
  const input = el("input", {
    class: "field room-input",
    type: "text",
    maxlength: "500",
    placeholder: "message…",
    spellcheck: "false",
    autocomplete: "off",
    dataset: { noDrag: "" },
  });
  const sendBtn = el("button", { class: "btn room-send", text: "[ SEND ]", disabled: true });
  const inputRowEl = el("div", { class: "room-input-row", dataset: { noDrag: "" } }, [
    emojiBtn,
    mediaBtn,
    input,
    sendBtn,
    fileInput,
  ]);
  return { inputRowEl, emojiBtn, mediaBtn, fileInput, input, sendBtn };
}

// 첨부 미리보기 칩. 입력 행 위에 한 줄로 떠 있다가 첨부 해제 시 자동 숨김.
// 상태:
//   - uploading : 파일명 + "uploading…"     (X 비활성)
//   - ready     : 파일명 + 크기 + [×]       (X 클릭 시 onRemove)
//   - error     : 파일명 + 에러 메시지      (X 로 닫기)
function buildAttachPreview({ onRemove }) {
  const labelEl = el("span", { class: "room-attach-label", text: "" });
  const removeBtn = el("button", {
    class: "btn room-attach-remove",
    text: "[×]",
    title: "Remove",
    type: "button",
  });
  removeBtn.addEventListener("click", () => onRemove());
  const rootEl = el("div", { class: "room-attach-preview", hidden: true, dataset: { noDrag: "" } }, [
    removeBtn,
    labelEl,
  ]);

  function show({ filename, status, bytes, message }) {
    let text = filename || "attachment";
    if (status === "uploading") text += "  uploading…";
    else if (status === "ready" && bytes != null) text += `  ${fmtBytes(bytes)}`;
    else if (status === "error") text += `  ${message || "upload failed"}`;
    labelEl.textContent = text;
    rootEl.hidden = false;
    rootEl.classList.toggle("room-attach-preview--error", status === "error");
    removeBtn.disabled = status === "uploading";
  }

  function hide() {
    rootEl.hidden = true;
    labelEl.textContent = "";
    rootEl.classList.remove("room-attach-preview--error");
    removeBtn.disabled = false;
  }

  return { el: rootEl, show, hide };
}

// 첨부 메뉴 팝업. [+] 버튼 클릭 시 input row 위쪽에 작게 떠서 [img]/[gif] 두 항목을 보여 준다.
// 이모지/GIF picker 와 동일한 popup 패턴(absolute, 바깥 클릭·ESC 로 닫힘). 항목 클릭 → 메뉴 닫고 콜백.
function buildAttachMenu({ onPickImage, onPickGif }) {
  let visible = false;

  const imgItem = el("button", {
    class: "btn room-attach-menu-item",
    text: "[img]",
    title: "Attach image",
    type: "button",
  });
  const gifItem = el("button", {
    class: "btn room-attach-menu-item",
    text: "[gif]",
    title: "Find a GIF",
    type: "button",
  });
  imgItem.addEventListener("click", () => {
    hide();
    onPickImage();
  });
  gifItem.addEventListener("click", () => {
    hide();
    onPickGif();
  });

  const popupEl = el("div", { class: "room-attach-menu", hidden: true }, [imgItem, gifItem]);

  function show() {
    if (visible) return;
    visible = true;
    popupEl.hidden = false;
    document.addEventListener("mousedown", onDocMouseDown, true);
    document.addEventListener("keydown", onDocKeyDown, true);
  }

  function hide() {
    if (!visible) return;
    visible = false;
    popupEl.hidden = true;
    document.removeEventListener("mousedown", onDocMouseDown, true);
    document.removeEventListener("keydown", onDocKeyDown, true);
  }

  function toggle() {
    if (visible) hide();
    else show();
  }

  function onDocMouseDown(e) {
    if (popupEl.contains(e.target)) return;
    if (e.target.closest?.(".room-media-btn")) return; // 트리거 버튼은 자체 토글에 맡긴다
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
  }

  return { popupEl, toggle, hide, cleanup };
}

// Giphy GIF picker. 검색 입력 + 결과 그리드 + 하단 attribution.
// 이모지 picker 와 동일한 popup 패턴(absolute, input-row 위쪽). 셀 클릭 → onPick(gif) → picker 닫힘.
function buildGifPicker(onPick) {
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

  return { popupEl, toggle, hide, cleanup };
}

// 이미지 lightbox. 채팅 영역(.room)을 가득 채우는 overlay 로 큰 이미지를 보여준다.
// 닫기: ESC, 바깥(backdrop) 클릭, [X] 버튼 — 세 가지 모두 동작.
// data-kind 를 root 에 박아 CSS 가 업로드 이미지(image)에만 216색 팔레트 필터를 걸도록 한다.
function buildLightbox() {
  let visible = false;

  const imgEl = el("img", { class: "lightbox-image", alt: "" });
  const closeBtn = el("button", {
    class: "btn lightbox-close",
    text: "[X]",
    title: "Close",
    type: "button",
  });
  const rootEl = el("div", {
    class: "lightbox",
    hidden: true,
    dataset: { noDrag: "" },
  }, [imgEl, closeBtn]);

  function onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      hide();
    }
  }

  function show(src, { kind } = {}) {
    if (visible) return;
    visible = true;
    imgEl.src = src;
    rootEl.dataset.kind = kind || "";
    rootEl.hidden = false;
    // capture phase 로 등록 — emoji/gif picker 의 ESC 핸들러보다 먼저 받는다.
    document.addEventListener("keydown", onKey, true);
  }

  function hide() {
    if (!visible) return;
    visible = false;
    rootEl.hidden = true;
    imgEl.removeAttribute("src");
    rootEl.dataset.kind = "";
    document.removeEventListener("keydown", onKey, true);
  }

  closeBtn.addEventListener("click", hide);
  // backdrop 클릭은 닫기, 이미지/버튼 자체 클릭은 유지.
  rootEl.addEventListener("click", (e) => {
    if (e.target === rootEl) hide();
  });

  function cleanup() {
    if (visible) hide();
  }

  return { el: rootEl, show, hide, cleanup };
}

// 카오모지 picker 팝업. 단일 패널: 검색 input → 카테고리 sub-tab → 스크롤 grid.
// 셀 클릭은 input 의 캡쳐된 selectionStart/End 위치에 문자열을 끼워넣고 팝업을 닫는다.
// 팝업이 열리는 순간 selection 을 캡쳐 — 입력 도중 emoji 버튼을 눌러도 input 은 selectionStart 를
// blur 후에도 유지하기 때문에 마지막 커서 위치 보존이 안정적.
function buildEmojiPicker(input) {
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

// 스크롤 앵커: 리사이즈/재렌더 후에도 사용자가 보던 위치를 유지한다.
// 폰트 크기가 --computer-width(창 폭)에 비례하므로 리사이즈하면 메시지 높이가 변한다.
// scrollTop을 그대로 두면 같은 픽셀 오프셋이 다른 메시지를 보여주게 되어 시각적으로
// 위/아래로 미끄러져 보인다. 두 모드:
//   - 바닥 근처(stickToBottom): 새 메시지 도착/리사이즈 시 바닥에 재고정
//   - 그 외: viewport 최상단에 걸친 메시지 id를 anchor로 기록 → 재렌더/리사이즈 후
//           그 메시지의 viewport 내 동일 상대 위치(offset)로 scrollTop을 보정
// ※ 좌표 계산은 getBoundingClientRect로 한다. offsetTop은 offsetParent(.room) 기준이라
//   .room-list의 scroll 좌표계와 어긋나서 부정확하다.
function createScrollAnchor(list) {
  let stickToBottom = true;
  let anchorId = null;
  let anchorOffset = 0;
  function captureAnchor() {
    const distFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    stickToBottom = distFromBottom < NEAR_BOTTOM_PX;
    if (stickToBottom) {
      anchorId = null;
      return;
    }
    const listTop = list.getBoundingClientRect().top;
    for (const row of list.children) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > listTop + 1) {
        anchorId = row.dataset.id || null;
        anchorOffset = rect.top - listTop;
        return;
      }
    }
    anchorId = null;
  }
  function restoreScroll() {
    if (stickToBottom) {
      list.scrollTop = list.scrollHeight;
      return;
    }
    if (!anchorId) return;
    for (const row of list.children) {
      if (row.dataset.id === anchorId) {
        const listTop = list.getBoundingClientRect().top;
        const rowTop = row.getBoundingClientRect().top;
        list.scrollTop += rowTop - listTop - anchorOffset;
        return;
      }
    }
  }
  return { captureAnchor, restoreScroll };
}

// 메시지 본문을 텍스트/링크 노드 배열로 변환. URL은 클릭 시 기본 브라우저로 연다.
// el()이 textContent/자식 노드만 다루므로 innerHTML 없이 안전하게 링크를 삽입한다.
function renderMessageText(text) {
  return tokenizeMessage(text).map((tok) => {
    if (tok.type === "url") {
      return el("a", {
        class: "msg-link",
        href: tok.value,
        title: tok.value,
        onClick: (e) => {
          e.preventDefault();
          openExternal(tok.value);
        },
      }, [tok.value]);
    }
    return document.createTextNode(tok.value);
  });
}

// 메시지 한 줄을 DOM으로 변환. failed/mine 플래그로 클래스 결정.
// displayName: 각 메시지의 박제값(sender_nickname) 그대로 — 닉네임을 바꿔도 과거 메시지는 불변.
// 본인은 항상 "you" — 닉네임 변경 후에도 본인에게는 시각적 변화 없음.
// attachment 가 있으면 이미지가 캡션과 별 줄에 표시된다(flex-wrap). aspect-ratio 를 미리 박아
// 로딩 중에도 layout shift 가 없게 한다 — 스크롤 앵커가 깨지지 않는다.
function renderMessageRow(m) {
  const who = el("span", { class: "msg-who", text: m.mine ? "you" : (m.displayName || m.nickname) });
  const time = el("span", { class: "msg-time", text: fmtTime(m.ts) });
  const children = [who];
  if (m.attachment) {
    // data-kind 는 CSS 가 본인 업로드(image) 에만 retro-palette 필터를 걸기 위한 마커.
    // gif_external 은 원본 색 그대로 보존 — 외부 GIF 는 이미 작가 의도된 톤이라 그대로 둔다.
    const wrap = el("div", { class: "msg-image-wrap", dataset: { kind: m.attachment.kind || "" } });
    if (m.attachment.width && m.attachment.height) {
      wrap.style.aspectRatio = `${m.attachment.width} / ${m.attachment.height}`;
    }
    const img = el("img", {
      class: "msg-image",
      src: m.attachment.url,
      alt: "",
      loading: "lazy",
    });
    img.addEventListener("error", () => {
      wrap.replaceChildren(el("span", { class: "msg-image-broken", text: "[ × broken ]" }));
    });
    wrap.append(img);
    children.push(wrap);
  }
  if (m.text) {
    children.push(el("span", { class: "msg-text" }, renderMessageText(m.text)));
  }
  children.push(time);
  let cls = "msg";
  if (m.attachment) cls += " has-attach";
  if (m.mine) cls += " mine";
  if (m.failed) cls += " failed";
  return el("div", { class: cls, dataset: { id: m.id }, title: m.failed ? "send failed" : null }, children);
}

// 날짜 구분선 한 줄. dataset.id 를 "date-<yyyy-mm-dd>" 로 박아 스크롤 앵커(dataset.id 기준)에 자연스럽게
// 잡히게 하고, 메시지 UUID 와 충돌하지 않게 한다. 좌우 hairline 은 CSS ::before/::after 가 그린다.
function renderDateDivider(dateStr) {
  return el("div", { class: "msg-date-divider", dataset: { id: "date-" + dateStr } }, [
    el("span", { class: "msg-date-divider-text", text: dateStr }),
  ]);
}

export const roomView = {
  _code: null,
  _cleanup: null,

  async mount(screenEl, params, ctx) {
    const code = params.code;
    const clientId = getClientId();
    const myToken = ++mountToken;

    // 안전망: 닉네임 없이 직접 진입한 경우(라우터 직접 호출 등) nickname으로 우회.
    // 여기서는 존재 여부만 본다 — 실제 표시값은 openRoom 의 양방향 sync 가 끝난 후 다시 읽는다.
    if (!getRoomNickname(code)) {
      ctx.navigate("nickname", { code });
      return;
    }

    // 로딩 중 화면(history fetch 동안 표시).
    const loading = el("div", { class: "form-label", text: "loading history…" });
    screenEl.append(el("div", { class: "room" }, [loading]));

    let entry;
    try {
      entry = await openRoom(code);
    } catch (e) {
      console.error("openRoom failed:", e);
      if (mountToken === myToken) ctx.navigate("lobby");
      return;
    }
    // mount 도중 사용자가 다른 화면으로 이동 → 정리하고 종료.
    if (mountToken !== myToken) {
      closeRoom(code);
      return;
    }
    this._code = code;
    saveRoom(code);
    const { transport, store, userId, backfill } = entry;

    // openRoom 의 "로컬·서버 다름 → 서버 우선" 분기가 localStorage 를 갱신했을 수 있다.
    // 다른 기기에서 닉네임을 바꾸고 이 기기에서 재입장한 케이스에 새 이름으로 헤더가 떠야 한다.
    const nickname = getRoomNickname(code);

    // --- DOM 구성 ---
    screenEl.replaceChildren();
    const nicknameEditor = buildNickEditor(
      () => getRoomNickname(code),
      (newNick) => changeRoomNickname(code, newNick),
    );
    const { headerEl, statusEl } = buildHeader(code, {
      onLeave: () => ctx.navigate("lobby"),
      nicknameEditor,
    });
    const list = el("div", { class: "room-list", dataset: { noDrag: "" } });
    const showGif = isGiphyConfigured();
    const { inputRowEl, emojiBtn, mediaBtn, fileInput, input, sendBtn } = buildInputRow({ showGif });
    // emoji picker 팝업은 input row 의 자식으로 append — input row 의 position: relative 가 앵커.
    const picker = buildEmojiPicker(input);
    inputRowEl.append(picker.popupEl);
    emojiBtn.addEventListener("click", () => {
      if (emojiBtn.disabled) return;
      picker.toggle();
    });

    // --- 첨부/GIF 상태 ---
    // 한 번에 하나의 첨부만 허용 — 업로드 완료 후 SEND 까지 보류한다. SEND 또는 [×] 로 해제.
    let pendingAttachment = null;
    // 미리보기에 보여 줄 첨부 라벨(파일명 또는 GIF 제목). 전송 실패 시 첨부 미리보기 복원에 쓴다.
    let pendingAttachmentLabel = "";
    // 업로드가 진행 중인 동안(아직 pendingAttachment 가 비어 있는 구간) [+] 버튼을 잠그는 플래그.
    // 이게 없으면 업로드 도중 고른 GIF 의 staging 이 업로드 완료 시점에 조용히 덮어써진다.
    let uploading = false;
    const attachPreview = buildAttachPreview({
      onRemove: () => {
        pendingAttachment = null;
        pendingAttachmentLabel = "";
        fileInput.value = "";
        attachPreview.hide();
        syncMediaBtn();
      },
    });
    // 첨부([+]) 버튼은 연결 전·첨부 보류 중·업로드 중에는 비활성 — 그 사이 메뉴를 못 열게 한다.
    function syncMediaBtn() {
      mediaBtn.disabled = connState !== "connected" || !!pendingAttachment || uploading;
    }

    // GIF picker·첨부 메뉴는 Giphy 키가 있을 때(showGif)만 만든다.
    // GIF 셀 클릭 → 즉시 전송하지 않고 첨부로 스테이징(이미지 첨부와 동일 흐름). 텍스트와 함께 SEND 로 보낸다.
    function onGifPick(gif) {
      // 한 번에 하나만 — 이미 첨부가 있거나 업로드 중이면 무시한다(파일 첨부 경로와 동일 정책).
      // 평소엔 syncMediaBtn 가 이 상태에서 [+] 버튼을 잠그지만, 만약을 위한 방어 가드.
      if (pendingAttachment || uploading) return;
      // 외부(Giphy) GIF 는 업로드가 없어 바로 ready.
      pendingAttachment = {
        url: gif.gifUrl,
        kind: "gif_external",
        mime: "image/gif",
        width: gif.gifW,
        height: gif.gifH,
        bytes: gif.gifBytes,
      };
      fileInput.value = "";
      const label = gif.title && gif.title.trim() ? gif.title.trim() : "GIF";
      pendingAttachmentLabel = label;
      attachPreview.show({ filename: label, status: "ready", bytes: gif.gifBytes });
      syncMediaBtn();
      input.focus();
    }
    // [img] 선택 → 파일 선택창, [gif] 선택 → Giphy picker. 메뉴는 항목 클릭 시 스스로 닫힌다.
    const gifPicker = showGif ? buildGifPicker(onGifPick) : null;
    const attachMenu = showGif
      ? buildAttachMenu({
          onPickImage: () => {
            if (!pendingAttachment) fileInput.click();
          },
          onPickGif: () => gifPicker.show(),
        })
      : null;
    if (gifPicker) inputRowEl.append(gifPicker.popupEl);
    if (attachMenu) inputRowEl.append(attachMenu.popupEl);

    // lightbox 는 .room 의 마지막 자식으로 → position: absolute + inset: 0 으로 자연스럽게 채움.
    const lightbox = buildLightbox();
    screenEl.append(el("div", { class: "room" }, [headerEl, list, attachPreview.el, inputRowEl, lightbox.el]));

    // 메시지 리스트의 이미지 클릭을 위임 처리 — 메시지마다 핸들러를 달지 않는다.
    // broken 폴백(span)이나 다른 영역 클릭은 .msg-image 매칭이 안 돼 자연스럽게 무시.
    list.addEventListener("click", (e) => {
      const img = e.target.closest?.(".msg-image");
      if (!img) return;
      const wrap = img.closest(".msg-image-wrap");
      lightbox.show(img.src, { kind: wrap?.dataset.kind || "" });
    });

    // [+] 클릭: 첨부 메뉴([img]/[gif]) 토글. Giphy 키가 없으면(showGif=false) 메뉴 없이 곧장 파일 선택.
    // 업로드 중에는 mount 가 갈아끼워질 수 있어 mountToken 가드로 늦은 setState 를 차단.
    mediaBtn.addEventListener("click", () => {
      if (mediaBtn.disabled) return;
      if (pendingAttachment) return; // 한 번에 하나만 — 기존 첨부 제거 후 다시 클릭해야 한다.
      if (attachMenu) attachMenu.toggle();
      else fileInput.click();
    });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      if (pendingAttachment || uploading) return;
      const filename = file.name;
      uploading = true;
      attachPreview.show({ filename, status: "uploading" });
      // 업로드 중에는 [+] 버튼을 잠근다 — 그 사이 메뉴로 GIF 를 골라도 staging 이 덮어써지지 않도록.
      syncMediaBtn();
      try {
        const att = await uploadAttachment(file, code);
        if (mountToken !== myToken) return;
        pendingAttachment = att;
        pendingAttachmentLabel = filename;
        attachPreview.show({ filename, status: "ready", bytes: att.bytes });
      } catch (e) {
        console.error("upload failed:", e);
        if (mountToken === myToken) {
          attachPreview.show({ filename, status: "error", message: e.message });
        }
      } finally {
        uploading = false;
        if (mountToken === myToken) {
          syncMediaBtn();
        }
        fileInput.value = "";
      }
    });

    // --- 상태 렌더링: 연결 상태 + 온라인 인원 ---
    let connState = "connecting";
    let onlineCount = null;
    function renderStatus() {
      statusEl.classList.toggle("room-status--error", connState === "error");
      if (connState === "connected") {
        statusEl.textContent = onlineCount != null ? `● ${onlineCount} online` : STATUS_TEXT.connected;
      } else {
        statusEl.textContent = STATUS_TEXT[connState] || connState;
      }
    }

    // --- 스크롤 앵커 + 메시지 렌더링 ---
    const { captureAnchor, restoreScroll } = createScrollAnchor(list);
    list.addEventListener("scroll", captureAnchor, { passive: true });
    const unsubStore = store.subscribe((messages) => {
      // 날짜가 바뀌는 첫 메시지 앞에 yyyy-mm-dd 구분선을 끼워 넣는다(로컬 시간대 기준).
      const rows = withDateDividers(messages);
      list.replaceChildren(
        ...rows.map((item) => (item.divider ? renderDateDivider(item.date) : renderMessageRow(item))),
      );
      restoreScroll();
    });
    const ro = new ResizeObserver(restoreScroll);
    ro.observe(list);
    // ResizeObserver 백업: Tauri 그립 드래그 시 .room-list 박스 변동이 한 박자 늦거나
    // 누락되는 경우를 대비해 window resize에도 보정한다.
    window.addEventListener("resize", restoreScroll);

    // --- backfill: 재연결/visibility 복귀 시 그동안 놓친 메시지를 보충 ---
    // backfill 인스턴스는 openRoom 에서 미리 만들어져 entry 에 들어 있다(테스트 가능성/단일 책임).

    // --- transport 이벤트 wiring ---
    // 첫 connected는 openRoom의 seed가 이미 처리했으므로 backfill 생략. 이후 재진입(재연결)에서만 호출.
    let hadConnectedOnce = false;
    const unsubStatus = transport.on("status", ({ state }) => {
      connState = state;
      const ok = state === "connected";
      // 송신만 게이팅 — input/emoji picker 는 local 동작이므로 disconnect 중에도
      // 메시지 작성/카오모지 삽입을 허용해 재연결 대기 시간을 가릴 수 있게 한다.
      // 첨부([+])는 외부 호출(업로드/Giphy)이라 연결 상태와 함께 토글한다.
      sendBtn.disabled = !ok;
      syncMediaBtn();
      renderStatus();
      if (ok) {
        if (hadConnectedOnce) backfill();
        hadConnectedOnce = true;
      }
    });
    // realtime 채널이 자신의 죽음을 모르는 경우 보강: 탭/창이 다시 보이게 되면 즉시 갭필.
    const onVisibility = () => {
      if (document.visibilityState === "visible") backfill();
    };
    document.addEventListener("visibilitychange", onVisibility);
    const unsubPres = transport.on("presence", ({ count }) => {
      onlineCount = count;
      renderStatus();
    });

    // --- 송신: DB INSERT 하나로 보내고, postgres_changes echo가 자기 자신에게도 돌아옴.
    // 즉시 응답을 위해 낙관적 add도 함께 한다(중복은 store의 id dedup이 처리).
    async function doSend() {
      // disconnect 중에도 input 은 enabled 라 Enter 키가 그대로 들어옴 — sendBtn 게이트와
      // 동일하게 막아 transport.send 가 실패→failed 메시지로 박히는 것을 방지.
      if (sendBtn.disabled) return;
      const text = input.value.trim();
      // text 와 첨부 중 적어도 하나는 있어야 한다 — DB check constraint 와 동일 정책.
      if (!text && !pendingAttachment) return;
      // send 시점에 라이브로 다시 읽는다 — [✎]로 닉네임을 바꾼 직후 보낸 메시지는
      // 새 이름으로 박제되어야 한다(snapshot fallback 도 새 이름으로 남음).
      const liveNick = getRoomNickname(code) || nickname;
      const msg = { id: crypto.randomUUID(), clientId, senderUid: userId, nickname: liveNick, text, ts: Date.now() };
      if (pendingAttachment) msg.attachment = pendingAttachment;
      // 전송 실패 시 되돌리기 위해 비우기 전에 보관해 둔다.
      const prevText = input.value;
      const prevAttachment = pendingAttachment;
      const prevLabel = pendingAttachmentLabel;
      input.value = "";
      // 첨부는 한 번 박은 후 즉시 비움 — 다음 메시지는 빈 상태에서 시작.
      if (pendingAttachment) {
        pendingAttachment = null;
        pendingAttachmentLabel = "";
        attachPreview.hide();
        syncMediaBtn();
      }
      store.add(msg);
      try {
        await transport.send(msg);
      } catch (e) {
        console.error("send failed:", e);
        // 실패해도 메시지는 그대로 두되, failed 플래그로 시각적 피드백을 준다(사용자가 재전송 결정).
        store.update(msg.id, { failed: true });
        // 비워 둔 입력/첨부를 되돌려 곧바로 다시 보낼 수 있게 한다.
        // 단 그 사이 사용자가 새 입력/첨부를 시작했다면 덮어쓰지 않는다.
        if (prevText && !input.value.trim()) input.value = prevText;
        if (prevAttachment && !pendingAttachment) {
          pendingAttachment = prevAttachment;
          pendingAttachmentLabel = prevLabel;
          attachPreview.show({ filename: prevLabel || "attachment", status: "ready", bytes: prevAttachment.bytes });
          syncMediaBtn();
        }
      }
    }
    sendBtn.addEventListener("click", doSend);
    input.addEventListener("keydown", (e) => {
      playKey(); // 레트로 일관성: 채팅 입력도 키사운드 재생
      // IME composition 중 Enter 는 commit 키 → 무시. Chromium webview(WebView2/Chrome)에서
      // 한글 마지막 글자가 두 번 전송되는 버그 방지. WebKit(Safari/macOS WKWebView)에서는
      // 어차피 composing 중 keydown 이 안 와 변화 없음.
      if (e.key === "Enter" && !e.isComposing) {
        e.preventDefault();
        doSend();
      }
    });

    transport
      .connect(code, { nickname, clientId })
      .then(() => setTimeout(() => input.focus(), 0))
      .catch((e) => {
        console.error("connect failed:", e);
        // status 구독이 "CHANNEL_ERROR" 등을 받지 못한 경로(예: connect 자체가 reject)
        // 에서도 동일한 에러 상태로 수렴하도록 명시적으로 갱신.
        connState = "error";
        sendBtn.disabled = true;
        renderStatus();
      });

    this._cleanup = () => {
      picker.cleanup();
      if (attachMenu) attachMenu.cleanup();
      if (gifPicker) gifPicker.cleanup();
      lightbox.cleanup();
      unsubStore();
      unsubStatus();
      unsubPres();
      list.removeEventListener("scroll", captureAnchor);
      ro.disconnect();
      window.removeEventListener("resize", restoreScroll);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  },

  unmount() {
    // 토큰을 한 번 더 굴려 진행 중이던 mount 가 myToken 비교에서 자동으로 빠지게 한다.
    mountToken++;
    if (this._cleanup) this._cleanup();
    this._cleanup = null;
    if (this._code) closeRoom(this._code);
    this._code = null;
  },
};
