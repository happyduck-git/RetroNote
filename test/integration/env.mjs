// 통합 테스트가 붙을 로컬 Supabase 좌표(API URL, anon key, DB URL)를 해석한다.
//
// 우선순위:
//   1) 환경변수 SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_DB_URL 가 모두 있으면 그대로 사용.
//   2) 없으면 `supabase status -o env` 출력을 파싱(키는 CLI 버전마다 서명값이 달라 런타임에 읽는다).
//   3) DB_URL 이 비면 로컬 기본값으로 폴백.
//
// 이렇게 하면 키를 저장소에 박지 않고도 어느 머신에서나 자동 설정된다.
import { execSync } from "node:child_process";

const LOCAL_DB_URL = "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

function fromStatus() {
  const cmd = process.env.SUPABASE_CMD || "supabase";
  let out;
  try {
    out = execSync(`${cmd} status -o env`, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  } catch (e) {
    throw new Error(
      "로컬 Supabase 상태를 읽지 못했습니다. 먼저 `supabase start` 를 실행하거나, " +
        "SUPABASE_URL / SUPABASE_ANON_KEY / SUPABASE_DB_URL 환경변수를 설정하세요.\n" +
        `(원인: ${e.message})`,
    );
  }
  const env = {};
  for (const line of out.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)="?(.*?)"?$/);
    if (m) env[m[1]] = m[2];
  }
  return {
    url: env.API_URL,
    anonKey: env.ANON_KEY,
    dbUrl: env.DB_URL || LOCAL_DB_URL,
  };
}

export function resolveEnv() {
  const { SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_DB_URL } = process.env;
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    return { url: SUPABASE_URL, anonKey: SUPABASE_ANON_KEY, dbUrl: SUPABASE_DB_URL || LOCAL_DB_URL };
  }
  return fromStatus();
}
