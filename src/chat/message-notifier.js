// 앱 수준 새 메시지 배지 서비스.
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
import { getClient, ensureFreshSession } from "../auth/auth.js";
import { setUnread, isAppFocused } from "../platform/badge.js";
import { subscribeChannel } from "./channel-subscribe.js";

export function makeMessageNotifier({
  getClient,
  isAppFocused,
  setUnread,
  ensureFreshSession = async () => {},
}) {
  let channel = null;
  let client = null;
  let starting = false;
  let currentUserId = null;
  let status = "connecting";
  const statusSubs = new Set(); // 연결 상태 구독자(로비 표시 + 재연결 감독자)
  const unreadByRoom = new Map(); // code -> 안 읽은 수
  const subs = new Set(); // 로비 등 구독자(방별 카운터 변경 시 재렌더)

  // --- 펫 전용 신호(비파괴 추가) ---
  // 배지 경로는 !isAppFocused() 게이트라 "보고 있을 때 온 메시지"에 반응을 못 만든다.
  // 늘 보이는 펫은 focus 무관 신호가 필요해 별도 상태/구독자를 둔다(기존 배지/로비 경로는 불변).
  let activeRoom = null; // 지금 보고 있는 방 코드(없으면 null)
  const petUnreadByRoom = new Map(); // 펫 전용 안 읽음(지금 보는 방 제외)
  const arrivedSubs = new Set(); // 새 메시지 도착 반응 구독자
  const petUnreadSubs = new Set(); // 펫 안 읽음 변경 구독자(빨간 점)

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
    // 펫 상태도 함께 정리.
    const petHad = petUnreadByRoom.size > 0;
    petUnreadByRoom.clear();
    activeRoom = null;
    if (petHad) emitPetUnread();
  }

  // --- 펫 전용 헬퍼 ---
  function emitArrived(code) {
    for (const fn of arrivedSubs) {
      try { fn(code); } catch (e) { console.error("pet arrived subscriber failed:", e); }
    }
  }

  function emitPetUnread() {
    for (const fn of petUnreadSubs) {
      try { fn(); } catch (e) { console.error("pet unread subscriber failed:", e); }
    }
  }

  function petTotal() {
    let n = 0;
    for (const v of petUnreadByRoom.values()) n += v;
    return n;
  }

  function petBump(code) {
    petUnreadByRoom.set(code, (petUnreadByRoom.get(code) || 0) + 1);
    emitPetUnread();
  }

  // 지금 보는 방을 설정. 방이면 그 방 펫 안읽음을 지운다(= 봤음).
  // 펫 안읽음을 지우는 유일한 지점(단일 출처). 실제로 지워졌을 때만 통지.
  function setActiveRoom(code) {
    activeRoom = code || null;
    if (code && petUnreadByRoom.delete(code)) emitPetUnread();
  }

  function getPetUnreadTotal() {
    return petTotal();
  }

  // 새 메시지 도착 반응 구독(모든 방, focus 무관). unsubscribe 반환.
  function onMessageArrived(cb) {
    arrivedSubs.add(cb);
    return () => arrivedSubs.delete(cb);
  }

  // 펫 안읽음 변경 구독(빨간 점). unsubscribe 반환.
  function petSubscribe(cb) {
    petUnreadSubs.add(cb);
    return () => petUnreadSubs.delete(cb);
  }

  function setStatus(next) {
    if (status === next) return;
    status = next;
    for (const fn of statusSubs) {
      try { fn(status); } catch (e) { console.error("notifier status subscriber failed:", e); }
    }
  }

  // 연결 상태 구독. unsubscribe 를 돌려준다.
  function onStatus(cb) {
    statusSubs.add(cb);
    return () => statusSubs.delete(cb);
  }

  function getStatus() {
    return status;
  }

  // 라이브러리가 상태를 안 알려준 채 죽은 경우(좀비)를 가려낸다.
  function isHealthy() {
    return !!channel && channel.state === "joined";
  }

  // 채널만 연다. 실패는 호출 측으로 전달 — reconnect 가 재시도 판단에 쓴다.
  async function openChannel() {
    client = await getClient();
    const ch = client
      .channel("notify:messages")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => handleInsert(currentUserId, payload.new),
      );
    channel = ch;
    await subscribeChannel(ch, setStatus);
  }

  async function start(userId) {
    // 이미 떠 있으면(또는 사용자 전환으로 재호출) 먼저 깨끗이 정리 → 이중 채널 방지.
    await stop();
    if (starting) return;
    starting = true;
    currentUserId = userId;
    try {
      await openChannel();
    } catch (e) {
      console.error("message notifier start failed:", e);
      await teardownChannel();
    } finally {
      starting = false;
    }
  }

  // 채널만 갈아 끼운다 — 안 읽음 카운터는 건드리지 않는다(재연결이 배지를 지우면 안 된다).
  // start 와 겹치면 실패로 알린다 — 조용히 통과시키면 감독자가 "붙었다"고 잘못 판단한다.
  async function reconnect() {
    if (!currentUserId) throw new Error("not started");
    if (starting) throw new Error("busy");
    starting = true;
    try {
      await teardownChannel();
      await ensureFreshSession();
      await openChannel();
    } finally {
      starting = false;
    }
  }

  function handleInsert(userId, row) {
    try {
      if (!row) return;
      if (row.sender_uid === userId) return; // 내 메시지 제외
      // 펫 신호는 focus 무관 → 아래 배지 경로의 focus 게이트보다 먼저 처리.
      emitArrived(row.room_code); // 펫 반응: 모든 방
      if (row.room_code !== activeRoom) petBump(row.room_code); // 펫 점: 지금 보는 방이 아니면 +1
      if (isAppFocused()) return; // 앱 활성 중이면 보고 있으니 제외(기존 배지 경로)
      // "내 방인지"는 따로 거르지 않는다 — 알림 채널은 RLS 로 보호돼 내가 멤버인 방의 메시지만
      // 애초에 도착한다(통합 테스트로 비멤버 미수신 증명). 과거의 getSavedRooms 필터는 localStorage
      // 가 동기화 도중 잠깐 비는 순간 메시지를 통째로 버리는 버그가 있어 제거했다.
      bump(row.room_code);
    } catch (e) {
      console.error("badge update on message failed:", e);
    }
  }

  // 채널만 정리. 카운터는 그대로 둔다.
  async function teardownChannel() {
    try {
      if (channel && client) await client.removeChannel(channel);
    } catch (e) {
      console.error("notifier removeChannel failed:", e);
    } finally {
      channel = null;
    }
  }

  async function stop() {
    await teardownChannel();
    currentUserId = null;
    setStatus("connecting");
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

  return {
    start,
    stop,
    clearRoom,
    getUnreadByRoom,
    subscribe,
    // 연결 복구
    reconnect,
    isHealthy,
    onStatus,
    getStatus,
    // 펫 전용
    setActiveRoom,
    onMessageArrived,
    petSubscribe,
    getPetUnreadTotal,
  };
}

// 실제 wiring: main.js 가 로그인/로그아웃 시 start/stop(notifier-connection 경유),
// room-view 가 입장 시 clearRoom, lobby-view 가 getUnreadByRoom/subscribe 를 호출한다.
export const messageNotifier = makeMessageNotifier({
  getClient,
  isAppFocused,
  setUnread,
  ensureFreshSession,
});
