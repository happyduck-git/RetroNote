// 표시 중인 메시지 목록을 소유한다. 1시간 클라이언트 TTL + 본인/타인 식별.
// 메시지는 도착 순서대로 append 한다(발신자 시계 편차로 인한 재정렬 방지).
const ONE_HOUR = 60 * 60 * 1000;
const PRUNE_INTERVAL = 60 * 1000;

export function createMessageStore(clientId) {
  let messages = [];
  const subs = new Set();
  let timer = null;

  function emit() {
    for (const fn of subs) fn(messages);
  }

  function add(msg) {
    // 본인 여부는 clientId로 판별(닉네임은 중복 가능하므로 식별자로 쓰지 않음).
    msg.mine = msg.clientId === clientId;
    messages.push(msg); // 도착 순서 유지
    emit();
  }

  function prune() {
    const cutoff = Date.now() - ONE_HOUR;
    const before = messages.length;
    messages = messages.filter((m) => m.ts >= cutoff);
    if (messages.length !== before) emit();
  }

  function start() {
    if (!timer) timer = setInterval(prune, PRUNE_INTERVAL);
  }

  function stop() {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
    messages = [];
    subs.clear();
  }

  function subscribe(fn) {
    subs.add(fn);
    fn(messages);
    return () => subs.delete(fn);
  }

  return { add, prune, start, stop, subscribe, get: () => messages };
}
