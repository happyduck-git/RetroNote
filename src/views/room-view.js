// 채팅방: 메시지 목록 + 입력 + 전송 + 나가기. 연결 상태/온라인 인원 표시.
// 영속 메시지는 Postgres에서 history fetch → store.seed. 새 메시지는 postgres_changes echo.
// 송신은 transport.send (DB INSERT) → echo로 자기 자신에게도 돌아오지만 store의 id dedup이 처리.
import { el, pad2 } from "../core/dom.js";
import { playKey } from "../platform/sound.js";
import { getRoomNickname, getClientId, openRoom, closeRoom, saveRoom, changeRoomNickname } from "../chat/session.js";

const COPY_FEEDBACK_MS = 1200;
const NEAR_BOTTOM_PX = 40;

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

// 입력행: 메시지 input + 전송 버튼. 초기 상태는 비활성(연결 후 활성).
function buildInputRow() {
  const input = el("input", {
    class: "field room-input",
    type: "text",
    maxlength: "500",
    placeholder: "message…",
    spellcheck: "false",
    autocomplete: "off",
    disabled: true,
    dataset: { noDrag: "" },
  });
  const sendBtn = el("button", { class: "btn room-send", text: "[ SEND ]", disabled: true });
  const inputRowEl = el("div", { class: "room-input-row", dataset: { noDrag: "" } }, [input, sendBtn]);
  return { inputRowEl, input, sendBtn };
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

// 메시지 한 줄을 DOM으로 변환. failed/mine 플래그로 클래스 결정.
// displayName: nicknameMap(라이브 현재 이름) > sender_nickname snapshot(떠난 멤버 폴백).
// 본인은 항상 "you" — 닉네임 변경 후에도 본인에게는 시각적 변화 없음.
function renderMessageRow(m) {
  const who = el("span", { class: "msg-who", text: m.mine ? "you" : (m.displayName || m.nickname) });
  const text = el("span", { class: "msg-text", text: m.text });
  const time = el("span", { class: "msg-time", text: fmtTime(m.ts) });
  let cls = "msg";
  if (m.mine) cls += " mine";
  if (m.failed) cls += " failed";
  return el("div", { class: cls, dataset: { id: m.id }, title: m.failed ? "send failed" : null }, [who, text, time]);
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
    const { inputRowEl, input, sendBtn } = buildInputRow();
    screenEl.append(el("div", { class: "room" }, [headerEl, list, inputRowEl]));

    // --- 상태 렌더링: 연결 상태 + 온라인 인원 ---
    let connState = "connecting";
    let onlineCount = null;
    function renderStatus() {
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
      list.replaceChildren(...messages.map(renderMessageRow));
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
      sendBtn.disabled = !ok;
      input.disabled = !ok;
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
      const text = input.value.trim();
      if (!text) return;
      // send 시점에 라이브로 다시 읽는다 — [✎]로 닉네임을 바꾼 직후 보낸 메시지는
      // 새 이름으로 박제되어야 한다(snapshot fallback 도 새 이름으로 남음).
      const liveNick = getRoomNickname(code) || nickname;
      const msg = { id: crypto.randomUUID(), clientId, senderUid: userId, nickname: liveNick, text, ts: Date.now() };
      input.value = "";
      store.add(msg);
      try {
        await transport.send(msg);
      } catch (e) {
        console.error("send failed:", e);
        // 실패해도 메시지는 그대로 두되, failed 플래그로 시각적 피드백을 준다(사용자가 재전송 결정).
        store.update(msg.id, { failed: true });
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
        input.disabled = true;
        renderStatus();
      });

    this._cleanup = () => {
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
