// 로비: 방 생성(코드 발급) 또는 코드로 입장 + 최근 방 목록.
import { el } from "../core/dom.js";
import { playKey } from "../platform/sound.js";
import { generate6, isValid, normalize, CODE_LENGTH } from "../chat/room-code.js";
import { getSavedRooms, setRoomAlias, removeSavedRoom } from "../chat/session.js";

export const lobbyView = {
  mount(screenEl, params, ctx) {
    const createBtn = el("button", {
      class: "btn lobby-btn",
      text: "[ CREATE ROOM ]",
      onClick: () => ctx.navigate("room", { code: generate6() }),
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
      ctx.navigate("room", { code });
    }

    joinBtn.addEventListener("click", join);
    input.addEventListener("input", () => {
      input.value = normalize(input.value);
    });
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") {
        e.preventDefault();
        join();
      }
    });

    const savedSection = el("div", { class: "saved-rooms" });
    renderSavedRooms(savedSection, ctx);

    screenEl.append(el("div", { class: "lobby" }, [createBtn, sep, input, joinBtn, err, savedSection]));
  },
};

function renderSavedRooms(container, ctx) {
  container.replaceChildren();
  const rooms = getSavedRooms();
  if (rooms.length === 0) return;

  const header = el("div", { class: "saved-rooms-header", text: "— CHAT ROOMS —" });
  container.append(header);

  for (const room of rooms) {
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
        startAliasEdit(row, room, container, ctx);
      },
    });
    const deleteBtn = el("button", {
      class: "btn saved-room-delete",
      title: "Delete",
      text: "[×]",
      onClick: (e) => {
        e.stopPropagation();
        playKey();
        removeSavedRoom(room.code);
        renderSavedRooms(container, ctx);
      },
    });
    const actions = el("div", { class: "saved-room-actions" }, [renameBtn, deleteBtn]);
    const row = el(
      "div",
      {
        class: "saved-room-item",
        onClick: () => {
          playKey();
          ctx.navigate("room", { code: room.code });
        },
      },
      [codeEl, aliasEl, actions],
    );
    row._aliasEl = aliasEl;
    container.append(row);
  }
}

function startAliasEdit(row, room, container, ctx) {
  const aliasEl = row._aliasEl;
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
    if (e.key === "Enter") {
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
