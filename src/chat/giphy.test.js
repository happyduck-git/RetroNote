import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { CHAT } from "../config.js";
import { createGiphyApi, DEFAULT_LIMIT } from "./giphy.js";

// giphy.js 는 전역 fetch + CHAT.giphyApiKey 를 쓴다. 둘 다 가짜로 채워 순수 단위 테스트로 만든다.
// (CHAT 은 객체라 프로퍼티 mutation 이 import 를 가로질러 공유된다.)
function stubFetch(impl) {
  const calls = [];
  globalThis.fetch = (url, opts) => {
    calls.push({ url: String(url), opts });
    return Promise.resolve(impl({ url: String(url), opts }));
  };
  return calls;
}

function jsonResponse(data, { status = 200 } = {}) {
  return { ok: status >= 200 && status < 300, status, json: () => Promise.resolve(data) };
}

// data.data 항목이 normalize 를 통과하도록 최소 이미지 렌디션을 채운다.
function gifResult(id) {
  return {
    id,
    title: `t${id}`,
    images: {
      fixed_width_small: { url: `https://x/${id}.gif`, width: "100", height: "80", size: "1234" },
    },
  };
}

const gifs = createGiphyApi("gifs");
const stickers = createGiphyApi("stickers");

describe("giphy createGiphyApi(\"gifs\")", () => {
  const realFetch = globalThis.fetch;
  const realKey = CHAT.giphyApiKey;
  beforeEach(() => { CHAT.giphyApiKey = "test-key"; });
  afterEach(() => { globalThis.fetch = realFetch; CHAT.giphyApiKey = realKey; });

  test("offset>0 이면 URL 에 offset 포함, offset=0/미지정이면 생략", async () => {
    const calls = stubFetch(() => jsonResponse({ data: [gifResult("a")] }));
    await gifs.search("cat", { offset: 24 });
    await gifs.search("cat", { offset: 0 });
    await gifs.search("cat");
    assert.equal(new URL(calls[0].url).searchParams.get("offset"), "24");
    assert.equal(new URL(calls[1].url).searchParams.get("offset"), null);
    assert.equal(new URL(calls[2].url).searchParams.get("offset"), null);
  });

  test("api_key/limit/rating/q 는 항상 포함, gifs/search 엔드포인트", async () => {
    const calls = stubFetch(() => jsonResponse({ data: [] }));
    await gifs.search("dog", { offset: 48 });
    const u = new URL(calls[0].url);
    assert.equal(u.searchParams.get("api_key"), "test-key");
    assert.equal(u.searchParams.get("limit"), String(DEFAULT_LIMIT));
    assert.equal(u.searchParams.get("rating"), "pg-13");
    assert.equal(u.searchParams.get("q"), "dog");
    assert.equal(u.pathname, "/v1/gifs/search");
  });

  test("빈/공백 검색어는 trending 으로 위임(offset 전달, q 없음)", async () => {
    const calls = stubFetch(() => jsonResponse({ data: [] }));
    await gifs.search("   ", { offset: 24 });
    const u = new URL(calls[0].url);
    assert.equal(u.pathname, "/v1/gifs/trending");
    assert.equal(u.searchParams.get("offset"), "24");
    assert.equal(u.searchParams.get("q"), null);
  });

  test("429 → GiphyRateLimitError", async () => {
    stubFetch(() => jsonResponse({}, { status: 429 }));
    await assert.rejects(() => gifs.search("cat"), (e) => e.name === "GiphyRateLimitError");
  });

  test("정규화된 배열 반환(형태 유지)", async () => {
    stubFetch(() => jsonResponse({ data: [gifResult("a"), gifResult("b")] }));
    const res = await gifs.search("cat");
    assert.ok(Array.isArray(res));
    assert.equal(res.length, 2);
    assert.equal(res[0].id, "a");
    assert.equal(res[0].gifUrl, "https://x/a.gif");
  });
});

describe("giphy createGiphyApi(\"stickers\")", () => {
  const realFetch = globalThis.fetch;
  const realKey = CHAT.giphyApiKey;
  beforeEach(() => { CHAT.giphyApiKey = "test-key"; });
  afterEach(() => { globalThis.fetch = realFetch; CHAT.giphyApiKey = realKey; });

  test("kind 가 경로 첫 조각을 가른다 — stickers/search", async () => {
    const calls = stubFetch(() => jsonResponse({ data: [] }));
    await stickers.search("cat");
    assert.equal(new URL(calls[0].url).pathname, "/v1/stickers/search");
  });

  test("빈 검색어는 stickers/trending 으로 위임", async () => {
    const calls = stubFetch(() => jsonResponse({ data: [] }));
    await stickers.search("", { offset: 48 });
    const u = new URL(calls[0].url);
    assert.equal(u.pathname, "/v1/stickers/trending");
    assert.equal(u.searchParams.get("offset"), "48");
    assert.equal(u.searchParams.get("q"), null);
  });

  test("api_key/limit/rating 은 GIF 와 동일하게 붙는다", async () => {
    const calls = stubFetch(() => jsonResponse({ data: [] }));
    await stickers.search("dog");
    const u = new URL(calls[0].url);
    assert.equal(u.searchParams.get("api_key"), "test-key");
    assert.equal(u.searchParams.get("limit"), String(DEFAULT_LIMIT));
    assert.equal(u.searchParams.get("rating"), "pg-13");
  });

  test("429 → GiphyRateLimitError", async () => {
    stubFetch(() => jsonResponse({}, { status: 429 }));
    await assert.rejects(() => stickers.search("cat"), (e) => e.name === "GiphyRateLimitError");
  });

  test("응답 정규화는 GIF 와 같은 경로를 탄다", async () => {
    stubFetch(() => jsonResponse({ data: [gifResult("s1")] }));
    const res = await stickers.search("cat");
    assert.equal(res.length, 1);
    assert.equal(res[0].id, "s1");
    assert.equal(res[0].gifUrl, "https://x/s1.gif");
  });

  test("두 인스턴스는 서로의 경로를 오염시키지 않는다", async () => {
    const calls = stubFetch(() => jsonResponse({ data: [] }));
    await stickers.search("cat");
    await gifs.search("cat");
    assert.equal(new URL(calls[0].url).pathname, "/v1/stickers/search");
    assert.equal(new URL(calls[1].url).pathname, "/v1/gifs/search");
  });
});
