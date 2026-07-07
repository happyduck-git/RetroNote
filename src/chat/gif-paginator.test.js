import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createGifPaginator } from "./gif-paginator.js";

const noSignal = { aborted: false };

// n 개의 서로 다른 gif. tag 로 페이지마다 유니크한 id 를 만든다(dedup 충돌 방지용).
function page(n, tag = "") {
  return Array.from({ length: n }, (_, i) => ({ id: `${tag}g${i}` }));
}

// 호출(query/offset)을 기록하는 가짜 fetchPage 로 페이지네이터를 만든다.
function makePaginator(impl, opts = {}) {
  const calls = [];
  const fetchPage = ({ query, offset }) => {
    calls.push({ query, offset });
    return Promise.resolve(impl({ query, offset }));
  };
  const p = createGifPaginator({ fetchPage, pageSize: 4, maxPages: 3, ...opts });
  p.calls = calls;
  return p;
}

describe("createGifPaginator", () => {
  test("loadFirst 는 offset 0, 이후 loadMore 는 pageSize(4)씩 전진, maxPages 에서 정지", async () => {
    const p = makePaginator(({ offset }) => page(4, `o${offset}-`));
    p.beginQuery("cat");
    let r = await p.loadFirst(noSignal);
    assert.equal(r.items.length, 4);
    assert.equal(r.hasMore, true); // 풀 페이지 + pages(1) < maxPages(3)
    r = await p.loadMore(noSignal);
    assert.equal(r.newItems.length, 4);
    assert.equal(r.hasMore, true); // pages(2) < 3
    r = await p.loadMore(noSignal);
    assert.equal(r.hasMore, false); // pages(3) == maxPages
    assert.deepEqual(p.calls.map((c) => c.offset), [0, 4, 8]);
  });

  test("짧은 페이지면 hasMore=false", async () => {
    const p = makePaginator(() => page(2, "x")); // 2 < pageSize 4
    p.beginQuery("cat");
    const r = await p.loadFirst(noSignal);
    assert.equal(r.hasMore, false);
  });

  test("빈 페이지면 items=[] 이고 hasMore=false", async () => {
    const p = makePaginator(() => []);
    p.beginQuery("cat");
    const r = await p.loadFirst(noSignal);
    assert.equal(r.items.length, 0);
    assert.equal(r.hasMore, false);
  });

  test("hasMore=false 면 loadMore 는 skipped (fetch 없음)", async () => {
    const p = makePaginator(() => page(2, "x"));
    p.beginQuery("cat");
    await p.loadFirst(noSignal);
    const before = p.calls.length;
    const r = await p.loadMore(noSignal);
    assert.deepEqual(r, { skipped: true });
    assert.equal(p.calls.length, before);
  });

  test("다음 페이지가 전부 중복이면 newItems=[] 이고 hasMore=false (스핀 방지)", async () => {
    // loadFirst 와 loadMore 가 동일 id 페이지 → dedup 이 전부 걸러낸다.
    const p = makePaginator(() => page(4, "same-"));
    p.beginQuery("cat");
    await p.loadFirst(noSignal);
    const r = await p.loadMore(noSignal);
    assert.equal(r.newItems.length, 0);
    assert.equal(r.hasMore, false);
  });

  test("동시 loadMore 는 loading 가드로 fetch 1회만", async () => {
    let pendingResolve;
    let callCount = 0;
    const fetchPage = ({ offset }) => {
      callCount++;
      if (offset === 0) return Promise.resolve(page(4, "o0-")); // loadFirst 즉시
      return new Promise((r) => { pendingResolve = r; });        // loadMore 대기
    };
    const p = createGifPaginator({ fetchPage, pageSize: 4, maxPages: 5 });
    p.beginQuery("cat");
    await p.loadFirst(noSignal); // callCount=1, offset→4, hasMore=true
    const a = p.loadMore(noSignal);
    const rb = await p.loadMore(noSignal); // loading=true → 즉시 skipped, fetch 안 함
    assert.deepEqual(rb, { skipped: true });
    pendingResolve(page(4, "o4-"));
    await a;
    assert.equal(callCount, 2);
  });

  test("beginQuery(새 쿼리)로 seq 가 바뀌면 in-flight loadMore 는 stale (상태 미변경)", async () => {
    let pendingResolve;
    const fetchPage = ({ offset }) =>
      offset === 0
        ? Promise.resolve(page(4, "o0-"))
        : new Promise((r) => { pendingResolve = r; });
    const p = createGifPaginator({ fetchPage, pageSize: 4, maxPages: 5 });
    p.beginQuery("cat");
    await p.loadFirst(noSignal);
    const more = p.loadMore(noSignal); // pending
    p.beginQuery("dog"); // seq++ → in-flight loadMore 무효화
    pendingResolve(page(4, "o4-"));
    const r = await more;
    assert.deepEqual(r, { stale: true });
  });

  test("signal.aborted 면 loadFirst 는 stale (상태 미반영)", async () => {
    const p = makePaginator(() => page(4, "o0-"));
    p.beginQuery("cat");
    const r = await p.loadFirst({ aborted: true });
    assert.deepEqual(r, { stale: true });
  });

  test("캐시: 다른 쿼리로 갔다 돌아오면 로드된 페이지 복원 + offset 이어서 재개", async () => {
    const p = makePaginator(({ offset }) => page(4, `o${offset}-`), { maxPages: 5 });
    p.beginQuery("cat");
    await p.loadFirst(noSignal); // offset→4
    await p.loadMore(noSignal);  // offset→8, items 8개
    p.beginQuery("dog");
    await p.loadFirst(noSignal);
    const hit = p.beginQuery("cat"); // 캐시 히트
    assert.equal(hit.hit, true);
    assert.equal(hit.items.length, 8);
    await p.loadMore(noSignal); // offset 8 에서 계속
    assert.equal(p.calls[p.calls.length - 1].offset, 8);
  });

  test("복원 items 는 값-복사라 외부에서 바꿔도 캐시가 오염되지 않음", async () => {
    const p = makePaginator(({ offset }) => page(4, `o${offset}-`), { maxPages: 5 });
    p.beginQuery("cat");
    await p.loadFirst(noSignal); // cat 스냅샷: 4개
    const first = p.beginQuery("cat"); // 히트 → 복사본 A
    first.items.push({ id: "junk" }); // 외부 오염 시도
    const second = p.beginQuery("cat"); // 히트 → 복사본 B
    assert.equal(second.items.length, 4);
    assert.ok(!second.items.some((g) => g.id === "junk"));
  });

  test("loadMore 에러는 전파되고 offset/hasMore 불변, loading 이 풀려 재호출 가능", async () => {
    let mode = "ok";
    const offsets = [];
    const fetchPage = ({ offset }) => {
      offsets.push(offset);
      if (offset === 0) return Promise.resolve(page(4, "o0-"));
      if (mode === "throw") return Promise.reject(new Error("boom"));
      return Promise.resolve(page(4, `o${offset}-`));
    };
    const p = createGifPaginator({ fetchPage, pageSize: 4, maxPages: 5 });
    p.beginQuery("cat");
    await p.loadFirst(noSignal); // offset→4, hasMore=true
    mode = "throw";
    await assert.rejects(() => p.loadMore(noSignal), /boom/);
    mode = "ok";
    const r = await p.loadMore(noSignal); // loading 풀림 → 재호출, offset 여전히 4
    assert.equal(offsets[offsets.length - 1], 4);
    assert.equal(r.newItems.length, 4);
  });

  test("GiphyRateLimitError 는 그대로 전파", async () => {
    const err = new Error("rate");
    err.name = "GiphyRateLimitError";
    const fetchPage = ({ offset }) =>
      offset === 0 ? Promise.resolve(page(4, "o0-")) : Promise.reject(err);
    const p = createGifPaginator({ fetchPage, pageSize: 4, maxPages: 5 });
    p.beginQuery("cat");
    await p.loadFirst(noSignal);
    await assert.rejects(() => p.loadMore(noSignal), (e) => e.name === "GiphyRateLimitError");
  });
});
