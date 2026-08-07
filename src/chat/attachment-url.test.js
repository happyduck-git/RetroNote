import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { isAllowedAttachmentUrl } from "./attachment-url.js";

const SUPA = "https://abcxyz.supabase.co";

describe("isAllowedAttachmentUrl", () => {
  test("설정된 Supabase 호스트의 URL 허용", () => {
    assert.equal(
      isAllowedAttachmentUrl(`${SUPA}/storage/v1/object/public/chat-uploads/R/a.jpg`, SUPA),
      true,
    );
  });

  test("로컬 dev Supabase(호스트+포트)도 매칭", () => {
    const local = "http://127.0.0.1:54321";
    assert.equal(isAllowedAttachmentUrl(`${local}/storage/v1/object/public/chat-uploads/R/a.png`, local), true);
  });

  test("Giphy 호스트 허용(*.giphy.com / giphy.com)", () => {
    assert.equal(isAllowedAttachmentUrl("https://media3.giphy.com/media/xxx/giphy.gif", SUPA), true);
    assert.equal(isAllowedAttachmentUrl("https://i.giphy.com/xxx.gif", SUPA), true);
    assert.equal(isAllowedAttachmentUrl("https://giphy.com/x.gif", SUPA), true);
  });

  test("그 외 임의 호스트 차단(추적 비콘 방지)", () => {
    assert.equal(isAllowedAttachmentUrl("https://evil.example/track.gif", SUPA), false);
    assert.equal(isAllowedAttachmentUrl("https://cdn.other.com/a.jpg", SUPA), false);
  });

  test("giphy 사칭 도메인 차단", () => {
    assert.equal(isAllowedAttachmentUrl("https://evilgiphy.com/x.gif", SUPA), false);
    assert.equal(isAllowedAttachmentUrl("https://giphy.com.evil.example/x.gif", SUPA), false);
    assert.equal(isAllowedAttachmentUrl("https://notgiphy.com.evil/x.gif", SUPA), false);
  });

  test("비 URL / 위험 스킴 차단", () => {
    assert.equal(isAllowedAttachmentUrl("javascript:alert(1)", SUPA), false);
    assert.equal(isAllowedAttachmentUrl("data:text/html,<script>x</script>", SUPA), false);
    assert.equal(isAllowedAttachmentUrl("not a url", SUPA), false);
    assert.equal(isAllowedAttachmentUrl("", SUPA), false);
  });

  test("supabaseUrl 이 비어도 Giphy 는 허용, 그 외엔 차단", () => {
    assert.equal(isAllowedAttachmentUrl("https://media.giphy.com/x.gif", ""), true);
    assert.equal(isAllowedAttachmentUrl(`${SUPA}/x.jpg`, ""), false);
  });
});
