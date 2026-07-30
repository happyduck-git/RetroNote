// 채팅 입력의 "/명령"을 일반 메시지와 분리해 로컬 기능으로 실행한다.
// 순수 파서 + 명령 테이블 + 부수효과 주입 디스패처로 나눠 테스트/확장을 쉽게 한다.

export const COMMANDS = new Map([
  [
    "pet",
    {
      description: "펫 설정 열기",
      run: ({ navigate }) => navigate("pet-settings"),
    },
  ],
  [
    "help",
    {
      description: "명령어 목록 보기",
      run: ({ showBanner }) => showBanner(helpText()),
    },
  ],
]);

// COMMANDS 를 순회하므로 명령을 추가하면 /help 목록에 자동 반영된다.
function helpText() {
  const lines = ["사용 가능한 명령어:"];
  for (const [name, cmd] of COMMANDS) lines.push(`/${name} — ${cmd.description}`);
  return lines.join("\n");
}

export function parseSlashCommand(text) {
  const trimmed = (text ?? "").trim();
  if (!trimmed.startsWith("/")) return { isCommand: false };
  const rest = trimmed.slice(1);
  const spaceIdx = rest.search(/\s/);
  const name = (spaceIdx === -1 ? rest : rest.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? "" : rest.slice(spaceIdx + 1).trim();
  return { isCommand: true, name, args };
}

// 반환값으로 호출자의 전송 여부가 갈린다: 명령이면 true(전송 안 함), 일반 메시지면 false(정상 전송).
export function makeSlashDispatcher({ navigate, showBanner }) {
  return function dispatch(text) {
    const parsed = parseSlashCommand(text);
    if (!parsed.isCommand) return false;
    const cmd = COMMANDS.get(parsed.name);
    if (!cmd) {
      showBanner(`알 수 없는 명령어입니다: /${parsed.name} — /help 로 목록을 보세요.`);
      return true;
    }
    cmd.run({ navigate, showBanner, args: parsed.args });
    return true;
  };
}

// 자동완성 목록에 넣을 "타이핑 중인 명령 이름"을 뽑는다. 순수 함수.
// "/" 뒤에 공백 없는 토큰만 대상 — 공백이 들어가면(이름 확정/인자 입력) null 을 돌려 목록을 숨긴다.
// null = 자동완성 안 함. 앞쪽 공백은 허용, 반환값은 소문자.
export function suggestQuery(text) {
  const m = (text ?? "").match(/^\s*\/(\S*)$/);
  return m ? m[1].toLowerCase() : null;
}

// query 를 이름에 substring 으로 포함하는 명령을 정렬해 돌려준다. 순수 함수.
// 접두 일치를 먼저, 같은 조건이면 COMMANDS 등록 순서 유지. 빈 query 는 전체.
export function matchCommands(query) {
  const q = (query ?? "").toLowerCase();
  const out = [];
  let order = 0;
  for (const [name, cmd] of COMMANDS) {
    const idx = name.indexOf(q);
    if (idx !== -1) out.push({ name, description: cmd.description, prefix: idx === 0, order });
    order++;
  }
  out.sort((a, b) => (a.prefix !== b.prefix ? (a.prefix ? -1 : 1) : a.order - b.order));
  return out.map(({ name, description }) => ({ name, description }));
}
