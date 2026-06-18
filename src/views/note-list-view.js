// 노트 목록 뷰: vault(retro-notes)의 노트를 최신순으로 나열. 행 클릭 → 편집, [+ NEW NOTE] → 새 노트.
// lobby 의 saved-rooms 목록 패턴을 차용.
import { el } from "../core/dom.js";
import { playKey } from "../platform/sound.js";
import { listNotes } from "../platform/notes-fs.js";

// 파일명 → 표시 라벨(presentation 은 뷰가 소유). note_ 접두/.txt 제거.
function noteLabel(filename) {
  return filename.replace(/^note_|\.txt$/g, "");
}

function renderRows(container, files, ctx) {
  container.replaceChildren();
  for (const filename of files) {
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
      [el("span", { class: "saved-room-alias", text: noteLabel(filename) })],
    );
    container.append(row);
  }
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

    // 비동기 로드. 완료 시점에 뷰가 교체됐을 수 있으므로 DOM 연결 여부 확인.
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
  },
};
