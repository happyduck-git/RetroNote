// 표시 중인 메시지 목록을 소유한다. 메모리 전용 — 영속화는 Postgres가 담당.
// postgres_changes echo로 본인이 보낸 메시지도 다시 들어오므로 id 기반 dedup이 필수.
// 메시지는 도착 순서대로 append (발신자 시계 편차에 따른 재정렬은 하지 않음).
const MAX_MESSAGES = 500; // 방당 메모리 상한. 초과 시 가장 오래된 것부터 버린다.

// userId: 현재 로그인 사용자의 auth.uid. mine 판정 기준.
// 과거에는 clientId(기기별 UUID)로 판정했으나, 다른 기기에서 보낸 본인 메시지가
// "타인" 으로 표시되는 문제가 있어 senderUid 비교로 변경. clientId 는 presence 키 등에서 계속 사용.
//
// nicknameMap: Map<senderUid, currentNickname>. 방 입장 시 fetchRoomMembers 로 구성.
// 메시지 render 시 우선순위:
//   displayName = nicknameMap.get(senderUid)          (라이브 — 현재 멤버)
//              ?? latestSnapshotByUid.get(senderUid)  (그 sender 의 가장 최근 박제값)
//              ?? msg.nickname                         (최종 폴백 안전망)
// 닉네임 변경 시 messages 테이블은 무수정 — nicknameMap 의 한 엔트리 갱신만으로
// 같은 sender 의 모든 과거 메시지 표시가 즉시 갱신된다(라이브 lookup).
// 떠난 멤버(멤버십 row 없음 → nicknameMap 누락)는 그 sender 의 store 내 가장 최근 박제
// nickname 으로 통일 — 변경 히스토리가 노출되지 않도록 모든 과거 메시지를 동일 이름으로 표시.
export function createMessageStore(userId) {
  let messages = [];
  const ids = new Set();
  const subs = new Set();
  let nicknameMap = new Map();
  // senderUid → { ts, nickname } : 그 sender 가 보낸 메시지 중 가장 ts 가 큰 것의 박제 nickname.
  // add/seed 가 들어올 때마다 더 최신이면 갱신. nicknameMap 폴백으로만 사용.
  const latestSnapshotByUid = new Map();
  // 무한 스크롤로 과거를 prepend 한 동안에는 트림을 유예한다 — 라이브 메시지 유입(add)이나
  // backfill 의 trim() 이 앞쪽(오래된)에서 잘라내면 사용자가 보고 있던 과거가 사라진다.
  // prepend 가 켜고, seed(방 재시드) 가 끄고, resumeTrim(바닥 복귀) 이 1회 trim 후 끈다.
  let trimSuspended = false;

  function trackSnapshot(m) {
    if (!m.senderUid || !m.nickname) return;
    const cur = latestSnapshotByUid.get(m.senderUid);
    if (!cur || cur.ts < m.ts) {
      latestSnapshotByUid.set(m.senderUid, { ts: m.ts, nickname: m.nickname });
    }
  }

  function applyDisplayName(m) {
    const live = nicknameMap.get(m.senderUid);
    if (live) {
      m.displayName = live;
      return;
    }
    const snap = latestSnapshotByUid.get(m.senderUid);
    m.displayName = (snap && snap.nickname) || m.nickname;
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
    latestSnapshotByUid.clear();
    trimSuspended = false; // 새 방 시드 → 트림 정상화(이전 방의 유예 상태 초기화).
    // 1차 패스: 트래킹 먼저 채우기 — 이후 applyDisplayName 에서 sender 별 최신 박제값 사용.
    for (const m of initial) {
      if (ids.has(m.id)) continue;
      trackSnapshot(m);
    }
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
    const prev = latestSnapshotByUid.get(msg.senderUid);
    trackSnapshot(msg);
    const becameLatest = !prev || prev.ts < msg.ts;
    msg.mine = !!userId && msg.senderUid === userId;
    applyDisplayName(msg);
    messages.push(msg);
    ids.add(msg.id);
    trim();
    // 같은 sender 의 최신 박제값이 갱신됐다면, nicknameMap 에 없을 때 의존하는 다른 메시지들의
    // displayName 도 새 값으로 통일해야 한다(라이브 멤버는 nicknameMap 우선이라 영향 없음).
    if (becameLatest) {
      for (const m of messages) {
        if (m.senderUid === msg.senderUid && m !== msg) applyDisplayName(m);
      }
    }
    emit();
  }

  // 무한 스크롤: 더 오래된 페이지(전부 현재 최솟값보다 과거, 오름차순)를 앞쪽에 덧붙인다.
  // id dedup → 경계의 중복(keyset over-fetch)이나 순서 어긋난 라이브 메시지는 건너뛴다.
  // 트림은 하지 않는다(trimSuspended=true) — 사용자가 명시적으로 불러온 과거가 라이브 유입으로
  // 잘려나가면 안 되므로. 신규로 추가된 건수를 반환.
  // seed/add 와 동일한 mine/displayName/snapshot 규칙을 재사용한다(2-pass: 트래킹 먼저).
  function prepend(older) {
    if (!older || !older.length) return 0;
    trimSuspended = true;
    for (const m of older) {
      if (ids.has(m.id)) continue;
      trackSnapshot(m);
    }
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
    // (prepend 는 더 오래된 박제만 추가 → trackSnapshot 의 "최신만 보존" 규칙상 기존
    //  메시지의 displayName 에는 영향이 없어 재적용 불필요.)
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

  // 방 입장 시 초기 nicknameMap 세팅. 호출 후 기존 메시지 displayName 도 갱신.
  function setNicknameMap(map) {
    nicknameMap = map instanceof Map ? map : new Map();
    for (const m of messages) applyDisplayName(m);
    emit();
  }

  // 단일 멤버의 닉네임 변경 반영. 본인이 [✎]로 바꾼 직후 호출.
  // 같은 senderUid 의 모든 과거 메시지가 즉시 새 이름으로 재렌더된다.
  function updateNickname(senderUid, nickname) {
    if (!senderUid) return;
    if (nickname) nicknameMap.set(senderUid, nickname);
    else nicknameMap.delete(senderUid);
    for (const m of messages) {
      if (m.senderUid === senderUid) applyDisplayName(m);
    }
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
    prepend,
    resumeTrim,
    update,
    seed,
    start,
    stop,
    subscribe,
    setNicknameMap,
    updateNickname,
    get: () => messages,
    getNicknameMap: () => nicknameMap,
  };
}
