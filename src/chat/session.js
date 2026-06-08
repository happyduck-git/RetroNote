// 채팅 세션 상태: 닉네임/clientId 영속 + 활성 방 관리.
// 활성 방은 Map<code, entry>로 관리한다. v1은 MAX_ROOMS=1로 제한하되,
// 멀티룸 확장 시 상수만 올리고 room-view에 탭/목록을 더하면 되도록 형태를 유지한다.
import { createTransport } from "./transport.js";
import { createMessageStore } from "./message-store.js";
import { normalize, isValid } from "./room-code.js";
import { SUPABASE } from "../config.js";

const NICK_KEY = "retro-chat.nick";
const CID_KEY = "retro-chat.cid";
const ROOMS_KEY = "retro-chat.rooms";
const MAX_SAVED_ROOMS = 20;
const ALIAS_MAX = 30;

export const MAX_ROOMS = 1;

export function getNickname() {
  return localStorage.getItem(NICK_KEY) || null;
}

export function setNickname(nickname) {
  localStorage.setItem(NICK_KEY, nickname);
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

export function openRoom(rawCode) {
  const code = normalize(rawCode);
  if (rooms.has(code)) return rooms.get(code);
  if (rooms.size >= MAX_ROOMS) {
    throw new Error("ROOM_LIMIT");
  }
  const clientId = getClientId();
  const store = createMessageStore(clientId);
  const transport = createTransport("supabase", SUPABASE);
  transport.on("message", (msg) => store.add(msg));
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

export function saveRoom(rawCode) {
  if (!isValid(rawCode)) return;
  const code = normalize(rawCode);
  const list = readSavedRooms();
  const now = Date.now();
  const i = list.findIndex((r) => r.code === code);
  if (i >= 0) {
    list[i] = { ...list[i], lastUsedAt: now };
  } else {
    list.push({ code, alias: "", lastUsedAt: now });
    if (list.length > MAX_SAVED_ROOMS) {
      list.sort((a, b) => b.lastUsedAt - a.lastUsedAt);
      list.length = MAX_SAVED_ROOMS;
    }
  }
  writeSavedRooms(list);
}

export function removeSavedRoom(rawCode) {
  if (!isValid(rawCode)) return;
  const code = normalize(rawCode);
  const list = readSavedRooms().filter((r) => r.code !== code);
  writeSavedRooms(list);
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
