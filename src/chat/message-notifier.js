// 앱 수준 새 메시지 배지 서비스(issue #52).
// room-view 의 방별 채널과 별개로, 로그인 동안 계속 살아 있는 채널 하나가 messages 테이블의
// INSERT 를 필터 없이 구독한다 → 방 화면 밖(로비/메모/다른 방)에서도 안 읽은 메시지를 센다.
// 배너 알림 대신 앱 아이콘 배지(안 읽은 수)만 쓴다(사용자 선택).
//
// 동작:
//   - 앱이 비활성일 때 남이 보낸 메시지가 오면 그 방의 카운터를 1 올린다.
//   - 도크/작업표시줄 배지 = 모든 방의 합계.
//   - 로비는 방별 카운터를 읽어 방 코드 앞에 초록 점(●)으로 보여 준다.
//   - 그 방에 입장하면(room-view) 그 방 카운터를 0 으로 지운다(= 봤다고 간주). 포커스만으로는 안 지운다.
//
// 중요: 이 서비스는 message-store 를 절대 건드리지 않는다(화면 렌더는 room-view 책임).
//
// "내 방인지" 는 클라이언트에서 거르지 않는다. 알림 채널은 RLS 로 보호돼 내가 멤버인 방의 메시지만
// 애초에 도착하기 때문(통합 테스트로 비멤버 미수신 증명). 과거엔 getSavedRooms() 로 한 번 더 걸렀으나,
// 그 목록(localStorage)이 로그인/서버 동기화 도중 잠깐 비는 순간 메시지를 통째로 버리는 버그가 있어 제거했다.
//
// DI factory 로 협력자를 주입받아 테스트 가능하게 한다. 기본 export 는 실제 모듈로 배선한 인스턴스.
import { getClient } from "../auth/auth.js";
import { setUnread, isAppFocused } from "../platform/badge.js";

export function makeMessageNotifier({
  getClient,
  isAppFocused,
  setUnread,
}) {
  let channel = null;
  let client = null;
  let starting = false;
  const unreadByRoom = new Map(); // code -> 안 읽은 수
  const subs = new Set(); // 로비 등 구독자(방별 카운터 변경 시 재렌더)

  function total() {
    let n = 0;
    for (const v of unreadByRoom.values()) n += v;
    return n;
  }

  function emit() {
    for (const fn of subs) {
      try { fn(); } catch (e) { console.error("badge subscriber failed:", e); }
    }
  }

  // 합계를 아이콘 배지에 반영 + 구독자에게 변경 통지.
  function refresh() {
    setUnread(total());
    emit();
  }

  function bump(code) {
    unreadByRoom.set(code, (unreadByRoom.get(code) || 0) + 1);
    refresh();
  }

  // 한 방의 카운터를 지운다(그 방 입장 시). 변화 없으면 통지 생략.
  function clearRoom(code) {
    if (unreadByRoom.delete(code)) refresh();
  }

  function clearAll() {
    const had = unreadByRoom.size > 0;
    unreadByRoom.clear();
    if (had) refresh();
    else setUnread(0); // 배지만 확실히 0 으로(구독자 통지는 불필요).
  }

  async function start(userId) {
    // 이미 떠 있으면(또는 사용자 전환으로 재호출) 먼저 깨끗이 정리 → 이중 채널 방지.
    await stop();
    if (starting) return;
    starting = true;
    try {
      client = await getClient();
      channel = client
        .channel("notify:messages")
        .on(
          "postgres_changes",
          { event: "INSERT", schema: "public", table: "messages" },
          (payload) => handleInsert(userId, payload.new),
        );
      await channel.subscribe();
    } catch (e) {
      console.error("message notifier start failed:", e);
      await stop();
    } finally {
      starting = false;
    }
  }

  function handleInsert(userId, row) {
    try {
      if (!row) return;
      if (row.sender_uid === userId) return; // 내 메시지 제외
      if (isAppFocused()) return; // 앱 활성 중이면 보고 있으니 제외
      // "내 방인지"는 따로 거르지 않는다 — 알림 채널은 RLS 로 보호돼 내가 멤버인 방의 메시지만
      // 애초에 도착한다(통합 테스트로 비멤버 미수신 증명). 과거의 getSavedRooms 필터는 localStorage
      // 가 동기화 도중 잠깐 비는 순간 메시지를 통째로 버리는 버그가 있어 제거했다.
      bump(row.room_code);
    } catch (e) {
      console.error("badge update on message failed:", e);
    }
  }

  async function stop() {
    try {
      if (channel && client) await client.removeChannel(channel);
    } catch (e) {
      console.error("notifier removeChannel failed:", e);
    } finally {
      channel = null;
    }
    clearAll();
  }

  // 로비가 읽을 방별 카운터 스냅샷(복사본).
  function getUnreadByRoom() {
    return new Map(unreadByRoom);
  }

  // 방별 카운터 변경 통지 구독. unsubscribe 함수를 돌려준다.
  function subscribe(cb) {
    subs.add(cb);
    return () => subs.delete(cb);
  }

  return { start, stop, clearRoom, getUnreadByRoom, subscribe };
}

// 실제 wiring: main.js 가 로그인/로그아웃 시 start/stop, room-view 가 입장 시 clearRoom,
// lobby-view 가 getUnreadByRoom/subscribe 를 호출한다.
export const messageNotifier = makeMessageNotifier({
  getClient,
  isAppFocused,
  setUnread,
});
