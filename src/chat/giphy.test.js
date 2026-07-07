import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { CHAT } from "../config.js";
import { searchGifs, featuredGifs, DEFAULT_LIMIT } from "./giphy.js";

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

describe("giphy searchGifs/featuredGifs", () => {
  const realFetch = globalThis.fetch;
  const realKey = CHAT.giphyApiKey;
  beforeEach(() => { CHAT.giphyApiKey = "test-key"; });
  afterEach(() => { globalThis.fetch = realFetch; CHAT.giphyApiKey = realKey; });

  test("offset>0 이면 URL 에 offset 포함, offset=0/미지정이면 생략", async () => {
    const calls = stubFetch(() => jsonResponse({ data: [gifResult("a")] }));
    await searchGifs("cat", { offset: 24 });
    await searchGifs("cat", { offset: 0 });
    await searchGifs("cat");
    assert.equal(new URL(calls[0].url).searchParams.get("offset"), "24");
    assert.equal(new URL(calls[1].url).searchParams.get("offset"), null);
    assert.equal(new URL(calls[2].url).searchParams.get("offset"), null);
  });

  test("api_key/limit/rating/q 는 항상 포함, search 엔드포인트", async () => {
    const calls = stubFetch(() => jsonResponse({ data: [] }));
    await searchGifs("dog", { offset: 48 });
    const u = new URL(calls[0].url);
    assert.equal(u.searchParams.get("api_key"), "test-key");
    assert.equal(u.searchParams.get("limit"), String(DEFAULT_LIMIT));
    assert.equal(u.searchParams.get("rating"), "pg-13");
    assert.equal(u.searchParams.get("q"), "dog");
    assert.ok(u.pathname.endsWith("/search"));
  });

  test("빈/공백 검색어는 trending 으로 위임(offset 전달, q 없음)", async () => {
    const calls = stubFetch(() => jsonResponse({ data: [] }));
    await searchGifs("   ", { offset: 24 });
    const u = new URL(calls[0].url);
    assert.ok(u.pathname.endsWith("/trending"));
    assert.equal(u.searchParams.get("offset"), "24");
    assert.equal(u.searchParams.get("q"), null);
  });

  test("featuredGifs 는 trending + offset 배선", async () => {
    const calls = stubFetch(() => jsonResponse({ data: [] }));
    await featuredGifs({ offset: 72 });
    const u = new URL(calls[0].url);
    assert.ok(u.pathname.endsWith("/trending"));
    assert.equal(u.searchParams.get("offset"), "72");
  });

  test("429 → GiphyRateLimitError", async () => {
    stubFetch(() => jsonResponse({}, { status: 429 }));
    await assert.rejects(() => searchGifs("cat"), (e) => e.name === "GiphyRateLimitError");
  });

  test("정규화된 배열 반환(형태 유지)", async () => {
    stubFetch(() => jsonResponse({ data: [gifResult("a"), gifResult("b")] }));
    const res = await searchGifs("cat");
    assert.ok(Array.isArray(res));
    assert.equal(res.length, 2);
    assert.equal(res[0].id, "a");
    assert.equal(res[0].gifUrl, "https://x/a.gif");
  });
});
