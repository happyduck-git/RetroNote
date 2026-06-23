// 표시 중인 메시지 목록을 소유한다. 메모리 전용 — 영속화는 Postgres가 담당.
// postgres_changes echo로 본인이 보낸 메시지도 다시 들어오므로 id 기반 dedup이 필수.
// 메시지는 도착 순서대로 append (발신자 시계 편차에 따른 재정렬은 하지 않음).
const MAX_MESSAGES = 500; // 방당 메모리 상한. 초과 시 가장 오래된 것부터 버린다.

// userId: 현재 로그인 사용자의 auth.uid. mine 판정 기준.
// 과거에는 clientId(기기별 UUID)로 판정했으나, 다른 기기에서 보낸 본인 메시지가
// "타인" 으로 표시되는 문제가 있어 senderUid 비교로 변경. clientId 는 presence 키 등에서 계속 사용.
//
// 표시 이름(displayName): 각 메시지는 보낸 시점에 박제된 자기 nickname(= DB sender_nickname)
// 그대로 표시한다. 닉네임을 바꿔도 과거 메시지는 박제값을 유지 — 변경은 앞으로 보내는 메시지에만
// 반영된다(익명화). 라이브 lookup/통일 같은 재렌더는 하지 않는다.
export function createMessageStore(userId) {
  let messages = [];
  const ids = new Set();
  const subs = new Set();

  function applyDisplayName(m) {
    m.displayName = m.nickname;
  }

  function emit() {
    for (const fn of subs) fn(messages);
  }

  function trim() {
    if (messages.length > MAX_MESSAGES) {
      const removed = messages.splice(0, messages.length - MAX_MESSAGES);
      for (const r of removed) ids.delete(r.id);
    }
  }

  // history fetch 결과로 초기 상태를 채운다(여러 번 호출되면 마지막 호출이 이긴다).
  function seed(initial) {
    messages = [];
    ids.clear();
    for (const m of initial) {
      if (ids.has(m.id)) continue;
      m.mine = !!userId && m.senderUid === userId;
      applyDisplayName(m);
      messages.push(m);
      ids.add(m.id);
    }
    trim();
    emit();
  }

  function add(msg) {
    if (ids.has(msg.id)) return; // dedup: postgres_changes echo / 낙관적 추가 중복
    msg.mine = !!userId && msg.senderUid === userId;
    applyDisplayName(msg);
    messages.push(msg);
    ids.add(msg.id);
    trim();
    emit();
  }

  // 기존 메시지의 일부 필드를 갱신한다(예: 송신 실패 플래그). id 매칭이 없으면 무시.
  function update(id, patch) {
    const m = messages.find((x) => x.id === id);
    if (!m) return;
    Object.assign(m, patch);
    emit();
  }

  function start() {
    // no-op. 호환성 유지.
  }

  function stop() {
    subs.clear();
    // 메모리만 해제: 다음 createMessageStore + seed 가 새 상태를 채운다.
  }

  function subscribe(fn) {
    subs.add(fn);
    fn(messages);
    return () => subs.delete(fn);
  }

  return {
    add,
    update,
    seed,
    start,
    stop,
    subscribe,
    get: () => messages,
  };
}
