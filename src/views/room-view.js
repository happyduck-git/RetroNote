// 채팅방: 메시지 목록 + 입력 + 전송 + 나가기. 연결 상태/온라인 인원 표시.
// 입장 이후 메시지만 수신(broadcast 비저장). 본인 메시지는 낙관적으로 즉시 렌더.
import { el } from "../core/dom.js";
import { playKey } from "../platform/sound.js";
import { getNickname, getClientId, openRoom, closeRoom, saveRoom } from "../chat/session.js";

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

  mount(screenEl, params, ctx) {
    const code = params.code;
    this._code = code;
    const nickname = getNickname();
    const clientId = getClientId();

    let entry;
    try {
      entry = openRoom(code);
    } catch {
      ctx.navigate("lobby");
      return;
    }
    saveRoom(code);
    const { transport, store } = entry;
    store.start();

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
    function isNearBottom() {
      return list.scrollHeight - list.scrollTop - list.clientHeight < 40;
    }
    const unsubStore = store.subscribe((messages) => {
      const stick = isNearBottom();
      list.replaceChildren();
      for (const m of messages) {
        const who = el("span", { class: "msg-who", text: m.mine ? "you" : m.nickname });
        const text = el("span", { class: "msg-text", text: m.text });
        const time = el("span", { class: "msg-time", text: fmtTime(m.ts) });
        list.append(el("div", { class: "msg" + (m.mine ? " mine" : "") }, [who, text, time]));
      }
      if (stick) list.scrollTop = list.scrollHeight;
    });

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

    // --- send ---
    function doSend() {
      const text = input.value.trim();
      if (!text) return;
      const msg = { id: crypto.randomUUID(), clientId, nickname, text, ts: Date.now() };
      input.value = "";
      store.add(msg); // 낙관적 로컬 렌더 (self:false라 에코 없음)
      transport.send(msg).catch((e) => console.error("send failed:", e));
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
    };
  },

  unmount() {
    if (this._cleanup) this._cleanup();
    this._cleanup = null;
    if (this._code) closeRoom(this._code);
    this._code = null;
  },
};
