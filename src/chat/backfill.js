// 채널 재연결/visibility 복귀 시 호출되어 그동안 놓친 메시지를 보충.
// realtime postgres_changes는 끊긴 동안의 INSERT를 catch-up 해주지 않으므로
// 마지막 수신 ts(없으면 firstJoinedAt) 이후를 DB에서 다시 가져온다. store의 id
// dedup이 중복을 처리. 동시 호출은 in-flight 플래그로 1회로 합친다.
// fetchMessages는 의존성 주입 — 테스트에서 mock 가능.
export function createBackfiller({ store, fetchMessages, firstJoinedAt, code }) {
  let inFlight = false;
  return async function backfill() {
    if (inFlight) return;
    inFlight = true;
    try {
      const cur = store.get();
      const sinceTs = cur.length ? cur[cur.length - 1].ts : firstJoinedAt;
      const fresh = await fetchMessages(code, sinceTs);
      for (const m of fresh) store.add(m);
    } catch (e) {
      console.error("backfill failed:", e);
    } finally {
      inFlight = false;
    }
  };
}
