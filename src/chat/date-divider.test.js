import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { localDateKey, withDateDividers } from "./date-divider.js";

// 시간대 무관 테스트: 로컬 Date 로 ts 를 만들고, localDateKey 도 로컬 기준이라
// 어떤 CI 타임존에서도 같은 yyyy-mm-dd 가 나온다.
function tsAt(y, m, d, hh = 12, mm = 0) {
  return new Date(y, m - 1, d, hh, mm).getTime();
}
function msg(id, ts) {
  return { id, ts, senderUid: "u", nickname: "u", text: id };
}
// 구분선 마커만 추출
function dividers(rows) {
  return rows.filter((r) => r.divider).map((r) => r.date);
}

describe("date-divider: localDateKey", () => {
  test("로컬 기준 yyyy-mm-dd, 월/일 zero-pad", () => {
    assert.equal(localDateKey(tsAt(2026, 6, 21, 9, 30)), "2026-06-21");
    assert.equal(localDateKey(tsAt(2026, 1, 3, 0, 5)), "2026-01-03");
  });
});

describe("date-divider: withDateDividers", () => {
  test("빈 배열 → 빈 결과", () => {
    assert.deepEqual(withDateDividers([]), []);
  });

  test("같은 날 여러 메시지 → 맨 위 구분선 하나(Option A), 중간 구분선 없음", () => {
    const rows = withDateDividers([
      msg("a", tsAt(2026, 6, 21, 9, 0)),
      msg("b", tsAt(2026, 6, 21, 18, 0)),
    ]);
    assert.deepEqual(dividers(rows), ["2026-06-21"]);
    // 펼친 순서: [divider, a, b]
    assert.equal(rows.length, 3);
    assert.equal(rows[0].divider, true);
    assert.equal(rows[1].id, "a");
    assert.equal(rows[2].id, "b");
  });

  test("이틀에 걸치면 각 날의 첫 메시지 앞에 구분선", () => {
    const rows = withDateDividers([
      msg("a", tsAt(2026, 6, 21, 23, 0)),
      msg("b", tsAt(2026, 6, 22, 1, 0)),
      msg("c", tsAt(2026, 6, 22, 2, 0)),
    ]);
    assert.deepEqual(dividers(rows), ["2026-06-21", "2026-06-22"]);
    // [div21, a, div22, b, c]
    assert.deepEqual(rows.map((r) => (r.divider ? "D:" + r.date : r.id)), [
      "D:2026-06-21",
      "a",
      "D:2026-06-22",
      "b",
      "c",
    ]);
  });

  test("구분선 date 는 바로 뒤 메시지의 localDateKey 와 일치", () => {
    const m = msg("a", tsAt(2026, 12, 31, 23, 59));
    const rows = withDateDividers([m]);
    assert.equal(rows[0].divider, true);
    assert.equal(rows[0].date, localDateKey(m.ts));
    assert.equal(rows[1], m);
  });

  test("로컬 자정 직전/직후는 다른 날 그룹", () => {
    const before = msg("before", tsAt(2026, 6, 21, 23, 59));
    const after = msg("after", tsAt(2026, 6, 22, 0, 1));
    const rows = withDateDividers([before, after]);
    assert.deepEqual(dividers(rows), ["2026-06-21", "2026-06-22"]);
  });
});
