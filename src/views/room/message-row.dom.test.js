import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";

// message-row → opener.js 가 모듈 로드 시점에 window.__TAURI__ 를 읽는다.
// → import 전에 jsdom window/document 를 전역에 심어야 한다(동적 import).
const dom = new JSDOM("<!doctype html><html><body></body></html>");
const saved = { window: globalThis.window, document: globalThis.document };
globalThis.window = dom.window;
globalThis.document = dom.window.document;

const { renderMessageRow, renderMessageText, renderDateDivider } = await import("./message-row.js");
const { SUPABASE } = await import("../../config.js");
SUPABASE.url = "https://x.supabase.co"; // allowlist(attachment-url)가 이 호스트를 허용하도록 설정

after(() => {
  globalThis.window = saved.window;
  globalThis.document = saved.document;
  dom.window.close();
});

function msg(extra = {}) {
  return { id: "m1", ts: 0, mine: false, nickname: "닉", text: "hi", ...extra };
}

describe("renderMessageText: 링크는 http(s) 토큰에만 생긴다", () => {
  test("일반 텍스트는 텍스트 노드만, <a> 없음", () => {
    const nodes = renderMessageText("just plain text");
    assert.equal(nodes.filter((n) => n.nodeName === "A").length, 0);
    assert.equal(nodes.map((n) => n.textContent).join(""), "just plain text");
  });

  test("http(s) URL 은 <a class=msg-link href=URL> 로 변환", () => {
    const nodes = renderMessageText("go https://example.com now");
    const anchors = nodes.filter((n) => n.nodeName === "A");
    assert.equal(anchors.length, 1);
    assert.equal(anchors[0].getAttribute("href"), "https://example.com");
    assert.ok(anchors[0].className.includes("msg-link"));
  });

  test("javascript:/data:/file: 스킴은 링크가 되지 않는다", () => {
    for (const hostile of [
      "javascript:alert(1)",
      "data:text/html,<script>x</script>",
      "file:///etc/passwd",
    ]) {
      const nodes = renderMessageText(hostile);
      assert.equal(
        nodes.filter((n) => n.nodeName === "A").length,
        0,
        `'${hostile}' 는 링크가 되면 안 된다`,
      );
    }
  });
});

describe("renderMessageRow: 적대적 입력은 텍스트로만 삽입(HTML 미해석)", () => {
  test("메시지 본문의 HTML 은 해석되지 않는다", () => {
    const row = renderMessageRow(msg({ text: "<img src=x onerror=alert(1)>" }));
    const textEl = row.querySelector(".msg-text");
    assert.ok(textEl);
    assert.equal(textEl.querySelectorAll("*").length, 0, "자식 엘리먼트가 생기면 안 된다");
    assert.equal(textEl.textContent, "<img src=x onerror=alert(1)>");
  });

  test("닉네임의 HTML 도 해석되지 않는다", () => {
    const row = renderMessageRow(msg({ nickname: "<b>evil</b>", mine: false }));
    const who = row.querySelector(".msg-who");
    assert.equal(who.querySelectorAll("*").length, 0);
    assert.equal(who.textContent, "<b>evil</b>");
  });

  test("본인 메시지는 닉네임과 무관하게 'you'", () => {
    const row = renderMessageRow(msg({ mine: true, nickname: "무시됨" }));
    assert.equal(row.querySelector(".msg-who").textContent, "you");
  });
});

describe("renderMessageRow: 첨부 렌더 + 호스트 allowlist", () => {
  test("허용 호스트(Supabase)면 img.src 세팅 + data-kind + has-attach", () => {
    const url = "https://x.supabase.co/storage/v1/object/public/chat-uploads/R/a.jpg";
    const row = renderMessageRow(
      msg({ text: "", attachment: { url, kind: "image", width: 200, height: 100 } }),
    );
    const img = row.querySelector("img.msg-image");
    assert.ok(img);
    assert.equal(img.getAttribute("src"), url);
    assert.equal(row.querySelector(".msg-image-wrap").dataset.kind, "image");
    assert.ok(row.className.includes("has-attach"));
  });

  test("허용 호스트(Giphy) gif_external 도 img 로 렌더", () => {
    const url = "https://media3.giphy.com/media/xxx/giphy.gif";
    const row = renderMessageRow(msg({ text: "", attachment: { url, kind: "gif_external" } }));
    const img = row.querySelector("img.msg-image");
    assert.ok(img);
    assert.equal(img.getAttribute("src"), url);
  });

  test("허용되지 않은 호스트면 img 를 만들지 않고 차단 표시(추적 비콘 방지)", () => {
    const url = "https://evil.example/track.gif";
    const row = renderMessageRow(msg({ text: "", attachment: { url, kind: "gif_external" } }));
    assert.equal(row.querySelector("img.msg-image"), null, "요청을 유발하는 img 가 없어야 한다");
    const broken = row.querySelector(".msg-image-broken");
    assert.ok(broken);
    assert.equal(broken.textContent, "[ × blocked ]");
    assert.ok(row.className.includes("has-attach")); // wrap 은 존재
  });
});

describe("renderDateDivider", () => {
  test("dataset.id 는 date-<yyyy-mm-dd>, 텍스트는 날짜 문자열", () => {
    const div = renderDateDivider("2026-08-06");
    assert.ok(div.className.includes("msg-date-divider"));
    assert.equal(div.dataset.id, "date-2026-08-06");
    assert.equal(div.querySelector(".msg-date-divider-text").textContent, "2026-08-06");
  });
});
