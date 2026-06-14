// 채팅방: 메시지 목록 + 입력 + 전송 + 나가기. 연결 상태/온라인 인원 표시.
// 영속 메시지는 Postgres에서 history fetch → store.seed. 새 메시지는 postgres_changes echo.
// 송신은 transport.send (DB INSERT) → echo로 자기 자신에게도 돌아오지만 store의 id dedup이 처리.
import { el } from "../core/dom.js";
import { playKey } from "../platform/sound.js";
import { getRoomNickname, getClientId, openRoom, closeRoom, saveRoom, changeRoomNickname } from "../chat/session.js";
import { getCurrentUserId } from "../auth/auth.js";
import { fetchMessages } from "../chat/message-history.js";
import { createBackfiller } from "../chat/backfill.js";

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
    const { transport, store, firstJoinedAt } = entry;
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

    // 본인 닉네임 라벨 + [✎] 인라인 에디터. alias 편집과 동일한 commit/cancel 패턴.
    // 현재 닉네임은 라이브로 다시 읽어 표시 — changeRoomNickname 직후 setRoomNickname 갱신본이 반영됨.
    const nickLabel = el("span", { class: "room-nick", text: nickname });
    const nickAs = el("span", { class: "room-nick-as", text: "as:" });
    const nickEditBtn = el("button", {
      class: "btn room-nick-edit",
      title: "Edit nickname",
      text: "[✎]",
    });
    const nickWrap = el("span", { class: "room-nick-wrap" }, [nickAs, nickLabel, nickEditBtn]);

    nickEditBtn.addEventListener("click", () => {
      playKey();
      startNickEdit();
    });

    function startNickEdit() {
      if (!nickLabel.isConnected) return;
      const currentNick = getRoomNickname(code) || nickLabel.textContent;
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
        // 현재 활성 닉네임을 다시 읽어 표시 — commit 성공 시는 새 값, cancel 또는 실패면 기존 값.
        nickLabel.textContent = next;
        input.replaceWith(nickLabel);
      };
      const commit = async () => {
        const v = input.value.trim();
        const currentLive = getRoomNickname(code);
        if (!v) {
          // 빈 값 거절: shake + 포커스 유지(취소가 아님).
          input.classList.add("invalid");
          input.focus();
          input.select();
          setTimeout(() => input.classList.remove("invalid"), 400);
          return;
        }
        if (v.length > NICK_MAX) {
          // maxlength 가 막아주지만 안전망.
          input.classList.add("invalid");
          setTimeout(() => input.classList.remove("invalid"), 400);
          return;
        }
        if (v === currentLive) {
          finish(currentLive);
          return;
        }
        try {
          await changeRoomNickname(code, v);
          finish(v);
        } catch (e) {
          console.error("changeRoomNickname failed:", e);
          // 실패 시 기존 표시값 유지.
          finish(currentLive || currentNick);
        }
      };
      const cancel = () => finish(getRoomNickname(code) || currentNick);

      input.addEventListener("keydown", (e) => {
        playKey();
        // IME composition 중 Enter(Chromium 계열 webview 에서 keydown 발화)는 IME 의 commit
        // 키이므로 무시. 한글/일본어/중국어 입력 시 마지막 글자가 두 번 전송되는 버그 방지.
        if (e.key === "Enter" && !e.isComposing) {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          cancel();
        }
      });
      input.addEventListener("blur", () => {
        // blur 는 commit 으로 처리 — alias 편집과 동일 패턴. 실패하면 finish 가 기존 값 복원.
        commit();
      });

      nickLabel.replaceWith(input);
      input.focus();
      input.select();
    }

    const status = el("span", { class: "room-status", text: STATUS_TEXT.connecting });
    const leaveBtn = el("button", {
      class: "btn room-leave",
      title: "Leave",
      text: "[X]",
      onClick: () => ctx.navigate("lobby"),
    });
    const header = el("div", { class: "room-header" }, [codeLabel, copyBtn, nickWrap, status, leaveBtn]);

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
    // 폰트 크기가 --computer-width(창 폭)에 비례하므로 리사이즈하면 메시지 높이가 변한다.
    // scrollTop을 그대로 두면 같은 픽셀 오프셋이 다른 메시지를 보여주게 되어 시각적으로
    // 위/아래로 미끄러져 보인다. 두 모드로 보정:
    //   - 바닥 근처(stickToBottom): 새 메시지 도착/리사이즈 시 바닥에 재고정
    //   - 그 외: viewport 최상단에 걸친 메시지 id를 anchor로 기록 → 재렌더/리사이즈 후
    //           그 메시지의 viewport 내 동일 상대 위치(offset)로 scrollTop을 보정
    // ※ 좌표 계산은 getBoundingClientRect로 한다. offsetTop은 offsetParent(.room) 기준이라
    //   .room-list의 scroll 좌표계와 어긋나서 부정확하다.
    const NEAR_BOTTOM_PX = 40;
    let stickToBottom = true;
    let anchorId = null;
    let anchorOffset = 0; // viewport-top 기준 anchor의 상대 y(px)
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
    list.addEventListener("scroll", captureAnchor, { passive: true });
    const unsubStore = store.subscribe((messages) => {
      list.replaceChildren();
      for (const m of messages) {
        // displayName: nicknameMap(라이브 현재 이름) > sender_nickname snapshot(떠난 멤버 폴백).
        // 본인은 항상 "you" — 닉네임 변경 후에도 본인에게는 시각적 변화 없음.
        const who = el("span", { class: "msg-who", text: m.mine ? "you" : (m.displayName || m.nickname) });
        const text = el("span", { class: "msg-text", text: m.text });
        const time = el("span", { class: "msg-time", text: fmtTime(m.ts) });
        list.append(
          el("div", { class: "msg" + (m.mine ? " mine" : ""), dataset: { id: m.id } }, [who, text, time]),
        );
      }
      restoreScroll();
    });
    const ro = new ResizeObserver(restoreScroll);
    ro.observe(list);
    // ResizeObserver 백업: Tauri 그립 드래그 시 .room-list 박스 변동이 한 박자 늦거나
    // 누락되는 경우를 대비해 window resize에도 보정한다.
    const onWindowResize = () => restoreScroll();
    window.addEventListener("resize", onWindowResize);

    // backfill: 재연결/visibility 복귀 시 그동안 놓친 메시지를 보충 (자세한 동작은 backfill.js 참조).
    const backfill = createBackfiller({ store, fetchMessages, firstJoinedAt, code });

    // --- transport events ---
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

    // --- send: DB INSERT 하나로 보내고, postgres_changes echo가 자기 자신에게도 돌아옴.
    // 즉시 응답을 위해 낙관적 add도 함께 한다(중복은 store의 id dedup이 처리).
    async function doSend() {
      const text = input.value.trim();
      if (!text) return;
      // send 시점에 라이브로 다시 읽는다 — [✎]로 닉네임을 바꾼 직후 보낸 메시지는
      // 새 이름으로 박제되어야 한다(snapshot fallback 도 새 이름으로 남음).
      const liveNick = getRoomNickname(code) || nickname;
      const msg = { id: crypto.randomUUID(), clientId, senderUid: userId, nickname: liveNick, text, ts: Date.now() };
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
        connState = "error";
        status.textContent = "connection failed";
        console.error("connect failed:", e);
      });

    this._cleanup = () => {
      unsubStore();
      unsubStatus();
      unsubPres();
      list.removeEventListener("scroll", captureAnchor);
      ro.disconnect();
      window.removeEventListener("resize", onWindowResize);
      document.removeEventListener("visibilitychange", onVisibility);
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
