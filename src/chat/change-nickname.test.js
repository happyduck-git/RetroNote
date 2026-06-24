import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { makeChangeRoomNickname } from "./session.js";

// 6자 영숫자 (room-code.js 의 isValid 통과). normalize 는 대문자화/공백제거.
const VALID_CODE = "ABC234";

// 호출을 기록하는 fake — 인자/순서를 검증.
function spy(impl) {
  const calls = [];
  const fn = (...args) => {
    calls.push(args);
    return impl ? impl(...args) : undefined;
  };
  fn.calls = calls;
  return fn;
}

// 기본 deps 빌더 — 각 테스트가 필요한 부분만 override.
function buildDeps(overrides = {}) {
  const transport = {
    track: spy(),
  };
  const entry = {
    userId: "me-uid",
    transport,
  };
  const rooms = new Map([[VALID_CODE, entry]]);
  const storageNick = { value: null };
  const deps = {
    rooms,
    getRoomNickname: spy(() => storageNick.value),
    setRoomNickname: spy((code, nick) => {
      storageNick.value = nick;
    }),
    updateMembershipNickname: spy(() => Promise.resolve()),
    // 테스트가 살펴볼 수 있도록 부속물도 노출.
    _entry: entry,
    _transport: transport,
    _storageNick: storageNick,
  };
  return { ...deps, ...overrides };
}

describe("changeRoomNickname validation", () => {
  test("INVALID_CODE: 형식 잘못된 코드는 거절, 외부 호출 0", async () => {
    const deps = buildDeps();
    const change = makeChangeRoomNickname(deps);
    await assert.rejects(() => change("toolongcode", "alice"), /INVALID_CODE/);
    assert.equal(deps.setRoomNickname.calls.length, 0);
    assert.equal(deps.updateMembershipNickname.calls.length, 0);
    assert.equal(deps._transport.track.calls.length, 0);
  });

  test("INVALID_NICK: 빈 값 거절", async () => {
    const deps = buildDeps();
    const change = makeChangeRoomNickname(deps);
    await assert.rejects(() => change(VALID_CODE, ""), /INVALID_NICK/);
    await assert.rejects(() => change(VALID_CODE, "   "), /INVALID_NICK/);
    assert.equal(deps.setRoomNickname.calls.length, 0);
  });

  test("INVALID_NICK: 16자 초과 거절", async () => {
    const deps = buildDeps();
    const change = makeChangeRoomNickname(deps);
    await assert.rejects(() => change(VALID_CODE, "a".repeat(17)), /INVALID_NICK/);
    assert.equal(deps.setRoomNickname.calls.length, 0);
  });

  test("INVALID_NICK: 정확히 16자는 허용(경계값)", async () => {
    const deps = buildDeps();
    const change = makeChangeRoomNickname(deps);
    await change(VALID_CODE, "a".repeat(16));
    assert.equal(deps.setRoomNickname.calls.length, 1);
  });

  test("NOT_OPEN: 활성 방에 없는 코드는 거절", async () => {
    const deps = buildDeps({ rooms: new Map() });
    const change = makeChangeRoomNickname(deps);
    await assert.rejects(() => change(VALID_CODE, "alice"), /NOT_OPEN/);
    assert.equal(deps.setRoomNickname.calls.length, 0);
  });
});

describe("changeRoomNickname no-op", () => {
  test("같은 값으로 변경하면 외부 호출 없이 통과", async () => {
    const deps = buildDeps();
    deps._storageNick.value = "alice";
    const change = makeChangeRoomNickname(deps);
    await change(VALID_CODE, "alice");
    assert.equal(deps.setRoomNickname.calls.length, 0);
    assert.equal(deps.updateMembershipNickname.calls.length, 0);
    assert.equal(deps._transport.track.calls.length, 0);
  });

  test("trim 후 같은 값도 no-op", async () => {
    const deps = buildDeps();
    deps._storageNick.value = "alice";
    const change = makeChangeRoomNickname(deps);
    await change(VALID_CODE, "  alice  ");
    assert.equal(deps.setRoomNickname.calls.length, 0);
  });
});

describe("changeRoomNickname 정상 flow", () => {
  test("3단계 모두 호출: storage → transport.track → server", async () => {
    const deps = buildDeps();
    const change = makeChangeRoomNickname(deps);
    await change(VALID_CODE, "alice-new");

    assert.deepEqual(deps.setRoomNickname.calls, [[VALID_CODE, "alice-new"]]);
    assert.deepEqual(deps._transport.track.calls, [[{ nickname: "alice-new" }]]);
    assert.deepEqual(deps.updateMembershipNickname.calls, [[VALID_CODE, "alice-new"]]);
  });

  test("호출 순서: 서버 호출은 마지막", async () => {
    const order = [];
    const deps = buildDeps();
    deps.setRoomNickname = spy(() => order.push("storage"));
    deps._transport.track = spy(() => order.push("track"));
    deps.updateMembershipNickname = spy(() => {
      order.push("server");
      return Promise.resolve();
    });
    deps._entry.transport.track = deps._transport.track;

    const change = makeChangeRoomNickname(deps);
    await change(VALID_CODE, "alice-new");
    assert.deepEqual(order, ["storage", "track", "server"]);
  });

  test("입력 양끝 공백은 trim 되어 저장", async () => {
    const deps = buildDeps();
    const change = makeChangeRoomNickname(deps);
    await change(VALID_CODE, "  alice  ");
    assert.deepEqual(deps.setRoomNickname.calls, [[VALID_CODE, "alice"]]);
    assert.deepEqual(deps.updateMembershipNickname.calls, [[VALID_CODE, "alice"]]);
  });

  test("코드는 normalize 되어 fetch — 소문자/공백 입력도 동일 entry 사용", async () => {
    const deps = buildDeps();
    const change = makeChangeRoomNickname(deps);
    await change(" abc234 ", "alice"); // normalize → "ABC234"
    assert.deepEqual(deps.updateMembershipNickname.calls, [[VALID_CODE, "alice"]]);
  });
});

describe("changeRoomNickname 서버 실패", () => {
  test("server update 실패 시 throw — 로컬/store/track 은 이미 갱신됨", async () => {
    const origErr = console.error;
    console.error = () => {}; // 노이즈 차단
    try {
      const deps = buildDeps({
        updateMembershipNickname: spy(() => Promise.reject(new Error("network"))),
      });
      const change = makeChangeRoomNickname(deps);
      await assert.rejects(() => change(VALID_CODE, "alice-new"), /network/);
      // 로컬 작업은 성공적으로 수행됨(낙관적 update)
      assert.equal(deps.setRoomNickname.calls.length, 1);
      assert.equal(deps._transport.track.calls.length, 1);
      // 서버 호출은 1회 시도됨
      assert.equal(deps.updateMembershipNickname.calls.length, 1);
    } finally {
      console.error = origErr;
    }
  });
});
