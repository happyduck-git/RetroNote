// Supabase Realtime Broadcast 기반 ChatTransport 구현.
// 채널 토픽 = `room:<code>`. 메시지는 저장되지 않으므로 입장 이후 메시지만 수신된다.
// supabase-js 번들은 connect() 시점에 동적 import 한다 → 채팅 미사용 빌드는 로드 비용 0.

const STATUS_MAP = {
  SUBSCRIBED: "connected",
  CHANNEL_ERROR: "error",
  TIMED_OUT: "reconnecting",
  CLOSED: "closed",
};

export function createSupabaseTransport({ url, anonKey }) {
  let client = null;
  let channel = null;
  const handlers = { message: new Set(), status: new Set(), presence: new Set() };

  function on(event, handler) {
    const set = handlers[event];
    if (!set) throw new Error(`unknown event: ${event}`);
    set.add(handler);
    return () => set.delete(handler);
  }

  function emit(event, payload) {
    for (const h of handlers[event]) h(payload);
  }

  async function connect(roomCode, who) {
    emit("status", { state: "connecting" });
    const { createClient } = await import("../vendor/supabase.js");
    client = createClient(url, anonKey, {
      realtime: { params: { eventsPerSecond: 10 } },
    });
    channel = client.channel(`room:${roomCode}`, {
      config: { broadcast: { self: false }, presence: { key: who.clientId } },
    });

    channel.on("broadcast", { event: "msg" }, ({ payload }) => emit("message", payload));
    channel.on("presence", { event: "sync" }, () => {
      const state = channel.presenceState();
      emit("presence", { count: Object.keys(state).length, members: state });
    });

    await new Promise((resolve, reject) => {
      let settled = false;
      channel.subscribe((status) => {
        emit("status", { state: STATUS_MAP[status] || "connecting" });
        if (status === "SUBSCRIBED") {
          channel.track({ nickname: who.nickname });
          if (!settled) {
            settled = true;
            resolve();
          }
        } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          if (!settled) {
            settled = true;
            reject(new Error(`subscribe failed: ${status}`));
          }
        }
      });
    });
  }

  async function send(message) {
    if (!channel) throw new Error("not connected");
    await channel.send({ type: "broadcast", event: "msg", payload: message });
  }

  async function leave() {
    if (channel && client) {
      await client.removeChannel(channel);
    }
    channel = null;
  }

  return { connect, send, leave, on };
}
