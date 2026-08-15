import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createSupabaseTransport } from "./supabase-transport.js";

// 재연결 경로(옛 채널 버리고 새 채널 구독)와 늦게 끝난 시도의 뒷정리를 본다.
// 화면·DB 는 다루지 않는다 — 그쪽은 room-view / message-history 몫.

function spy(impl) {
  const fn = (...args) => {
    fn.calls.push(args);
    return impl?.(...args);
  };
  fn.calls = [];
  return fn;
}

// Supabase client 모사. channel() 은 부를 때마다 새 채널을 만들고(진짜도 옛 채널이 빠진 뒤 그렇게 된다),
// subscribe(cb) 는 정해 둔 상태를 곧바로 흘린다 — 확정되지 않으면 진짜 15초 타이머가 남는다.
function makeFakeClient() {
  const state = { channels: [], removed: [], status: "SUBSCRIBED" };
  function makeChannel(topic) {
    const ch = {
      topic,
      state: "joined",
      tracked: [],
      handlers: {},
      subscribe(cb) {
        ch.statusCb = cb;
        cb?.(state.status);
        return ch;
      },
      on(kind, _opts, cb) {
        ch.handlers[kind === "presence" ? "presence" : "message"] = cb;
        return ch;
      },
      track(payload) {
        ch.tracked.push(payload);
      },
      presenceState: () => ({ someone: [{}] }),
    };
    state.channels.push(ch);
    return ch;
  }
  return {
    state,
    last: () => state.channels[state.channels.length - 1],
    channel: (topic) => makeChannel(topic),
    async removeChannel(ch) {
      state.removed.push(ch.topic);
      ch.state = "closed";
      return "ok";
    },
  };
}

function build(over = {}) {
  const client = makeFakeClient();
  const ensureFreshSession = spy(async () => {});
  const insertMessage = spy(async () => {});
  const transport = createSupabaseTransport({
    getClient: async () => client,
    ensureFreshSession,
    insertMessage,
    ...over,
  });
  return { transport, client, ensureFreshSession, insertMessage };
}

const WHO = { nickname: "Alice", clientId: "dev-1" };

describe("supabase-transport 연결", () => {
  test("connect 는 connecting → connected 순으로 알리고 presence 를 등록한다", async () => {
    const { transport, client } = build();
    const seen = [];
    transport.on("status", ({ state }) => seen.push(state));
    await transport.connect("ROOM1", WHO);
    assert.deepEqual(seen, ["connecting", "connected"]);
    assert.deepEqual(client.last().tracked, [{ nickname: "Alice" }]);
    assert.equal(transport.isHealthy(), true);
  });

  test("채널이 joined 가 아니면 좀비로 본다", async () => {
    const { transport, client } = build();
    await transport.connect("ROOM1", WHO);
    client.last().state = "closed";
    assert.equal(transport.isHealthy(), false);
  });

  test("상태 구독자 하나가 던져도 나머지가 계속 받는다", async () => {
    const origErr = console.error;
    console.error = () => {};
    try {
      const { transport } = build();
      const seen = [];
      transport.on("status", () => { throw new Error("boom"); });
      transport.on("status", ({ state }) => seen.push(state));
      await transport.connect("ROOM1", WHO);
      assert.deepEqual(seen, ["connecting", "connected"]);
    } finally {
      console.error = origErr;
    }
  });
});

describe("supabase-transport 재연결", () => {
  test("옛 채널을 버리고 새 채널로 다시 붙는다", async () => {
    const { transport, client } = build();
    await transport.connect("ROOM1", WHO);
    const first = client.last();
    await transport.reconnect();
    assert.equal(client.state.channels.length, 2);
    assert.notEqual(client.last(), first);
    assert.deepEqual(client.state.removed, ["room:ROOM1"]);
  });

  test("재연결마다 세션을 정확히 한 번 갱신한다", async () => {
    const { transport, ensureFreshSession } = build();
    await transport.connect("ROOM1", WHO);
    assert.equal(ensureFreshSession.calls.length, 0, "첫 연결에서는 부르지 않는다");
    await transport.reconnect();
    assert.equal(ensureFreshSession.calls.length, 1);
    await transport.reconnect();
    assert.equal(ensureFreshSession.calls.length, 2);
  });

  test("끊긴 동안 바꾼 닉네임이 다음 재연결에 반영된다", async () => {
    const { transport, client } = build();
    await transport.connect("ROOM1", WHO);
    transport.track({ nickname: "Bob" });
    await transport.reconnect();
    assert.deepEqual(client.last().tracked, [{ nickname: "Bob" }]);
  });

  test("방을 나간 뒤의 재연결은 명시적 에러로 끝난다(TypeError 아님)", async () => {
    const { transport } = build();
    await transport.connect("ROOM1", WHO);
    await transport.leave();
    await assert.rejects(transport.reconnect(), /not connected/);
  });

  test("구독 실패는 호출 측으로 전달된다", async () => {
    const { transport, client } = build();
    await transport.connect("ROOM1", WHO);
    client.state.status = "CHANNEL_ERROR";
    await assert.rejects(transport.reconnect(), /CHANNEL_ERROR/);
  });
});

describe("supabase-transport 정리 경합", () => {
  test("연결 도중 방을 나가면 주인 없는 채널이 남지 않는다", async () => {
    let release;
    const client = makeFakeClient();
    const transport = createSupabaseTransport({
      getClient: () => new Promise((r) => (release = () => r(client))),
      ensureFreshSession: async () => {},
      insertMessage: async () => {},
    });
    const connecting = transport.connect("ROOM1", WHO);
    await transport.leave(); // getClient 를 기다리는 사이에 나감
    release();
    await assert.rejects(connecting, /superseded/);
    assert.equal(client.state.channels.length, 0, "채널 자체가 만들어지지 않아야 한다");
    assert.equal(transport.isHealthy(), false);
  });

  test("재연결 도중 방을 나가면 새 채널을 만들지 않는다", async () => {
    let release;
    const client = makeFakeClient();
    const transport = createSupabaseTransport({
      getClient: async () => client,
      ensureFreshSession: () => new Promise((r) => (release = r)),
      insertMessage: async () => {},
    });
    await transport.connect("ROOM1", WHO);
    const reconnecting = transport.reconnect();
    await transport.leave();
    release();
    await assert.rejects(reconnecting, /superseded/);
    assert.equal(client.state.channels.length, 1, "옛 채널 하나뿐이어야 한다");
  });
});

describe("supabase-transport 송신", () => {
  test("연결 전 송신은 거부된다", async () => {
    const { transport } = build();
    await assert.rejects(transport.send({ id: "m1" }), /not connected/);
  });

  test("송신은 현재 방 코드로 INSERT 한 번", async () => {
    const { transport, insertMessage } = build();
    await transport.connect("ROOM1", WHO);
    await transport.send({ id: "m1" });
    assert.deepEqual(insertMessage.calls, [[{ id: "m1" }, "ROOM1"]]);
  });
});
