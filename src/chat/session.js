// 채팅 세션 상태: 닉네임/clientId 영속(디바이스) + 활성 방 관리(메모리) + 저장된 방 목록.
// 메시지 영속화는 Postgres가 담당하므로 여기서는 단순 보관/생명주기만 다룬다.
import { createTransport } from "./transport.js";
import { createMessageStore } from "./message-store.js";
import { ensureMembership, fetchMessages, deleteMembership, fetchMemberships, updateMembershipNickname, updateMembershipAlias, fetchMyLastNicknamesByRoom, fetchRoomMembers } from "./message-history.js";
import { createBackfiller } from "./backfill.js";
import { normalize, isValid } from "./room-code.js";
import { getCurrentUserId } from "../auth/auth.js";

const NICK_KEY = "retro-chat.nick";       // (legacy) 글로벌 닉네임 — 신규 방의 prefill 힌트로만 사용
const CID_KEY = "retro-chat.cid";
const ROOMS_KEY = "retro-chat.rooms";
const NICKS_KEY = "retro-chat.nicks";      // 방별 닉네임 { code: nickname }
const LAST_UID_KEY = "retro-chat.last_uid"; // 마지막 로그인 user_id 추적 — 사용자 전환 감지용
const ALIAS_MAX = 30;
const NICK_MAX = 16;

// 저장된 방(로비 목록) 상한. 초과 시 사용자가 명시적으로 삭제하도록 alert.
export const MAX_SAVED_ROOMS = 10;
// 동시 활성 방 상한(메모리). UI 상 한 번에 한 방만 열리지만 안전장치로 유지.
const MAX_ROOMS = 1;

export function getNickname() {
  return localStorage.getItem(NICK_KEY) || null;
}

// --- session-scope guard ---------------------------------------------------
// A 계정 로그아웃 후 B 계정 로그인 시 A 의 device-local 데이터(방 목록/닉네임/alias)가
// B 화면에 노출되지 않도록 정리한다. CID(디바이스 ID)는 사용자와 무관해서 보존한다.
// 다음 lobby 진입 시 syncRoomsFromServer 가 DB 에서 본인 멤버십을 자동 복원해 채운다.
export function clearLocalSession() {
  localStorage.removeItem(ROOMS_KEY);
  localStorage.removeItem(NICKS_KEY);
  localStorage.removeItem(NICK_KEY);
}

export function getLastUid() {
  return localStorage.getItem(LAST_UID_KEY) || null;
}

export function setLastUid(uid) {
  if (uid) localStorage.setItem(LAST_UID_KEY, uid);
  else localStorage.removeItem(LAST_UID_KEY);
}

// --- per-room nickname -----------------------------------------------------
// 각 방에 처음 입장할 때 닉네임을 받아 localStorage에 저장. 같은 방 재입장 시 자동 사용.
// 방을 로비에서 삭제하면 함께 정리.

function lsGetJSON(key, fallback) {
  try { const v = JSON.parse(localStorage.getItem(key)); return v ?? fallback; } catch { return fallback; }
}

function lsSetJSON(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function readRoomNicks() {
  const obj = lsGetJSON(NICKS_KEY, null);
  return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
}

function writeRoomNicks(obj) {
  lsSetJSON(NICKS_KEY, obj);
}

export function getRoomNickname(rawCode) {
  if (!isValid(rawCode)) return null;
  const code = normalize(rawCode);
  const v = readRoomNicks()[code];
  return typeof v === "string" && v ? v : null;
}

export function setRoomNickname(rawCode, nickname) {
  if (!isValid(rawCode)) return;
  const code = normalize(rawCode);
  const next = String(nickname || "").trim().slice(0, NICK_MAX);
  if (!next) return;
  const obj = readRoomNicks();
  obj[code] = next;
  writeRoomNicks(obj);
}

function removeRoomNickname(code) {
  const obj = readRoomNicks();
  if (code in obj) {
    delete obj[code];
    writeRoomNicks(obj);
  }
}

export function getClientId() {
  let id = localStorage.getItem(CID_KEY);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(CID_KEY, id);
  }
  return id;
}

const rooms = new Map(); // code -> { code, clientId, transport, store }

// transport/store를 만들고 message → store 연결만 한다(네트워크 connect는 호출 측에서).
function createRoomChannels(userId) {
  const store = createMessageStore(userId);
  const transport = createTransport("supabase");
  transport.on("message", (msg) => store.add(msg));
  return { store, transport };
}

