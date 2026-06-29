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
  // 무한 스크롤로 과거를 prepend 한 동안에는 트림을 유예한다 — 라이브 메시지 유입(add)이나
  // backfill 의 trim() 이 앞쪽(오래된)에서 잘라내면 사용자가 보고 있던 과거가 사라진다.
  // prepend 가 켜고, seed(방 재시드) 가 끄고, resumeTrim(바닥 복귀) 이 1회 trim 후 끈다.
  let trimSuspended = false;

  function applyDisplayName(m) {
    m.displayName = m.nickname;
  }

  function emit() {
    for (const fn of subs) fn(messages);
  }

  // 앞쪽(오래된)부터 MAX_MESSAGES 초과분을 버린다. 제거한 행 수를 반환.
  // trimSuspended(과거 prepend 중)면 아무것도 안 한다.
  function trim() {
    if (trimSuspended) return 0;
    if (messages.length > MAX_MESSAGES) {
      const removed = messages.splice(0, messages.length - MAX_MESSAGES);
      for (const r of removed) ids.delete(r.id);
      return removed.length;
    }
    return 0;
  }

  // history fetch 결과로 초기 상태를 채운다(여러 번 호출되면 마지막 호출이 이긴다).
  function seed(initial) {
    messages = [];
    ids.clear();
    trimSuspended = false; // 새 방 시드 → 트림 정상화(이전 방의 유예 상태 초기화).
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

  // 무한 스크롤: 더 오래된 페이지(전부 현재 최솟값보다 과거, 오름차순)를 앞쪽에 덧붙인다.
  // id dedup → 경계의 중복(keyset over-fetch)이나 순서 어긋난 라이브 메시지는 건너뛴다.
  // 트림은 하지 않는다(trimSuspended=true) — 사용자가 명시적으로 불러온 과거가 라이브 유입으로
  // 잘려나가면 안 되므로. 신규로 추가된 건수를 반환. 표시 이름은 seed/add 와 동일하게 각 메시지의
  // 박제값(sender_nickname) 그대로 — 과거 prepend 가 기존 메시지 표시를 바꾸지 않는다.
  function prepend(older) {
    if (!older || !older.length) return 0;
    trimSuspended = true;
    const fresh = [];
    for (const m of older) {
      if (ids.has(m.id)) continue;
      m.mine = !!userId && m.senderUid === userId;
      applyDisplayName(m);
      fresh.push(m);
      ids.add(m.id);
    }
    if (!fresh.length) return 0;
    // older 는 전부 기존 최솟값보다 과거이므로 앞에 붙이면 오름차순이 유지된다.
    messages = [...fresh, ...messages];
    emit();
    return fresh.length;
  }

  // 바닥(near-bottom) 복귀 시 호출: 유예했던 트림을 1회 실행하고 정상 모드로 되돌린다.
  // 제거한 행 수를 반환(호출 측이 "위에 더 있음"=hasMore 복원 판단에 사용).
  // 유예 중이 아니면 no-op(스크롤 핸들러의 반복 호출에도 안전).
  function resumeTrim() {
    if (!trimSuspended) return 0;
    trimSuspended = false;
    const removed = trim();
    if (removed > 0) emit();
    return removed;
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
    prepend,
    resumeTrim,
    update,
    seed,
    start,
    stop,
    subscribe,
    get: () => messages,
  };
}
