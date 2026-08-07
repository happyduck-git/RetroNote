import { test } from "node:test";
import assert from "node:assert/strict";
import { rowToMsg } from "./supabase-mapper.js";

function baseRow(extra = {}) {
  return {
    id: "m1",
    sender_client_id: "c1",
    sender_uid: "u1",
    sender_nickname: "닉",
    text: "hello",
    ts: "1700000000000",
    ...extra,
  };
}

test("rowToMsg: 컬럼명을 wire envelope 키로 변환", () => {
  const msg = rowToMsg(baseRow());
  assert.equal(msg.id, "m1");
  assert.equal(msg.clientId, "c1");
  assert.equal(msg.senderUid, "u1");
  assert.equal(msg.nickname, "닉");
  assert.equal(msg.text, "hello");
});

test("rowToMsg: text 가 falsy 면 빈 문자열로", () => {
  assert.equal(rowToMsg(baseRow({ text: null })).text, "");
  assert.equal(rowToMsg(baseRow({ text: "" })).text, "");
  assert.equal(rowToMsg(baseRow({ text: undefined })).text, "");
});

test("rowToMsg: ts 는 항상 Number 로 변환", () => {
  const msg = rowToMsg(baseRow({ ts: "1700000000000" }));
  assert.equal(typeof msg.ts, "number");
  assert.equal(msg.ts, 1700000000000);
});

test("rowToMsg: attachment_url 이 없으면 attachment 키 자체가 없다 (0005 이전 row)", () => {
  assert.equal("attachment" in rowToMsg(baseRow()), false); // 컬럼 자체가 없는 row
  assert.equal("attachment" in rowToMsg(baseRow({ attachment_url: null })), false);
});

test("rowToMsg: attachment_url 이 있으면 서브객체로 묶고 모든 attachment_* 필드 매핑", () => {
  const msg = rowToMsg(
    baseRow({
      attachment_url: "https://x.supabase.co/o/a.jpg",
      attachment_kind: "image",
      attachment_mime: "image/jpeg",
      attachment_w: 200,
      attachment_h: 100,
      attachment_bytes: 12345,
    }),
  );
  assert.deepEqual(msg.attachment, {
    url: "https://x.supabase.co/o/a.jpg",
    kind: "image",
    mime: "image/jpeg",
    width: 200,
    height: 100,
    bytes: 12345,
  });
});
