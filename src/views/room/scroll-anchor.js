// 스크롤 앵커: 리사이즈/재렌더 후에도 사용자가 보던 위치를 유지한다.
const NEAR_BOTTOM_PX = 40;

// 스크롤 앵커: 리사이즈/재렌더 후에도 사용자가 보던 위치를 유지한다.
// 폰트 크기가 --computer-width(창 폭)에 비례하므로 리사이즈하면 메시지 높이가 변한다.
// scrollTop을 그대로 두면 같은 픽셀 오프셋이 다른 메시지를 보여주게 되어 시각적으로
// 위/아래로 미끄러져 보인다. 두 모드:
//   - 바닥 근처(stickToBottom): 새 메시지 도착/리사이즈 시 바닥에 재고정
//   - 그 외: viewport 최상단에 걸친 메시지 id를 anchor로 기록 → 재렌더/리사이즈 후
//           그 메시지의 viewport 내 동일 상대 위치(offset)로 scrollTop을 보정
// ※ 좌표 계산은 getBoundingClientRect로 한다. offsetTop은 offsetParent(.room) 기준이라
//   .room-list의 scroll 좌표계와 어긋나서 부정확하다.
export function createScrollAnchor(list) {
  let stickToBottom = true;
  let anchorId = null;
  let anchorOffset = 0;
  function captureAnchor() {
    const distFromBottom = list.scrollHeight - list.scrollTop - list.clientHeight;
    stickToBottom = distFromBottom < NEAR_BOTTOM_PX;
    if (stickToBottom) {
      anchorId = null;
      return;
    }
    const listTop = list.getBoundingClientRect().top;
    for (const row of list.children) {
      const rect = row.getBoundingClientRect();
      if (rect.bottom > listTop + 1) {
        anchorId = row.dataset.id || null;
        anchorOffset = rect.top - listTop;
        return;
      }
    }
    anchorId = null;
  }
  function restoreScroll() {
    if (stickToBottom) {
      list.scrollTop = list.scrollHeight;
      return;
    }
    if (!anchorId) return;
    for (const row of list.children) {
      if (row.dataset.id === anchorId) {
        const listTop = list.getBoundingClientRect().top;
        const rowTop = row.getBoundingClientRect().top;
        list.scrollTop += rowTop - listTop - anchorOffset;
        return;
      }
    }
  }
  return { captureAnchor, restoreScroll };
}
