// Supabase Realtime postgres_changes 기반 ChatTransport 구현.
// 한 채널 `room:<code>` 에서 presence(온라인 인원) + postgres_changes(messages 테이블 INSERT)를
// 함께 구독한다. 송신은 DB INSERT 한 번 — postgres_changes echo가 자기 자신에게도 돌아온다.
// 중복은 message-store의 id dedup으로 처리.
import { getClient, ensureFreshSession } from "../auth/auth.js";
import { insertMessage } from "./message-history.js";
import { rowToMsg } from "./supabase-mapper.js";
import { subscribeChannel } from "./channel-subscribe.js";

export function createSupabaseTransport() {
  let client = null;
  let channel = null;
  let currentCode = null;
  let lastArgs = null; // reconnect 가 같은 방·같은 신원으로 다시 붙기 위해 보관
  let gen = 0; // 버려진 채널의 늦은 콜백이 상태를 되돌리지 못하게 한다
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
    const myGen = ++gen;
    lastArgs = { roomCode, who };
    emit("status", { state: "connecting" });
    client = await getClient();
    currentCode = roomCode;
    const ch = client.channel(`room:${roomCode}`, {
      config: { presence: { key: who.clientId } },
    });
    channel = ch;

    ch.on(
      "postgres_changes",
      { event: "INSERT", schema: "public", table: "messages", filter: `room_code=eq.${roomCode}` },
      (payload) => {
        if (myGen !== gen) return;
        emit("message", rowToMsg(payload.new));
      },
    );
    // presenceState 는 이 채널의 것을 읽는다 — 재연결 도중 새 채널의 값을 잘못 읽지 않도록.
    ch.on("presence", { event: "sync" }, () => {
      if (myGen !== gen) return;
      const state = ch.presenceState();
      emit("presence", { count: Object.keys(state).length, members: state });
    });

    await subscribeChannel(ch, (state) => {
      if (myGen !== gen) return;
      emit("status", { state });
      if (state === "connected") ch.track({ nickname: who.nickname });
    });
  }

  // 죽은 채널은 되살릴 수 없다(라이브러리가 소켓 목록에서 빼 버린다) → 새 채널로 다시 붙는다.
  // 옛 채널 제거는 기다리지 않는다 — 서버 응답이 없을 때 최대 10초까지 붙잡히기 때문.
  // 세대 가드가 옛 채널의 늦은 이벤트를 막고, 같은 topic 의 새 채널이 join 하면 라이브러리가
  // 남은 옛 채널을 알아서 정리한다(vendor leaveOpenTopic).
  async function reconnect() {
    if (!lastArgs) throw new Error("not connected");
    const dying = channel;
    gen++;
    channel = null;
    if (dying && client) {
      Promise.resolve(client.removeChannel(dying)).catch((e) => console.error("removeChannel failed:", e));
    }
    await ensureFreshSession();
    await connect(lastArgs.roomCode, lastArgs.who);
  }

  // 라이브러리 상태 콜백이 오지 않은 채 죽은 경우(좀비)를 가려낸다.
  function isHealthy() {
    return !!channel && channel.state === "joined";
  }

  // DB INSERT 하나로 끝. postgres_changes 가 모든 구독자(본인 포함)에게 메시지를 전달.
  async function send(message) {
    if (!currentCode) throw new Error("not connected");
    await insertMessage(message, currentCode);
  }

  async function leave() {
    gen++;
    if (channel && client) {
      await client.removeChannel(channel);
    }
    channel = null;
    currentCode = null;
    lastArgs = null;
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

  return { connect, reconnect, send, leave, on, track, isHealthy };
}
