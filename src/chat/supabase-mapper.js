// Supabase row <-> wire envelope 변환. message-history(fetch)와 supabase-transport(postgres_changes)가 공유.
export function rowToMsg(row) {
  return {
    id: row.id,
    clientId: row.sender_client_id,
    senderUid: row.sender_uid,
    nickname: row.sender_nickname,
    text: row.text,
    ts: Number(row.ts),
  };
}