// 로컬↔서버 방별 닉네임 양방향 동기화(best-effort, 실패해도 다음 진입 시 재시도):
//  - 로컬 O, 서버 NULL → 서버로 push (기존 사용자 첫 진입 시 backfill)
//  - 로컬 X, 서버 O → 로컬에 채움 (다른 기기 첫 진입 시)
//  - 로컬 O, 서버 O, 다름 → 서버 우선: 로컬을 서버 값으로 덮어쓰기.
//      Why: 다른 기기에서 변경된 닉네임이 우선 반영되어야 함. 오프라인 변경은 다음 sync 에서
//      손실 가능 — 정상 거동(스펙: LWW 비용 대비 효용 낮아 보류).
function syncMembershipNickname(code, localNick, serverNick) {
  if (localNick && !serverNick) {
    updateMembershipNickname(code, localNick).catch((e) => {
      console.error("nickname backfill to server failed:", e);
    });
  } else if (serverNick && !localNick) {
    setRoomNickname(code, serverNick);
  } else if (serverNick && localNick && serverNick !== localNick) {
    setRoomNickname(code, serverNick);
  }
}

// 방을 열고 DB에서 history를 fetch해 store에 seed한다.
// 멤버십이 없으면 first_joined_at=now 로 생성 → 이후 그 시점부터의 메시지만 보인다.
// 또한 방의 모든 멤버 (user_id → nickname) 맵을 fetchRoomMembers 로 가져와 store 에 주입 →
// 메시지 표시가 라이브 lookup 기반이 된다(닉네임 변경 즉시 과거 메시지도 새 이름).
export async function openRoom(rawCode) {
  const code = normalize(rawCode);
  if (rooms.has(code)) return rooms.get(code);
  if (rooms.size >= MAX_ROOMS) {
    throw new Error("ROOM_LIMIT");
  }
  const clientId = getClientId();
  const userId = await getCurrentUserId();
  const { store, transport } = createRoomChannels(userId);

  const { firstJoinedAt, nickname: serverNick } = await ensureMembership(code);
  syncMembershipNickname(code, getRoomNickname(code), serverNick);

  // 방의 모든 멤버 nicknameMap 구성. 실패해도 본 흐름은 정상 — snapshot 폴백이 받쳐준다.
  const nicknameMap = await fetchRoomMembers(code).catch((e) => {
    console.error("fetchRoomMembers failed:", e);
    return new Map();
  });
  store.setNicknameMap(nicknameMap);

  const history = await fetchMessages(code, firstJoinedAt);
  store.seed(history);

  const backfill = createBackfiller({ store, fetchMessages, firstJoinedAt, code });

  // firstJoinedAt은 재연결/visibility 복귀 시 갭필(fetchMessages) 의 fallback sinceTs로 사용.
  // userId 는 changeRoomNickname 에서 nicknameMap 자기 엔트리 갱신용 + room-view 에서 senderUid 채움용.
  const entry = { code, clientId, userId, transport, store, firstJoinedAt, backfill };
  rooms.set(code, entry);
  return entry;
}

// 활성 방의 닉네임을 즉시 변경. 로컬 + 서버 + 활성 store 의 nicknameMap +
// transport.track(presence) 까지 한꺼번에 갱신해서 본인 화면에 즉시 반영.
// 거절: 빈 값 또는 16자 초과 → throw INVALID_NICK. 활성 방 아니면 throw NOT_OPEN.
// 같은 값이면 no-op 으로 통과(불필요한 서버 호출/이벤트 emit 방지).
// 다른 기기 실시간 반영은 별도 issue (postgres_changes UPDATE 구독) — 본 함수는 본인 기기 한정.
//
// 의존성 주입 factory 로 표현 → 테스트에서 fake rooms/storage/server 로 동작 검증 가능.
// 기본 export 인 changeRoomNickname 은 실제 모듈 상태(rooms 등) 로 빌드한 인스턴스.
export function makeChangeRoomNickname({
  rooms,
  getRoomNickname,
  setRoomNickname,
  updateMembershipNickname,
}) {
  return async function changeRoomNickname(rawCode, newNick) {
    if (!isValid(rawCode)) throw new Error("INVALID_CODE");
    const code = normalize(rawCode);
    const trimmed = String(newNick || "").trim();
    if (!trimmed || trimmed.length > NICK_MAX) throw new Error("INVALID_NICK");
    const entry = rooms.get(code);
    if (!entry) throw new Error("NOT_OPEN");
    const current = getRoomNickname(code);
    if (current === trimmed) return;

    // 1. 로컬 영속화 (실패하면 사용자가 다시 시도 — 서버 호출 전이라 안전).
    setRoomNickname(code, trimmed);
    // 2. store 라이브 lookup 즉시 갱신 → 본인 화면의 과거 메시지 표시 이름 변경.
    entry.store.updateNickname(entry.userId, trimmed);
    // 3. presence track 재호출 → 다른 멤버의 온라인 사용자 표시(향후 nickname 사용 시) 갱신.
    entry.transport.track({ nickname: trimmed });
    // 4. 서버 영속화. 실패해도 로컬은 이미 갱신 — 다음 openRoom 의 양방향 sync 가 복구한다.
    try {
      await updateMembershipNickname(code, trimmed);
    } catch (e) {
      console.error("updateMembershipNickname failed:", e);
      throw e;
    }
  };
}

