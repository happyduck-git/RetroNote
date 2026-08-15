// 채널 재연결/visibility 복귀 시 호출되어 그동안 놓친 메시지를 보충.
// realtime postgres_changes는 끊긴 동안의 INSERT를 catch-up 해주지 않으므로
// 마지막 수신 ts(없으면 firstJoinedAt) 이후를 DB에서 다시 가져온다. store의 id
// dedup이 중복을 처리. 동시 호출은 in-flight 플래그로 1회로 합친다.
// fetchMessages는 의존성 주입 — 테스트에서 mock 가능.
export function createBackfiller({ store, fetchMessages, firstJoinedAt, code }) {
  let inFlight = false;
  // 반환값은 "이번 보충이 성공했는지" — 실패는 연결이 실제로 죽었다는 신호로 쓰인다.
  return async function backfill() {
    if (inFlight) return true;
    inFlight = true;
    try {
      const cur = store.get();
      const sinceTs = cur.length ? cur[cur.length - 1].ts : firstJoinedAt;
      const fresh = await fetchMessages(code, sinceTs);
      for (const m of fresh) store.add(m);
      return true;
    } catch (e) {
      console.error("backfill failed:", e);
      return false;
    } finally {
      inFlight = false;
    }
  };
}

// "이번 connected 에서 보충이 필요한가"를 판단한다. 방에 들어올 때 seed 로 이미 채웠으므로
// 첫 connected 하나만 건너뛰면 되는데, 그 전에 끊김을 봤다면 첫 연결이라도 보충해야 한다
// (첫 connect 가 실패하고 재연결로 처음 붙는 경우, 그 사이 온 메시지가 영영 안 보인다).
export function createBackfillGate() {
  let connectedOnce = false;
  let missed = false;
  return {
    onStatus(state) {
      if (state === "connected") {
        const need = connectedOnce || missed;
        connectedOnce = true;
        missed = false;
        return need;
      }
      // connect() 는 시작할 때 connecting 을 쏜다 — 이걸 끊김으로 세면 첫 보충 생략이 무너진다.
      if (state !== "connecting") missed = true;
      return false;
    },
    markFailed() {
      missed = true;
    },
    hasConnected: () => connectedOnce,
  };
}
