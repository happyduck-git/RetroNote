// Supabase row <-> wire envelope 변환. message-history(fetch)와 supabase-transport(postgres_changes)가 공유.
// attachment_* 컬럼이 있으면 attachment 서브객체로 묶어 노출 — 없으면 attachment 키 자체가 없음.
// 0005 이전 row 는 attachment_url=NULL 이라 자연스럽게 attachment 가 없는 것으로 매핑된다.
export function rowToMsg(row) {
  const msg = {
    id: row.id,
    clientId: row.sender_client_id,
    senderUid: row.sender_uid,
    nickname: row.sender_nickname,
    text: row.text || "",
    ts: Number(row.ts),
  };
  if (row.attachment_url) {
    msg.attachment = {
      url: row.attachment_url,
      kind: row.attachment_kind,
      mime: row.attachment_mime,
      width: row.attachment_w,
      height: row.attachment_h,
      bytes: row.attachment_bytes,
    };
  }
  return msg;
}
