import { test, describe, beforeEach, after } from "node:test";
import assert from "node:assert/strict";

// session.js 의 device-local 로직은 localStorage 만 읽고 쓴다(서버 무관).
// import 전에 fake localStorage 전역을 심는다. 서버를 호출하는 함수
// (openRoom/syncRoomsFromServer/setRoomAlias/removeSavedRoom)는 이 파일에서 다루지 않는다.
class MemStorage {
  constructor() {
    this.map = new Map();
  }
  getItem(k) {
    return this.map.has(k) ? this.map.get(k) : null;
  }
  setItem(k, v) {
    this.map.set(k, String(v));
  }
  removeItem(k) {
    this.map.delete(k);
  }
  clear() {
    this.map.clear();
  }
  key(i) {
    return [...this.map.keys()][i] ?? null;
  }
  get length() {
    return this.map.size;
  }
}

const savedLocalStorage = globalThis.localStorage;
globalThis.localStorage = new MemStorage();

const {
  getClientId,
  getNickname,
  getRoomNickname,
  setRoomNickname,
  clearLocalSession,
  getLastUid,
  setLastUid,
  getSavedRooms,
  canAddRoom,
  saveRoom,
  MAX_SAVED_ROOMS,
  HISTORY_PAGE_SIZE,
} = await import("./session.js");

const ROOMS_KEY = "retro-chat.rooms";
const NICKS_KEY = "retro-chat.nicks";
const NICK_KEY = "retro-chat.nick";
const CID_KEY = "retro-chat.cid";
const LAST_UID_KEY = "retro-chat.last_uid";

// 유효 방 코드(혼동문자 없는 32자 알파벳, 6자리)
const VALID = ["AAAAAA", "BBBBBB", "CCCCCC", "DDDDDD", "EEEEEE", "FFFFFF", "GGGGGG", "HHHHHH", "JJJJJJ", "KKKKKK"];

function seedRooms(list) {
  globalThis.localStorage.setItem(ROOMS_KEY, JSON.stringify(list));
}

after(() => {
  if (savedLocalStorage === undefined) delete globalThis.localStorage;
  else globalThis.localStorage = savedLocalStorage;
});

beforeEach(() => {
  globalThis.localStorage.clear();
});

describe("getClientId", () => {
  test("첫 호출에 uuid 발급·영속, 재호출은 같은 값", () => {
    const id = getClientId();
    assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    assert.equal(getClientId(), id); // 안정적
    assert.equal(globalThis.localStorage.getItem(CID_KEY), id); // 영속
  });
});

describe("getRoomNickname / setRoomNickname", () => {
  test("유효 코드에 저장 후 조회(코드 대문자 정규화)", () => {
    setRoomNickname("aaaaaa", "고양이");
    assert.equal(getRoomNickname("aaaaaa"), "고양이");
    assert.equal(getRoomNickname("AAAAAA"), "고양이"); // 정규화되어 같은 키
  });

  test("닉네임은 16자로 잘리고 trim 된다", () => {
    setRoomNickname("AAAAAA", "   " + "가".repeat(20) + "   ");
    assert.equal(getRoomNickname("AAAAAA"), "가".repeat(16));
  });

  test("빈/공백 닉네임은 저장 안 함(no-op)", () => {
    setRoomNickname("AAAAAA", "   ");
    assert.equal(getRoomNickname("AAAAAA"), null);
  });

  test("유효하지 않은 코드는 저장·조회 모두 무시", () => {
    setRoomNickname("bad", "x"); // 6자 아님
    assert.equal(getRoomNickname("bad"), null);
    assert.equal(getRoomNickname("AAAAAA"), null);
  });
});

describe("clearLocalSession (session-scope guard)", () => {
  test("rooms/nicks/nick 은 지우고 cid/last_uid 는 보존", () => {
    getClientId(); // cid 생성
    setLastUid("user-1");
    seedRooms([{ code: "AAAAAA", alias: "집", lastUsedAt: 1 }]);
    setRoomNickname("AAAAAA", "냥");
    globalThis.localStorage.setItem(NICK_KEY, "legacy");

    clearLocalSession();

    assert.equal(globalThis.localStorage.getItem(ROOMS_KEY), null);
    assert.equal(globalThis.localStorage.getItem(NICKS_KEY), null);
    assert.equal(globalThis.localStorage.getItem(NICK_KEY), null);
    // 디바이스 정체성은 사용자 전환과 무관 → 보존
    assert.ok(globalThis.localStorage.getItem(CID_KEY));
    assert.equal(getLastUid(), "user-1");
  });
});

