// 채팅방: 메시지 목록 + 입력 + 전송 + 나가기. 연결 상태/온라인 인원 표시.
// 영속 메시지는 Postgres에서 history fetch → store.seed. 새 메시지는 postgres_changes echo.
// 송신은 transport.send (DB INSERT) → echo로 자기 자신에게도 돌아오지만 store의 id dedup이 처리.
import { el } from "../core/dom.js";
import { playKey } from "../platform/sound.js";
import { getRoomNickname, getClientId, openRoom, closeRoom, saveRoom } from "../chat/session.js";
import { getCurrentUserId } from "../auth/auth.js";

const STATUS_TEXT = {
  connecting: "connecting…",
  connected: "● online",
  reconnecting: "reconnecting…",
  closed: "offline",
  error: "error",
};

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const roomView = {
  _code: null,
  _cleanup: null,

  async mount(screenEl, params, ctx) {
    const code = params.code;
    const nickname = getRoomNickname(code);
    const clientId = getClientId();
    this._cancelled = false;
    // await 직전에 _cancelled 초기화 → await 중 unmount가 true로 세팅하면 아래 가드에서 빠진다.
    const userId = await getCurrentUserId();
    if (this._cancelled) return;

    // 안전망: 닉네임 없이 직접 진입한 경우(라우터 직접 호출 등) nickname으로 우회.
    if (!nickname) {
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
      if (!this._cancelled) ctx.navigate("lobby");
      return;
    }
    // mount 도중 사용자가 다른 화면으로 이동 → 정리하고 종료.
    if (this._cancelled) {
      closeRoom(code);
      return;
    }
    this._code = code;
    saveRoom(code);
    const { transport, store } = entry;
    store.start();

    // 본격 마운트 — 로딩 화면을 교체.
    screenEl.replaceChildren();

    // --- header ---
    const codeLabel = el("span", { class: "room-code", text: code });
    const copyBtn = el("button", { class: "btn room-copy", title: "Copy code", text: "[copy]" });
    copyBtn.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(code);
        copyBtn.textContent = "[copied]";
        setTimeout(() => (copyBtn.textContent = "[copy]"), 1200);
      } catch (e) {
        console.error("copy failed:", e);
      }
    });
    const status = el("span", { class: "room-status", text: STATUS_TEXT.connecting });
    const leaveBtn = el("button", {
      class: "btn room-leave",
      title: "Leave",
      text: "[X]",
      onClick: () => ctx.navigate("lobby"),
    });
    const header = el("div", { class: "room-header" }, [codeLabel, copyBtn, status, leaveBtn]);

    // --- message list ---
    const list = el("div", { class: "room-list", dataset: { noDrag: "" } });

    // --- input row ---
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
    const inputRow = el("div", { class: "room-input-row", dataset: { noDrag: "" } }, [input, sendBtn]);

    screenEl.append(el("div", { class: "room" }, [header, list, inputRow]));

    // --- status rendering (combines connection state + online count) ---
    let connState = "connecting";
    let onlineCount = null;
    function renderStatus() {
      if (connState === "connected") {
        status.textContent = onlineCount != null ? `● ${onlineCount} online` : STATUS_TEXT.connected;
      } else {
        status.textContent = STATUS_TEXT[connState] || connState;
      }
    }

    // --- render messages ---
    // 폰트 크기가 --computer-width(창 폭)에 비례하므로 리사이즈하면 메시지 줄바꿈/높이가
    // 바뀌어 scrollTop이 그대로면 시각적으로 위로 미끄러져 보인다. 사용자가 바닥 근처에서
    // 읽고 있었는지를 스크롤 이벤트로 유지하고, 메시지 갱신 + 컨테이너 리사이즈 양쪽에서 재고정.
    let stickToBottom = true;
    function isNearBottom() {
      return list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    }
    const onScroll = () => {
      stickToBottom = isNearBottom();
    };
    list.addEventListener("scroll", onScroll, { passive: true });
    const unsubStore = store.subscribe((messages) => {
      list.replaceChildren();
      for (const m of messages) {
        const who = el("span", { class: "msg-who", text: m.mine ? "you" : m.nickname });
        const text = el("span", { class: "msg-text", text: m.text });
        const time = el("span", { class: "msg-time", text: fmtTime(m.ts) });
        list.append(el("div", { class: "msg" + (m.mine ? " mine" : "") }, [who, text, time]));
      }
      if (stickToBottom) list.scrollTop = list.scrollHeight;
    });
    const ro = new ResizeObserver(() => {
      if (stickToBottom) list.scrollTop = list.scrollHeight;
    });
    ro.observe(list);

    // --- transport events ---
    const unsubStatus = transport.on("status", ({ state }) => {
      connState = state;
      const ok = state === "connected";
      sendBtn.disabled = !ok;
      input.disabled = !ok;
      renderStatus();
    });
    const unsubPres = transport.on("presence", ({ count }) => {
      onlineCount = count;
      renderStatus();
    });

    // --- send: DB INSERT 하나로 보내고, postgres_changes echo가 자기 자신에게도 돌아옴.
    // 즉시 응답을 위해 낙관적 add도 함께 한다(중복은 store의 id dedup이 처리).
    async function doSend() {
      const text = input.value.trim();
      if (!text) return;
      const msg = { id: crypto.randomUUID(), clientId, senderUid: userId, nickname, text, ts: Date.now() };
      input.value = "";
      store.add(msg); // 낙관적 로컬 렌더
      try {
        await transport.send(msg);
      } catch (e) {
        console.error("send failed:", e);
        // 실패해도 낙관적으로 표시된 메시지는 그대로 둔다(사용자가 재전송 결정).
      }
    }
    sendBtn.addEventListener("click", doSend);
    input.addEventListener("keydown", (e) => {
      playKey(); // 레트로 일관성: 채팅 입력도 키사운드 재생
      if (e.key === "Enter") {
        e.preventDefault();
        doSend();
      }
    });

    transport
      .connect(code, { nickname, clientId })
      .then(() => setTimeout(() => input.focus(), 0))
      .catch((e) => {
        connState = "error";
        status.textContent = "connection failed";
        console.error("connect failed:", e);
      });

    this._cleanup = () => {
      unsubStore();
      unsubStatus();
      unsubPres();
      list.removeEventListener("scroll", onScroll);
      ro.disconnect();
    };
  },

  unmount() {
    this._cancelled = true;
    if (this._cleanup) this._cleanup();
    this._cleanup = null;
    if (this._code) closeRoom(this._code);
    this._code = null;
  },
};
