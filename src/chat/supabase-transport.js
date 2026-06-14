// Supabase Realtime postgres_changes 기반 ChatTransport 구현.
// 한 채널 `room:<code>` 에서 presence(온라인 인원) + postgres_changes(messages 테이블 INSERT)를
// 함께 구독한다. 송신은 DB INSERT 한 번 — postgres_changes echo가 자기 자신에게도 돌아온다.
// 중복은 message-store의 id dedup으로 처리.
import { getClient } from "../auth/auth.js";
import { insertMessage } from "./message-history.js";
import { rowToMsg } from "./supabase-mapper.js";

const STATUS_MAP = {
  SUBSCRIBED: "connected",
  CHANNEL_ERROR: "error",
  TIMED_OUT: "reconnecting",
  CLOSED: "closed",
};

export function createSupabaseTransport() {
  let client = null;
  let channel = null;
  let currentCode = null;
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
    client = await getClient();
    currentCode = roomCode;
    channel = client.channel(`room:${roomCode}`, {
      config: { presence: { key: who.clientId } },
    });

    channel.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `room_code=eq.${roomCode}` },
      (payload) => emit("message", rowToMsg(payload.new)),
    );
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

  // DB INSERT 하나로 끝. postgres_changes 가 모든 구독자(본인 포함)에게 메시지를 전달.
  async function send(message) {
    if (!currentCode) throw new Error("not connected");
    await insertMessage(message, currentCode);
  }

  async function leave() {
    if (channel && client) {
      await client.removeChannel(channel);
    }
    channel = null;
    currentCode = null;
  }

  // presence payload 갱신. 닉네임 변경 시 호출 → 다른 멤버의 presence sync 가
  // 새 nickname 으로 즉시 갱신된다. 채널 미연결 상태에서는 no-op.
  function track(payload) {
    if (!channel) return;
    try {
      channel.track(payload);
    } catch (e) {
      console.error("track failed:", e);
    }
  }

  return { connect, send, leave, on, track };
}