describe("getLastUid / setLastUid", () => {
  test("설정·조회, null 이면 제거", () => {
    assert.equal(getLastUid(), null);
    setLastUid("u1");
    assert.equal(getLastUid(), "u1");
    setLastUid(null);
    assert.equal(getLastUid(), null);
  });
});

describe("getNickname", () => {
  test("미설정이면 null, 있으면 그대로", () => {
    assert.equal(getNickname(), null);
    globalThis.localStorage.setItem(NICK_KEY, "글로벌닉");
    assert.equal(getNickname(), "글로벌닉");
  });
});

describe("getSavedRooms", () => {
  test("lastUsedAt 최신순 정렬", () => {
    seedRooms([
      { code: "AAAAAA", alias: "", lastUsedAt: 10 },
      { code: "BBBBBB", alias: "", lastUsedAt: 30 },
      { code: "CCCCCC", alias: "", lastUsedAt: 20 },
    ]);
    assert.deepEqual(
      getSavedRooms().map((r) => r.code),
      ["BBBBBB", "CCCCCC", "AAAAAA"],
    );
  });

  test("유효하지 않은 항목은 걸러내고 필드 기본값 보정", () => {
    seedRooms([
      { code: "AAAAAA", alias: "집", lastUsedAt: 5 },
      { code: "nope" }, // 유효하지 않은 코드 → 제외
      { alias: "no-code" }, // code 없음 → 제외
      { code: "BBBBBB" }, // alias/lastUsedAt 없음 → 기본값
    ]);
    const rooms = getSavedRooms();
    assert.deepEqual(rooms.map((r) => r.code).sort(), ["AAAAAA", "BBBBBB"]);
    const b = rooms.find((r) => r.code === "BBBBBB");
    assert.equal(b.alias, "");
    assert.equal(b.lastUsedAt, 0);
  });

  test("깨진 JSON/비배열이면 빈 목록", () => {
    globalThis.localStorage.setItem(ROOMS_KEY, "{ not json");
    assert.deepEqual(getSavedRooms(), []);
    globalThis.localStorage.setItem(ROOMS_KEY, JSON.stringify({ not: "array" }));
    assert.deepEqual(getSavedRooms(), []);
  });
});

describe("saveRoom", () => {
  test("새 방 추가(alias 빈값, lastUsedAt 세팅)", () => {
    saveRoom("aaaaaa");
    const rooms = getSavedRooms();
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].code, "AAAAAA"); // 정규화
    assert.equal(rooms[0].alias, "");
    assert.ok(rooms[0].lastUsedAt > 0);
  });

  test("이미 있는 방 재저장은 lastUsedAt 만 갱신하고 alias 보존", () => {
    seedRooms([{ code: "AAAAAA", alias: "우리집", lastUsedAt: 1 }]);
    saveRoom("AAAAAA");
    const rooms = getSavedRooms();
    assert.equal(rooms.length, 1);
    assert.equal(rooms[0].alias, "우리집"); // 보존
    assert.ok(rooms[0].lastUsedAt > 1); // 갱신
  });

  test("상한(MAX_SAVED_ROOMS) 도달 시 새 방은 추가 안 됨", () => {
    seedRooms(VALID.map((code, i) => ({ code, alias: "", lastUsedAt: i })));
    assert.equal(getSavedRooms().length, MAX_SAVED_ROOMS);
    saveRoom("MMMMMM"); // 목록에 없는 새 코드
    assert.equal(getSavedRooms().length, MAX_SAVED_ROOMS); // 변화 없음
  });

  test("유효하지 않은 코드는 무시", () => {
    saveRoom("bad");
    assert.deepEqual(getSavedRooms(), []);
  });
});

describe("canAddRoom", () => {
  test("빈 목록이면 유효 코드 추가 가능", () => {
    assert.equal(canAddRoom("AAAAAA"), true);
  });

  test("유효하지 않은 코드는 불가", () => {
    assert.equal(canAddRoom("bad"), false);
  });

  test("상한 도달: 새 코드는 불가, 이미 있는 코드는 재입장 허용", () => {
    seedRooms(VALID.map((code, i) => ({ code, alias: "", lastUsedAt: i })));
    assert.equal(canAddRoom("MMMMMM"), false); // 새 코드
    assert.equal(canAddRoom("AAAAAA"), true); // 이미 목록에 있음
  });
});

describe("상수", () => {
  test("MAX_SAVED_ROOMS=10, HISTORY_PAGE_SIZE=50", () => {
    assert.equal(MAX_SAVED_ROOMS, 10);
    assert.equal(HISTORY_PAGE_SIZE, 50);
  });
});
