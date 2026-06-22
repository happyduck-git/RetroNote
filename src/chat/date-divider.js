// 채팅 기록에 날짜 구분선을 끼워 넣기 위한 순수 헬퍼(DOM 없음 — 단위 테스트 대상).
// ts(epoch ms)를 "보는 사람의 로컬 시간대" 기준 날짜로 해석한다 — fmtTime(room-view.js)과 동일한 정책.
import { pad2 } from "../core/dom.js";

// ts → "yyyy-mm-dd" (로컬 시간대). getFullYear/getMonth/getDate 는 자동으로 로컬 기준.
export function localDateKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

// 메시지 배열을 "구분선 마커 + 메시지" 가 섞인 평면 렌더 목록으로 펼친다.
// 날짜(로컬)가 바뀌는 첫 메시지 앞에 구분선을 넣는다 — 맨 첫 메시지도 항상 구분선을 받는다(Option A).
// 구분선 마커: { divider: true, date: "yyyy-mm-dd" }. 메시지는 그대로 통과시킨다.
// 메시지는 store 의 도착 순서를 그대로 따른다(재정렬하지 않음).
export function withDateDividers(messages) {
  const rows = [];
  let prevKey = null;
  for (const m of messages) {
    const key = localDateKey(m.ts);
    if (key !== prevKey) {
      rows.push({ divider: true, date: key });
      prevKey = key;
    }
    rows.push(m);
  }
  return rows;
}
