// 위쪽 무한 스크롤: 현재 store 의 가장 오래된 메시지보다 더 과거 페이지를 한 묶음 불러온다.
// 초기 진입은 "최신 N 건"만 시드하므로(openRoom), 그 위의 과거는 사용자가 위로 스크롤할 때
// 이 loader 로 firstJoinedAt 바닥까지 이어 받는다. fetchMessages 는 DI — 테스트에서 mock.
// 동시 호출은 in-flight 플래그로 1회로 합친다(backfill.js 와 같은 패턴).
export function createHistoryLoader({ store, fetchMessages, firstJoinedAt, code, pageSize }) {
  let inFlight = false;
  return async function loadOlder() {
    if (inFlight) return { newlyAdded: 0, hasMore: true };
    const cur = store.get();
    // 비어 있으면(브랜드 뉴 방 등) 커서가 없어 더 받을 게 없다.
    if (!cur.length) return { newlyAdded: 0, hasMore: false };
    inFlight = true;
    try {
      const top = cur[0]; // store 는 오름차순 → [0] 이 현재 화면의 가장 오래된 메시지(=커서).
      const raw = await fetchMessages(code, {
        sinceTs: firstJoinedAt,
        beforeTs: top.ts,
        beforeId: top.id,
        limit: pageSize,
      });
      const newlyAdded = store.prepend(raw);
      // hasMore: 페이지를 꽉 채웠고(raw.length>=pageSize) 실제로 뭔가 추가됐을 때만 true.
      // newlyAdded===0(경계가 전부 이미 store 에 있는 병리적 케이스)이면 커서가 안 움직이므로
      // false 로 막아 채움-루프가 헛도는 것을 방지한다.
      const hasMore = raw.length >= pageSize && newlyAdded > 0;
      return { newlyAdded, hasMore };
    } catch (e) {
      console.error("loadOlder failed:", e);
      return { newlyAdded: 0, hasMore: true }; // 일시 오류 — 다음 스크롤에서 재시도 허용.
    } finally {
      inFlight = false;
    }
  };
}
