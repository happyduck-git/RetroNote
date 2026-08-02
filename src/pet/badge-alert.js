// 배지 표시 조건과 "펫 클릭 → 메인 창 앞으로" 조건은 항상 같아야 해서 한 곳에 둔다.
export function petBadgeVisible(unread, mainFocused) {
  return unread > 0 && !mainFocused;
}