export const changeRoomNickname = makeChangeRoomNickname({
  rooms,
  getRoomNickname,
  setRoomNickname,
  updateMembershipNickname,
});

export function closeRoom(rawCode) {
  const code = normalize(rawCode);
  const entry = rooms.get(code);
  if (!entry) return;
  entry.transport.leave();
  entry.store.stop();
  rooms.delete(code);
}

// --- saved rooms registry (localStorage) -----------------------------------
// 활성 세션과 별개. 사용자가 들어간 방을 기억해 lobby에서 재입장하기 위한 목적.
// 항목: { code: string, alias: string, lastUsedAt: number }

function readSavedRooms() {
  const arr = lsGetJSON(ROOMS_KEY, null);
  if (!Array.isArray(arr)) return [];
  return arr
    .filter((r) => r && typeof r.code === "string" && isValid(r.code))
    .map((r) => ({
      code: normalize(r.code),
      alias: typeof r.alias === "string" ? r.alias : "",
      lastUsedAt: typeof r.lastUsedAt === "number" ? r.lastUsedAt : 0,
    }));
}

function writeSavedRooms(list) {
  lsSetJSON(ROOMS_KEY, list);
}

export function getSavedRooms() {
  return readSavedRooms().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
}

// 한 멤버십에 대해 로컬 닉네임이 비어 있으면 server.nickname → 메시지 폴백 순으로 채우고,
// 폴백을 썼다면 서버 컬럼도 backfill. 닉네임을 채웠으면 true.
function restoreNicknameFromMembership(code, membership, localNicks, fallbackNicks) {
  if (localNicks[code]) return false;
  const resolved = membership.nickname || fallbackNicks.get(code) || null;
  if (!resolved) return false;
  localNicks[code] = resolved;
  // 폴백을 썼다면 서버 컬럼도 채워둔다 → 다른 기기/다음 sync 가 즉시 사용.
  if (!membership.nickname) {
    updateMembershipNickname(code, resolved).catch((e) => {
      console.error("nickname backfill from messages failed:", e);
    });
  }
  return true;
}

// 이미 로컬 목록에 있는 방의 alias 를 서버와 reconcile(nickname 과 동일한 server-priority 정책):
//  - 로컬 O, 서버 NULL → 서버로 push(backfill). 로컬은 그대로 → list 변경 없음.
//  - 서버 O, 로컬과 다름 → 로컬을 서버 값으로 덮어쓰기 → list 변경(true).
// updateMembershipAlias 는 콜백이 없어 sync 를 재호출하지 않는다 → 재귀/루프 위험 없음.
// 오프라인 로컬 변경이 서버에 push 되기 전이라면 다음 sync 에서 손실 가능(nickname 과 동일한
// 의도된 trade-off — 아래 setRoomAlias 의 best-effort push 가 정상 경로에서 이를 막는다).
function reconcileAlias(entry, code, membership) {
  const localAlias = entry.alias || "";
  const serverAlias = membership.alias || "";
  if (localAlias && !serverAlias) {
    updateMembershipAlias(code, localAlias).catch((e) => {
      console.error("alias backfill to server failed:", e);
    });
    return false;
  }
  if (serverAlias && serverAlias !== localAlias) {
    entry.alias = serverAlias;
    return true;
  }
  return false;
}

