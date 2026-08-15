// Supabase Realtime postgres_changes 기반 ChatTransport 구현.
// 한 채널 `room:<code>` 에서 presence(온라인 인원) + postgres_changes(messages 테이블 INSERT)를
// 함께 구독한다. 송신은 DB INSERT 한 번 — postgres_changes echo가 자기 자신에게도 돌아온다.
// 중복은 message-store의 id dedup으로 처리.
import { getClient as realGetClient, ensureFreshSession as realEnsureFreshSession } from "../auth/auth.js";
import { insertMessage as realInsertMessage } from "./message-history.js";
import { rowToMsg } from "./supabase-mapper.js";
import { subscribeChannel } from "./channel-subscribe.js";

// 협력자는 기본값으로 실제 모듈을 쓴다 — 테스트에서만 가짜를 넘긴다(호출부는 그대로).
export function createSupabaseTransport({
  getClient = realGetClient,
  ensureFreshSession = realEnsureFreshSession,
  insertMessage = realInsertMessage,
} = {}) {
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
    for (const h of handlers[event]) {
      try { h(payload); } catch (e) { console.error(`transport ${event} handler failed:`, e); }
    }
  }

  async function connect(roomCode, who) {
    const myGen = ++gen;
    lastArgs = { roomCode, who };
    emit("status", { state: "connecting" });
    const c = await getClient();
    if (myGen !== gen) throw new Error("superseded");
    client = c;
    currentCode = roomCode;
    const ch = c.channel(`room:${roomCode}`, {
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
      // presence 등록을 상태 방송보다 먼저 한다 — 상태 구독자가 던져도 남들 눈에 내가 빠져 보이지 않게.
      // 닉네임은 보관값에서 읽는다: 끊긴 동안 바꾼 이름이 라이브러리 재가입에도 반영돼야 한다.
      if (state === "connected") {
        try {
          ch.track({ nickname: lastArgs?.who?.nickname ?? who.nickname });
        } catch (e) {
          console.error("track failed:", e);
        }
      }
      emit("status", { state });
    });
    // 구독이 끝나기 전에 세대가 바뀌었다면 이 채널은 주인이 없다 — 스스로 치운다.
    if (myGen !== gen) {
      if (channel === ch) channel = null;
      try {
        await c.removeChannel(ch);
      } catch (e) {
        console.error("removeChannel failed:", e);
      }
      throw new Error("superseded");
    }
  }

  // 죽은 채널은 되살릴 수 없다(라이브러리가 소켓 목록에서 빼 버린다) → 새 채널로 다시 붙는다.
  // 옛 채널 제거는 기다리지 않아도 된다: vendor 의 leave() 는 상태를 leaving 으로 먼저 바꿔
  // canPush() 가 거짓이 되므로 그 자리에서 닫히고 소켓 목록에서도 동기적으로 빠진다.
  // 그래서 바로 뒤의 client.channel() 이 같은 topic 의 죽은 채널을 재사용하지 않는다.
  async function reconnect() {
    const args = lastArgs; // await 뒤에 다시 읽으면 그사이 leave() 가 비워 놓을 수 있다
    if (!args) throw new Error("not connected");
    const dying = channel;
    const myGen = ++gen;
    channel = null;
    if (dying && client) {
      Promise.resolve(client.removeChannel(dying)).catch((e) => console.error("removeChannel failed:", e));
    }
    await ensureFreshSession();
    if (myGen !== gen) throw new Error("superseded");
    await connect(args.roomCode, args.who);
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

  // 정리 표시를 await 앞에서 먼저 남긴다 — 그 사이 진행 중인 connect/reconnect 가
  // "이미 떠난 방"임을 알아채고 채널을 새로 만들지 않도록.
  async function leave() {
    gen++;
    const dying = channel;
    const c = client;
    channel = null;
    currentCode = null;
    lastArgs = null;
    if (dying && c) await c.removeChannel(dying);
  }

  // presence payload 갱신. 닉네임 변경 시 호출 → 다른 멤버의 presence sync 가
  // 새 nickname 으로 즉시 갱신된다. 채널 미연결 상태에서는 no-op.
  function track(payload) {
    // 보관값을 먼저 갱신한다 — 끊긴 동안 바꾼 닉네임도 다음 재연결이 그대로 들고 가야 한다.
    if (lastArgs && payload?.nickname) lastArgs.who = { ...lastArgs.who, nickname: payload.nickname };
    if (!channel) return;
    try {
      channel.track(payload);
    } catch (e) {
      console.error("track failed:", e);
    }
  }

  return { connect, reconnect, send, leave, on, track, isHealthy };
}
