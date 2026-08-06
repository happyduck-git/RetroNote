import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createScrollAnchor } from "./scroll-anchor.js";

// scroll-anchor 는 list 의 scroll*/getBoundingClientRect/children 만 읽는다.
// 그 표면만 가진 fake 를 쓰면 jsdom 없이 좌표 계산을 그대로 검증할 수 있다.
function makeList({ scrollHeight, scrollTop, clientHeight, top = 0, rows = [] }) {
  const list = {
    scrollHeight,
    scrollTop,
    clientHeight,
    top,
    getBoundingClientRect() {
      return { top: this.top };
    },
    children: [],
    setRows(rs) {
      list.children = rs.map((r) => ({
        dataset: { id: r.id },
        getBoundingClientRect: () => ({ top: r.top, bottom: r.bottom }),
      }));
    },
  };
  list.setRows(rows);
  return list;
}

describe("stickToBottom (바닥 근처)", () => {
  test("바닥 40px 이내면 stick → restore 는 바닥으로 재고정", () => {
    // dist = scrollHeight - scrollTop - clientHeight = 1000 - 970 - 100 = -70 (< 40)
    const list = makeList({ scrollHeight: 1000, scrollTop: 970, clientHeight: 100 });
    const anchor = createScrollAnchor(list);
    anchor.captureAnchor();
    list.scrollHeight = 1200; // 새 메시지로 높이 증가
    anchor.restoreScroll();
    assert.equal(list.scrollTop, 1200);
  });

  test("바닥에서 40px 이상 떨어지면 stick 아님 → 바닥으로 점프하지 않는다", () => {
    // dist = 1000 - 500 - 100 = 400 (>= 40) → 앵커 모드
    const list = makeList({
      scrollHeight: 1000,
      scrollTop: 500,
      clientHeight: 100,
      rows: [{ id: "m1", top: 30, bottom: 50 }],
    });
    const anchor = createScrollAnchor(list);
    anchor.captureAnchor();
    list.scrollHeight = 5000;
    anchor.restoreScroll();
    assert.notEqual(list.scrollTop, 5000);
  });
});

describe("앵커 모드 (상단 메시지의 상대 위치 유지)", () => {
  test("최상단 메시지의 오프셋을 유지하도록 scrollTop 보정", () => {
    const list = makeList({
      scrollHeight: 1000,
      scrollTop: 500,
      clientHeight: 100,
      top: 0,
      rows: [
        { id: "m1", top: 30, bottom: 50 },
        { id: "m2", top: 50, bottom: 80 },
      ],
    });
    const anchor = createScrollAnchor(list);
    anchor.captureAnchor(); // anchor=m1, offset = 30 - 0 = 30
    // 재렌더로 위 내용이 늘어 m1 이 아래로 밀림(top 30 → 80)
    list.setRows([
      { id: "m1", top: 80, bottom: 100 },
      { id: "m2", top: 100, bottom: 130 },
    ]);
    anchor.restoreScroll();
    // scrollTop += rowTop - listTop - offset = 80 - 0 - 30 = +50
    assert.equal(list.scrollTop, 550);
  });

  test("날짜 구분선(date-*)은 앵커로 잡지 않고 그 아래 메시지를 잡는다", () => {
    const list = makeList({
      scrollHeight: 1000,
      scrollTop: 500,
      clientHeight: 100,
      top: 0,
      rows: [
        { id: "date-2026-08-06", top: 10, bottom: 30 }, // 최상단이지만 구분선 → 건너뜀
        { id: "m1", top: 30, bottom: 55 },
      ],
    });
    const anchor = createScrollAnchor(list);
    anchor.captureAnchor(); // date-* skip, anchor=m1, offset=30
    list.setRows([
      { id: "date-2026-08-06", top: 5, bottom: 25 },
      { id: "m1", top: 70, bottom: 95 },
    ]);
    anchor.restoreScroll();
    assert.equal(list.scrollTop, 500 + (70 - 0 - 30)); // 540
  });

  test("보이는 메시지 행이 없으면 앵커 없음 → restore no-op", () => {
    const list = makeList({
      scrollHeight: 1000,
      scrollTop: 500,
      clientHeight: 100,
      top: 0,
      rows: [
        { id: "date-x", top: 10, bottom: 30 }, // 구분선 → skip
        { id: "m0", top: -50, bottom: -1 }, // 화면 위(bottom <= listTop+1) → 매칭 안 됨
      ],
    });
    const anchor = createScrollAnchor(list);
    anchor.captureAnchor();
    anchor.restoreScroll();
    assert.equal(list.scrollTop, 500);
  });

  test("앵커로 잡은 메시지가 사라지면 restore no-op", () => {
    const list = makeList({
      scrollHeight: 1000,
      scrollTop: 500,
      clientHeight: 100,
      top: 0,
      rows: [{ id: "m1", top: 30, bottom: 55 }],
    });
    const anchor = createScrollAnchor(list);
    anchor.captureAnchor(); // anchor=m1
    list.setRows([{ id: "m2", top: 30, bottom: 55 }]); // m1 제거
    anchor.restoreScroll();
    assert.equal(list.scrollTop, 500);
  });
});
