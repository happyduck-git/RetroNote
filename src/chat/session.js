// 채팅 세션 상태: 닉네임/clientId 영속 + 활성 방 관리.
// 활성 방은 Map<code, entry>로 관리한다. v1은 MAX_ROOMS=1로 제한하되,
// 멀티룸 확장 시 상수만 올리고 room-view에 탭/목록을 더하면 되도록 형태를 유지한다.
import { createTransport } from "./transport.js";
import { createMessageStore } from "./message-store.js";
import { normalize } from "./room-code.js";
import { SUPABASE } from "../config.js";

const NICK_KEY = "retro-chat.nick";
const CID_KEY = "retro-chat.cid";

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
