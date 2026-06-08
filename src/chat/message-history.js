// Supabase Postgres에 채팅 메시지/멤버십을 영속화하기 위한 CRUD 래퍼.
// sender_uid, user_id는 DB DEFAULT auth.uid() 로 자동 채워진다(스키마 참조).
// 와이어 메시지 envelope: { id, clientId, nickname, text, ts }.
import { getClient } from "../auth/auth.js";

function rowToMsg(row) {
  return {
    id: row.id,
    clientId: row.sender_client_id,
    nickname: row.sender_nickname,
    text: row.text,
    ts: Number(row.ts),
  };
}

// 멤버십 보장: 없으면 first_joined_at=now 로 insert. 이미 있으면 기존 값 그대로.
// 동시 디바이스 race는 PK 충돌(23505)을 무시하고 select로 회복.
export async function ensureMembership(code) {
  const client = await getClient();
  const { data: existing, error: e1 } = await client
    .from("room_memberships")
    .select("first_joined_at")
    .eq("room_code", code)
    .maybeSingle();
  if (e1) throw e1;
  if (existing) return Number(existing.first_joined_at);

  const now = Date.now();
  const { error: insErr } = await client
    .from("room_memberships")
    .insert({ room_code: code, first_joined_at: now });
  if (insErr && insErr.code !== "23505") throw insErr;

  // 재조회(다른 디바이스가 먼저 insert 했을 수 있음).
  const { data, error: e2 } = await client
    .from("room_memberships")
    .select("first_joined_at")
    .eq("room_code", code)
    .single();
  if (e2) throw e2;
  return Number(data.first_joined_at);
}

export async function fetchMessages(code, sinceTs) {
  const client = await getClient();
  const { data, error } = await client
    .from("messages")
    .select("*")
    .eq("room_code", code)
    .gte("ts", sinceTs)
    .order("ts", { ascending: true });
  if (error) throw error;
  return data.map(rowToMsg);
}

export async function insertMessage(msg, code) {
  const client = await getClient();
  const { error } = await client.from("messages").insert({
    id: msg.id,
    room_code: code,
    sender_client_id: msg.clientId,
    sender_nickname: msg.nickname,
    text: msg.text,
    ts: msg.ts,
  });
  if (error) throw error;
}

// 사용자가 로비 목록에서 방을 제거할 때 호출. 본인의 멤버십만 삭제 → 본인 시야에서만
// 과거 메시지가 가려진다(다른 멤버에게는 영향 없음). 다시 방에 입장하면 새 first_joined_at 으로
// 그 이후 메시지만 보이게 된다.
export async function deleteMembership(code) {
  const client = await getClient();
  const { error } = await client.from("room_memberships").delete().eq("room_code", code);
  if (error) throw error;
}

// 와이어 row → envelope 변환은 transport(postgres_changes)에서도 재사용.
export { rowToMsg };
