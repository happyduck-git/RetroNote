import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { CHAT } from "../config.js";
import { createGiphyApi, DEFAULT_LIMIT, resetGiphyCooldown } from "./giphy.js";

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

// console.warn 을 잠시 가로채 기록만 하고 테스트 출력이 지저분해지지 않게 한다.
function withWarnSpy(fn) {
  const seen = [];
  const real = console.warn;
  console.warn = (m) => seen.push(m);
  const done = () => { console.warn = real; return seen; };
  try {
    const out = fn();
    return out?.then ? out.then(done, (e) => { done(); throw e; }) : done();
  } catch (e) {
    done();
    throw e;
  }
}

const gifs = createGiphyApi("gifs");
const stickers = createGiphyApi("stickers");

describe("giphy createGiphyApi(\"gifs\")", () => {
  const realFetch = globalThis.fetch;
  const realKey = CHAT.giphyApiKey;
  beforeEach(() => { CHAT.giphyApiKey = "test-key"; resetGiphyCooldown(); });
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

  test("401/403 → GiphyUnavailableError (키가 막힌 상태)", async () => {
    for (const status of [401, 403]) {
      resetGiphyCooldown();
      stubFetch(() => jsonResponse({}, { status }));
      await assert.rejects(() => gifs.search("cat"), (e) => e.name === "GiphyUnavailableError", String(status));
    }
  });

  test("정규화된 items 와 걸러내기 전 rawCount 를 함께 반환", async () => {
    stubFetch(() => jsonResponse({ data: [gifResult("a"), gifResult("b")] }));
    const res = await gifs.search("cat");
    assert.ok(Array.isArray(res.items));
    assert.equal(res.items.length, 2);
    assert.equal(res.rawCount, 2);
    assert.equal(res.items[0].id, "a");
    assert.equal(res.items[0].gifUrl, "https://x/a.gif");
  });

  test("rendition 이 없어 전부 걸러져도 rawCount 는 서버가 준 개수 그대로", async () => {
    // paginator 가 rawCount 로 hasMore 를 판정하므로 이 값이 줄면 스크롤이 조기 종료된다.
    const warned = await withWarnSpy(async () => {
      stubFetch(() => jsonResponse({ data: [{ id: "a", images: {} }, { id: "b", images: {} }] }));
      const res = await gifs.search("cat");
      assert.deepEqual(res.items, []);
      assert.equal(res.rawCount, 2);
    });
    assert.equal(warned.length, 1); // 화면엔 "no results" 로만 보이므로 원인을 콘솔에 남긴다
  });

  test("응답 모양이 예상 밖이어도 던지지 않고 빈 결과로 떨어진다", async () => {
    await withWarnSpy(async () => {
      for (const body of [{}, { data: null }, { data: {} }, { data: [null] }]) {
        stubFetch(() => jsonResponse(body));
        const res = await gifs.search("cat");
        assert.deepEqual(res.items, [], JSON.stringify(body));
      }
    });
  });
});

describe("giphy createGiphyApi(\"stickers\")", () => {
  const realFetch = globalThis.fetch;
  const realKey = CHAT.giphyApiKey;
  beforeEach(() => { CHAT.giphyApiKey = "test-key"; resetGiphyCooldown(); });
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
    assert.equal(res.items.length, 1);
    assert.equal(res.items[0].id, "s1");
    assert.equal(res.items[0].gifUrl, "https://x/s1.gif");
  });

  test("두 인스턴스는 서로의 경로를 오염시키지 않는다", async () => {
    const calls = stubFetch(() => jsonResponse({ data: [] }));
    await stickers.search("cat");
    await gifs.search("cat");
    assert.equal(new URL(calls[0].url).pathname, "/v1/stickers/search");
    assert.equal(new URL(calls[1].url).pathname, "/v1/gifs/search");
  });
});

describe("giphy 429 쿨다운은 모듈이 공유한다", () => {
  const realFetch = globalThis.fetch;
  const realKey = CHAT.giphyApiKey;
  beforeEach(() => { CHAT.giphyApiKey = "test-key"; resetGiphyCooldown(); });
  afterEach(() => { globalThis.fetch = realFetch; CHAT.giphyApiKey = realKey; resetGiphyCooldown(); });

  test("한 번 429 를 받으면 다시 열든 다른 kind 든 네트워크 호출이 더 나가지 않는다", async () => {
    const calls = stubFetch(() => jsonResponse({}, { status: 429 }));
    const rateLimited = (e) => e.name === "GiphyRateLimitError";
    await assert.rejects(() => gifs.search("cat"), rateLimited);
    assert.equal(calls.length, 1);
    // 팝업을 닫았다 열면 그리드가 비어 있어 첫 페이지를 다시 부른다. 그때 요청이 또 나가면 안 된다.
    await assert.rejects(() => gifs.search("cat"), rateLimited);
    // 한도는 API 키 단위(앱 전체 공유)라 스티커 쪽도 같이 막혀야 한다.
    await assert.rejects(() => stickers.search("dog"), rateLimited);
    assert.equal(calls.length, 1);
  });

  test("키가 막힌 경우에도 같은 방식으로 멈추고 오류 종류가 바뀌지 않는다", async () => {
    const calls = stubFetch(() => jsonResponse({}, { status: 403 }));
    const unavailable = (e) => e.name === "GiphyUnavailableError";
    await assert.rejects(() => gifs.search("cat"), unavailable);
    assert.equal(calls.length, 1);
    // 쿨다운 중 재호출이 429 문구로 둔갑하면 화면 안내가 도중에 바뀐다.
    await assert.rejects(() => stickers.search("dog"), unavailable);
    assert.equal(calls.length, 1);
  });
});
