// Supabase Postgres에 채팅 메시지/멤버십을 영속화하기 위한 CRUD 래퍼.
// sender_uid, user_id는 DB DEFAULT auth.uid() 로 자동 채워진다(스키마 참조).
// 와이어 메시지 envelope: { id, clientId, nickname, text, ts }.
import { getClient, getCurrentUserId } from "../auth/auth.js";
import { normalize } from "./room-code.js";
import { rowToMsg } from "./supabase-mapper.js";

// 0003 이후 room_memberships SELECT 정책이 둘이다:
//   - own memberships rw   → user_id = auth.uid()
//   - memberships visible to co-members → 같은 방의 어떤 멤버든 보임
// 두 정책은 OR 로 결합되므로, 본인 row 만 원하는 select 는 .eq("user_id", uid) 로 명시해야 한다.
async function currentUid(client) {
  const { data } = await client.auth.getSession();
  return data?.session?.user?.id || null;
}

// 멤버십 보장: 없으면 first_joined_at=now 로 insert. 이미 있으면 기존 값 그대로.
// 동시 디바이스 race는 PK 충돌(23505)을 무시하고 select로 회복.
// 반환에 nickname 포함 → 호출 측에서 로컬↔서버 닉네임 동기화에 사용.
export async function ensureMembership(code) {
  const client = await getClient();
  const uid = await currentUid(client);
  const { data: existing, error: e1 } = await client
    .from("room_memberships")
    .select("first_joined_at, nickname")
    .eq("room_code", code)
    .eq("user_id", uid)
    .maybeSingle();
  if (e1) throw e1;
  if (existing) return {
    firstJoinedAt: Number(existing.first_joined_at),
    nickname: existing.nickname || null,
  };

  const now = Date.now();
  const { error: insErr } = await client
    .from("room_memberships")
    .insert({ room_code: code, first_joined_at: now });
  if (insErr && insErr.code !== "23505") throw insErr;

  // 재조회(다른 디바이스가 먼저 insert 했을 수 있음).
  const { data, error: e2 } = await client
    .from("room_memberships")
    .select("first_joined_at, nickname")
    .eq("room_code", code)
    .eq("user_id", uid)
    .single();
  if (e2) throw e2;
  return {
    firstJoinedAt: Number(data.first_joined_at),
    nickname: data.nickname || null,
  };
}

// 특정 방의 모든 멤버 (user_id, nickname) 조회.
// 0003 마이그레이션의 "memberships visible to co-members" 정책 덕에 본인이 멤버인 방에 한해
// 같은 방 멤버들의 row 가 보인다. 반환: Map<user_id, nickname>.
// nickname 이 NULL 인 row(아직 backfill 안 된 사용자)는 제외 — 호출 측은 message.sender_nickname
// snapshot 폴백을 사용하므로 누락돼도 표시가 깨지지 않는다.
export async function fetchRoomMembers(code) {
  const client = await getClient();
  const { data, error } = await client
    .from("room_memberships")
    .select("user_id, nickname")
    .eq("room_code", code);
  if (error) throw error;
  const out = new Map();
  for (const r of data) {
    if (r.user_id && r.nickname) out.set(r.user_id, r.nickname);
  }
  return out;
}

// 현재 사용자의 모든 방 멤버십 조회. 본인 row 만 필요 — 새 기기/재설치 후 로비 목록 복원에 사용.
// 0003 이후 co-member 정책으로 다른 사용자 row 도 보일 수 있어 .eq("user_id", uid) 명시 필요.
export async function fetchMemberships() {
  const client = await getClient();
  const uid = await currentUid(client);
  if (!uid) return [];
  const { data, error } = await client
    .from("room_memberships")
    .select("room_code, first_joined_at, nickname")
    .eq("user_id", uid);
  if (error) throw error;
  return data.map((r) => ({
    code: r.room_code,
    firstJoinedAt: Number(r.first_joined_at),
    nickname: r.nickname || null,
  }));
}

// 현재 사용자의 해당 방 멤버십에 nickname 컬럼을 갱신.
// RLS가 user_id=auth.uid() 로 자동 한정 → 본인 row 만 업데이트.
// 멤버십 row가 아직 없으면 0건 update 로 끝나며 에러는 아니다(이후 openRoom이 ensureMembership으로 생성).
export async function updateMembershipNickname(code, nickname) {
  const client = await getClient();
  const { error } = await client
    .from("room_memberships")
    .update({ nickname })
    .eq("room_code", code);
  if (error) throw error;
}

// 본인이 각 방에서 마지막으로 사용한 sender_nickname 을 방별로 한 번에 가져온다.
// 0002 마이그레이션 이전 사용자의 닉네임 복구 폴백.
// 반환: Map<normalized room_code, nickname>. 메시지를 한 번도 안 보낸 방은 누락.
// RLS 가 본인 멤버십 + first_joined_at<=ts 조건으로 자동 한정하므로,
// 본인이 보낸 메시지는 모두 포함된다(직접 sender_uid=auth.uid() 필터로 본인 것만 선별).
// limit: 헤비 유저의 페이로드 폭주 방지. 방별로 가장 최근 1건만 있으면 되므로
// MAX_SAVED_ROOMS(10) * 수백건 여유로 충분. ts desc 라 가장 최근 메시지들 우선.
const FALLBACK_NICK_SCAN_LIMIT = 2000;

export async function fetchMyLastNicknamesByRoom() {
  const uid = await getCurrentUserId();
  if (!uid) return new Map();
  const client = await getClient();
  const { data, error } = await client
    .from("messages")
    .select("room_code, sender_nickname, ts")
    .eq("sender_uid", uid)
    .order("ts", { ascending: false })
    .limit(FALLBACK_NICK_SCAN_LIMIT);
  if (error) {
    console.error("fetchMyLastNicknamesByRoom failed:", error);
    return new Map();
  }
  // ts desc 정렬이라 각 방에서 처음 만나는 row 가 가장 최신 → 그것만 채택.
  // 키는 normalize 해서 호출 측 lookup 키와 형태 일치를 보장.
  const out = new Map();
  for (const m of data) {
    const code = normalize(m.room_code);
    if (!out.has(code) && m.sender_nickname) {
      out.set(code, m.sender_nickname);
    }
  }
  return out;
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

