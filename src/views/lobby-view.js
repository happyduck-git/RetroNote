// 로비: 방 생성(코드 발급) 또는 코드로 입장 + 최근 방 목록.
import { el, onEnter } from "../core/dom.js";
import { confirmDialog, alertDialog } from "../core/confirm.js";
import { playKey } from "../platform/sound.js";
import { generate6, isValid, normalize, CODE_LENGTH } from "../chat/room-code.js";
import { getSavedRooms, setRoomAlias, removeSavedRoom, canAddRoom, MAX_SAVED_ROOMS, getRoomNickname, syncRoomsFromServer } from "../chat/session.js";
import { messageNotifier } from "../chat/message-notifier.js";

// 방에 들어가기 직전 닉네임 게이트: 방별 닉네임이 없으면 nickname 뷰로, 있으면 바로 room으로.
function enterRoom(ctx, code) {
  if (getRoomNickname(code)) ctx.navigate("room", { code });
  else ctx.navigate("nickname", { code });
}

export const lobbyView = {
  mount(screenEl, params, ctx) {
    const createBtn = el("button", {
      class: "btn lobby-btn",
      text: "[ CREATE ROOM ]",
      onClick: () => {
        // CREATE는 항상 새 코드 → saved 목록 길이만 체크.
        if (getSavedRooms().length >= MAX_SAVED_ROOMS) {
          alertDialog(`Max ${MAX_SAVED_ROOMS} chat rooms reached.\nDelete one before creating a new room.`);
          return;
        }
        enterRoom(ctx, generate6());
      },
    });
    const sep = el("div", { class: "lobby-sep", text: "— or —" });
    const input = el("input", {
      class: "field",
      type: "text",
      maxlength: String(CODE_LENGTH),
      placeholder: "CODE",
      spellcheck: "false",
      autocomplete: "off",
      dataset: { noDrag: "" },
    });
    const joinBtn = el("button", { class: "btn lobby-btn", text: "[ JOIN ]" });
    const err = el("div", { class: "form-error" });

    function join() {
      const code = normalize(input.value);
      if (!isValid(code)) {
        err.textContent = "invalid code";
        input.focus();
        return;
      }
      // 이미 saved 목록에 있는 방 재입장은 허용. 새 방인데 상한 초과면 안내.
      if (!canAddRoom(code)) {
        alertDialog(`Max ${MAX_SAVED_ROOMS} chat rooms reached.\nDelete one before joining a new room.`);
        return;
      }
      enterRoom(ctx, code);
    }

    joinBtn.addEventListener("click", join);
    input.addEventListener("input", () => {
      input.value = normalize(input.value);
    });
    onEnter(input, join);

    const savedSection = el("div", { class: "saved-rooms" });
    renderSavedRooms(savedSection, ctx);

    screenEl.append(el("div", { class: "lobby" }, [createBtn, sep, input, joinBtn, err, savedSection]));

    // 로컬 목록을 먼저 그린 뒤, 서버 멤버십에서 방을 복원한다(새 기기/재설치 대응).
    // 추가된 방이 있을 때만 재렌더. 실패는 비핵심이라 조용히 무시.
    syncRoomsFromServer()
      .then((added) => {
        // 비동기 완료 시점에 뷰가 교체됐을 수 있으므로 DOM 연결 여부 확인.
        if (added && savedSection.isConnected) renderSavedRooms(savedSection, ctx);
      })
      .catch((e) => console.error("room sync failed:", e));

    // 방별 안 읽은 표시가 바뀌면(새 메시지 도착/방 입장) 목록을 다시 그린다.
    this._unsub = messageNotifier.subscribe(() => {
      if (savedSection.isConnected) renderSavedRooms(savedSection, ctx);
    });
  },

  unmount() {
    this._unsub?.();
    this._unsub = null;
  },
};

function renderSavedRooms(container, ctx) {
  container.replaceChildren();
  const rooms = getSavedRooms();
  // 방별 안 읽음 — 방 코드 앞에 초록 점(●)으로 표시(0 이면 표시 안 함). online 표시와 같은 점.
  const unread = messageNotifier.getUnreadByRoom();
  if (rooms.length === 0) return;

  const header = el("div", { class: "saved-rooms-header", text: "— CHAT ROOMS —" });
  container.append(header);

  for (const room of rooms) {
    const count = unread.get(room.code) || 0;
    const unreadEl = count > 0
      ? el("span", { class: "saved-room-unread", text: "●", title: `${count} new` })
      : null;
    const codeEl = el("span", { class: "saved-room-code", text: room.code });
    const aliasEl = room.alias
      ? el("span", { class: "saved-room-alias", text: room.alias })
      : el("span", { class: "saved-room-alias empty", text: "+ name" });
    const renameBtn = el("button", {
      class: "btn saved-room-rename",
      title: "Rename",
      text: "[✎]",
      onClick: (e) => {
        e.stopPropagation();
        playKey();
        startAliasEdit(row, aliasEl, room, container, ctx);
      },
    });
    const deleteBtn = el("button", {
      class: "btn saved-room-delete",
      title: "Delete",
      text: "[×]",
      onClick: async (e) => {
        e.stopPropagation();
        playKey();
        const label = room.alias ? `${room.code} (${room.alias})` : room.code;
        const ok = await confirmDialog(
          `Delete chat room "${label}"?\nPrevious history will be hidden from your account.`,
          { okLabel: "DELETE" },
        );
        if (!ok) return;
        try {
          await removeSavedRoom(room.code);
        } catch (err) {
          console.error("remove room failed:", err);
        }
        renderSavedRooms(container, ctx);
      },
    });
    const actions = el("div", { class: "saved-room-actions" }, [renameBtn, deleteBtn]);
    const row = el(
      "div",
      {
        class: "saved-room-item",
        // data-no-drag: 이 행에서 mousedown 시 창 드래그(startDragging)가 시작되면
        // click 이 삼켜져 방 입장이 안 된다(Windows). 드래그 예외로 등록해 클릭이 살아나게 한다.
        dataset: { noDrag: "" },
        onClick: () => {
          playKey();
          enterRoom(ctx, room.code);
        },
      },
      unreadEl ? [unreadEl, codeEl, aliasEl, actions] : [codeEl, aliasEl, actions],
    );
    container.append(row);
  }
}

function startAliasEdit(row, aliasEl, room, container, ctx) {
  if (!aliasEl || !aliasEl.parentNode) return;
  const input = el("input", {
    class: "field saved-room-alias-input",
    type: "text",
    maxlength: "30",
    value: room.alias,
    placeholder: "name",
    spellcheck: "false",
    autocomplete: "off",
    dataset: { noDrag: "" },
  });
  input.addEventListener("click", (e) => e.stopPropagation());

  let done = false;
  const commit = () => {
    if (done) return;
    done = true;
    setRoomAlias(room.code, input.value);
    renderSavedRooms(container, ctx);
  };
  const cancel = () => {
    if (done) return;
    done = true;
    renderSavedRooms(container, ctx);
  };

  input.addEventListener("keydown", (e) => {
    // IME composition 중 Enter 는 commit 키 → 무시 (한글/일본어/중국어 입력 시 중복 commit 방지).
    if (e.key === "Enter" && !e.isComposing) {
      e.preventDefault();
      commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      cancel();
    }
  });
  input.addEventListener("blur", commit);

  aliasEl.replaceWith(input);
  input.focus();
  input.select();
}