// 서버(room_memberships)의 멤버십을 로컬 방 목록에 병합한다.
// 새 기기/재설치 후 로그인하면 localStorage가 비어 로비가 빈다 → 서버에서 복원.
// alias(개인 라벨)와 nickname 모두 서버 영속화되므로 로컬에 채우고/서버와 reconcile 한다
//   → 다른 기기에서 같은 계정 로그인 시 방 이름·닉네임이 보존된다.
// 0002 이전부터 사용해 온 사용자는 서버 nickname이 NULL이므로, 본인 메시지의
// sender_nickname을 폴백으로 복구한다(한 번이라도 메시지를 보낸 방에 한해).
// MAX_SAVED_ROOMS 상한을 지키며, first_joined_at 최신순으로 우선 채운다.
// 반환: 방 목록(추가/별명)이 하나라도 바뀌면 true(호출 측에서 재렌더 판단용).
export async function syncRoomsFromServer() {
  const memberships = await fetchMemberships();
  if (!memberships.length) return false;
  // 상한 초과 시 최근 입장한 방부터 복원되도록 정렬.
  memberships.sort((a, b) => (b.firstJoinedAt || 0) - (a.firstJoinedAt || 0));

  const list = readSavedRooms();
  const byCode = new Map(list.map((r) => [r.code, r]));
  const localNicks = readRoomNicks();
  // 폴백 조회는 1회만(N+1 회피). 실패 시 빈 Map → 폴백 효과만 사라지고 본 흐름은 정상.
  const fallbackNicks = await fetchMyLastNicknamesByRoom().catch(() => new Map());

  let changed = false;
  let nicksChanged = false;
  for (const m of memberships) {
    if (!isValid(m.code)) continue;
    const code = normalize(m.code);
    if (restoreNicknameFromMembership(code, m, localNicks, fallbackNicks)) nicksChanged = true;

    const existing = byCode.get(code);
    if (existing) {
      // 이미 로컬에 있는 방: alias 만 서버와 reconcile(목록 추가는 아님).
      if (reconcileAlias(existing, code, m)) changed = true;
      continue;
    }
    if (list.length >= MAX_SAVED_ROOMS) continue;
    const entry = { code, alias: m.alias || "", lastUsedAt: m.firstJoinedAt || 0 };
    list.push(entry);
    byCode.set(code, entry);
    changed = true;
  }
  if (changed) writeSavedRooms(list);
  if (nicksChanged) writeRoomNicks(localNicks);
  return changed;
}

// 방을 새로 추가 가능한지 확인. 이미 목록에 있는 코드 재입장은 항상 허용.
export function canAddRoom(rawCode) {
  if (!isValid(rawCode)) return false;
  const code = normalize(rawCode);
  const list = readSavedRooms();
  if (list.some((r) => r.code === code)) return true;
  return list.length < MAX_SAVED_ROOMS;
}

export function saveRoom(rawCode) {
  if (!isValid(rawCode)) return;
  const code = normalize(rawCode);
  const list = readSavedRooms();
  const now = Date.now();
  const i = list.findIndex((r) => r.code === code);
  if (i >= 0) {
    list[i] = { ...list[i], lastUsedAt: now };
  } else {
    if (list.length >= MAX_SAVED_ROOMS) return; // 상한 초과 — 호출 측에서 사전 차단 권장
    list.push({ code, alias: "", lastUsedAt: now });
  }
  writeSavedRooms(list);
}

// 사용자가 로비에서 방을 제거. 로컬 목록에서 빼고 DB 멤버십도 삭제하여
// 다음 입장 시 새 first_joined_at 으로 시작(이전 메시지 안 보임).
// DB 메시지 자체는 다른 멤버를 위해 남겨둔다.
export async function removeSavedRoom(rawCode) {
  if (!isValid(rawCode)) return;
  const code = normalize(rawCode);
  const list = readSavedRooms().filter((r) => r.code !== code);
  writeSavedRooms(list);
  removeRoomNickname(code);
  try {
    await deleteMembership(code);
  } catch (e) {
    console.error("delete membership failed:", e);
    // 로컬 목록은 이미 제거됨. DB 멤버십 정리는 다음 기회에 다시 시도해도 됨.
  }
}

export function setRoomAlias(rawCode, alias) {
  if (!isValid(rawCode)) return;
  const code = normalize(rawCode);
  const list = readSavedRooms();
  const i = list.findIndex((r) => r.code === code);
  if (i < 0) return;
  const next = String(alias || "").trim().slice(0, ALIAS_MAX);
  if ((list[i].alias || "") === next) return; // 값 변경 없으면 서버 호출 생략
  list[i] = { ...list[i], alias: next }; // lastUsedAt 보존 (편집은 사용으로 간주하지 않음)
  writeSavedRooms(list);
  // 서버 영속화(best-effort) → 다른 기기에서 같은 계정 로그인 시 syncRoomsFromServer 가 복원.
  // 실패해도 로컬은 이미 갱신 — 다음 sync 의 reconcile 이 서버를 backfill 한다.
  // updateMembershipAlias 는 콜백이 없어 재귀/루프 위험 없음(빈 값은 NULL 로 저장 → 별명 삭제 동기화).
  updateMembershipAlias(code, next).catch((e) => {
    console.error("alias persist to server failed:", e);
  });
}
