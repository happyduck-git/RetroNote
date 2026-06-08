// ChatTransport — 백엔드 무관 pub/sub 계약. UI는 이 계약만 의존한다.
// 와이어 봉투(envelope)는 백엔드 불문 동일: { id, clientId, nickname, text, ts }.
//
// transport API:
//   connect(roomCode, { nickname, clientId }) -> Promise   // 토픽=roomCode 구독, SUBSCRIBED 시 resolve
//   send(message) -> Promise                                // message = envelope
//   leave() -> Promise                                      // unsubscribe + close, idempotent
//   on(event, handler) -> unsubscribe()
//     "message"(msg)             — broadcast 메시지 도착
//     "status"({ state })        — "connecting"|"connected"|"reconnecting"|"closed"|"error"
//     "presence"({ count, members }) — 온라인 인원
//
// 새 백엔드(예: 셀프호스팅 WS)는 동일 계약을 구현하면 UI 변경 없이 교체된다.
import { createSupabaseTransport } from "./supabase-transport.js";

export function createTransport(kind, opts) {
  if (kind === "supabase") return createSupabaseTransport(opts);
  throw new Error(`unknown transport: ${kind}`);
}
