// 채팅 세션 상태: 닉네임/clientId 영속(디바이스) + 활성 방 관리(메모리) + 저장된 방 목록.
// 메시지 영속화는 Postgres가 담당하므로 여기서는 단순 보관/생명주기만 다룬다.
import { createTransport } from "./transport.js";
import { createMessageStore } from "./message-store.js";
import { ensureMembership, fetchMessages, deleteMembership } from "./message-history.js";
import { normalize, isValid } from "./room-code.js";

const NICK_KEY = "retro-chat.nick";       // (legacy) 글로벌 닉네임 — 신규 방의 prefill 힌트로만 사용
const CID_KEY = "retro-chat.cid";
const ROOMS_KEY = "retro-chat.rooms";
const NICKS_KEY = "retro-chat.nicks";      // 방별 닉네임 { code: nickname }
const ALIAS_MAX = 30;
const NICK_MAX = 16;

// 저장된 방(로비 목록) 상한. 초과 시 사용자가 명시적으로 삭제하도록 alert.
export const MAX_SAVED_ROOMS = 10;
// 동시 활성 방 상한(메모리). UI 상 한 번에 한 방만 열리지만 안전장치로 유지.
export const MAX_ROOMS = 1;

export function getNickname() {
  return localStorage.getItem(NICK_KEY) || null;
}

export function setNickname(nickname) {
  localStorage.setItem(NICK_KEY, nickname);
}

// --- per-room nickname -----------------------------------------------------
// 각 방에 처음 입장할 때 닉네임을 받아 localStorage에 저장. 같은 방 재입장 시 자동 사용.
// 방을 로비에서 삭제하면 함께 정리.

function readRoomNicks() {
  try {
    const raw = localStorage.getItem(NICKS_KEY);
    if (!raw) return {};
    const obj = JSON.parse(raw);
    return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : {};
  } catch {
    return {};
  }
}

function writeRoomNicks(obj) {
  try {
    localStorage.setItem(NICKS_KEY, JSON.stringify(obj));
  } catch {
    // 무시: 비핵심
  }
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

// 방을 열고 DB에서 history를 fetch해 store에 seed한다.
// 멤버십이 없으면 first_joined_at=now 로 생성 → 이후 그 시점부터의 메시지만 보인다.
export async function openRoom(rawCode) {
  const code = normalize(rawCode);
  if (rooms.has(code)) return rooms.get(code);
  if (rooms.size >= MAX_ROOMS) {
    throw new Error("ROOM_LIMIT");
  }
  const clientId = getClientId();
  const store = createMessageStore(clientId);
  const transport = createTransport("supabase");
  transport.on("message", (msg) => store.add(msg));

  const firstJoinedAt = await ensureMembership(code);
  const history = await fetchMessages(code, firstJoinedAt);
  store.seed(history);

  const entry = { code, clientId, transport, store };
  rooms.set(code, entry);
  return entry;
}

export function closeRoom(rawCode) {
  const code = normalize(rawCode);
  const entry = rooms.get(code);
  if (!entry) return;
  entry.transport.leave();
  entry.store.stop();
  rooms.delete(code);
}

export function listRooms() {
  return [...rooms.keys()];
}

// --- saved rooms registry (localStorage) -----------------------------------
// 활성 세션과 별개. 사용자가 들어간 방을 기억해 lobby에서 재입장하기 위한 목적.
// 항목: { code: string, alias: string, lastUsedAt: number }

function readSavedRooms() {
  try {
    const raw = localStorage.getItem(ROOMS_KEY);
    if (!raw) return [];
    const arr = JSON.parse(raw);
    if (!Array.isArray(arr)) return [];
    return arr
      .filter((r) => r && typeof r.code === "string" && isValid(r.code))
      .map((r) => ({
        code: normalize(r.code),
        alias: typeof r.alias === "string" ? r.alias : "",
        lastUsedAt: typeof r.lastUsedAt === "number" ? r.lastUsedAt : 0,
      }));
  } catch {
    return [];
  }
}

function writeSavedRooms(list) {
  try {
    localStorage.setItem(ROOMS_KEY, JSON.stringify(list));
  } catch {
    // quota/serialization 실패 시 조용히 무시 (기능 비핵심)
  }
}

export function getSavedRooms() {
  return readSavedRooms().sort((a, b) => b.lastUsedAt - a.lastUsedAt);
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
  list[i] = { ...list[i], alias: next }; // lastUsedAt 보존 (편집은 사용으로 간주하지 않음)
  writeSavedRooms(list);
}
