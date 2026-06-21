// 노트 목록 뷰: vault(retro-notes)의 노트를 최신순으로 나열. 행 클릭 → 편집, [+ NEW NOTE] → 새 노트.
// lobby 의 saved-rooms 목록 패턴을 차용.
import { el } from "../core/dom.js";
import { confirmDialog, alertDialog } from "../core/confirm.js";
import { playKey } from "../platform/sound.js";
import { listNotes, deleteNote } from "../platform/notes-fs.js";

// 파일명 → 표시 라벨(presentation 은 뷰가 소유). note_ 접두/.txt|.md 확장자 제거.
function noteLabel(filename) {
  return filename.replace(/^note_|\.(txt|md)$/g, "");
}

function renderRows(container, files, ctx) {
  container.replaceChildren();
  for (const filename of files) {
    const deleteBtn = el("button", {
      class: "btn saved-room-delete",
      title: "Delete",
      text: "[×]",
      onClick: async (e) => {
        // 행 클릭(편집 진입)과 분리. 삭제만 수행.
        e.stopPropagation();
        playKey();
        const ok = await confirmDialog(`Delete note "${noteLabel(filename)}"?`, {
          okLabel: "DELETE",
        });
        if (!ok) return;
        try {
          await deleteNote(filename);
        } catch (err) {
          console.error("delete note failed:", err);
          alertDialog("Couldn't delete note.");
        }
        // 성공/실패 무관하게 디스크 기준으로 재렌더(디스크=단일 source-of-truth).
        // 실패해도 파일이 이미 지워졌을 수 있어 stale 행을 남기지 않는다. isConnected 가드는 loadAndRender 안에서.
        loadAndRender(container, ctx);
      },
    });
    const actions = el("div", { class: "saved-room-actions" }, [deleteBtn]);
    const row = el(
      "div",
      {
        class: "saved-room-item",
        // data-no-drag: 행이 <div> 라 없으면 mousedown 시 창 드래그가 클릭을 삼킨다(Windows).
        dataset: { noDrag: "" },
        onClick: () => {
          playKey();
          ctx.navigate("note", { filename });
        },
      },
      [el("span", { class: "saved-room-alias", text: noteLabel(filename) }), actions],
    );
    container.append(row);
  }
}

// vault 의 노트를 읽어 listRegion 에 렌더. mount 와 삭제 후 재렌더가 공유.
// 비동기 완료 시점에 뷰가 교체됐을 수 있으므로 DOM 연결 여부를 확인.
function loadAndRender(listRegion, ctx) {
  listNotes()
    .then((files) => {
      if (!listRegion.isConnected) return;
      if (files.length === 0) {
        listRegion.replaceChildren(
          el("div", { class: "note-list-empty", text: "— no notes yet —" }),
        );
        return;
      }
      renderRows(listRegion, files, ctx);
    })
    .catch((err) => {
      console.error("list notes failed:", err);
      if (!listRegion.isConnected) return;
      // 실패를 "노트 없음"으로 표기하면 데이터 유실로 오인되므로 에러 메시지를 분리.
      listRegion.replaceChildren(
        el("div", { class: "note-list-error", text: "— couldn't read notes —" }),
      );
    });
}

export const noteListView = {
  mount(screenEl, params, ctx) {
    const newBtn = el("button", {
      class: "btn lobby-btn",
      text: "[ + NEW NOTE ]",
      onClick: () => ctx.navigate("note"),
    });
    // 스크롤 영역: 비어 있든 길든 [+ NEW NOTE] 는 그 바깥 상단에 항상 노출.
    const listRegion = el("div", { class: "saved-rooms" });

    screenEl.append(el("div", { class: "note-list" }, [newBtn, listRegion]));

    loadAndRender(listRegion, ctx);
  },
};
