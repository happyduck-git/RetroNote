// 통합 테스트 공용 유틸:
//  - 브라우저 전역(localStorage) 셰임 → 앱 모듈(session.js/auth.js)을 Node 에서 그대로 구동.
//  - db/migrations/*.sql 을 실제 로컬 Postgres 에 순서대로 적용(스키마 = 단일 소스 검증).
//  - 테스트 간 데이터 격리(사용자/메시지/멤버십 정리).
//  - "다른 기기"(localStorage 비움) / "다른 사용자"(signOut→signIn) 시뮬레이션.
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { resolveEnv } from "./env.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = join(__dirname, "..", "..", "db", "migrations");

// --- 브라우저 전역 셰임 -----------------------------------------------------
// supabase-js 는 세션을 메모리에도 들고 있어, localStorage 만 비워도 in-memory 세션은 유지된다.
// → "같은 계정, 새 기기"(앱 로컬 데이터만 비어 있는 상태)를 정확히 모사한다.
class MemoryStorage {
  constructor() { this.map = new Map(); }
  getItem(k) { return this.map.has(k) ? this.map.get(k) : null; }
  setItem(k, v) { this.map.set(k, String(v)); }
  removeItem(k) { this.map.delete(k); }
  clear() { this.map.clear(); }
  key(i) { return [...this.map.keys()][i] ?? null; }
  get length() { return this.map.size; }
}

export function installBrowserGlobals() {
  if (!globalThis.localStorage) globalThis.localStorage = new MemoryStorage();
}

// "다른 기기" 모사: 앱이 쓰는 device-local 저장소를 통째로 비운다(저장된 방/닉네임/alias/CID/세션토큰).
export function resetDevice() {
  globalThis.localStorage?.clear?.();
}

// --- 앱 설정 주입 -----------------------------------------------------------
// config.js 의 SUPABASE 객체 프로퍼티를 직접 채운다(모든 모듈이 같은 객체 참조를 공유).
// getClient() 싱글톤이 첫 호출 때 이 값을 읽으므로, 어떤 앱 모듈을 부르기 전에 호출해야 한다.
export async function configureApp({ url, anonKey }) {
  const cfg = await import("../../src/config.js");
  cfg.SUPABASE.url = url;
  cfg.SUPABASE.anonKey = anonKey;
}

// --- DB 관리(superuser 직결, RLS 우회) -------------------------------------
export function adminPool(dbUrl) {
  return new pg.Pool({ connectionString: dbUrl, max: 4 });
}

function migrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // 0001, 0002 … 파일명 순서 = 적용 순서
}

// 깨끗한 스키마로 리셋한 뒤 db/migrations 를 순서대로 적용.
// 마이그레이션 파일 자체가 순서대로 정상 적용되는지(0001 baseline 포함)도 함께 검증한다.
export async function resetSchema(pool) {
  await pool.query(`
    drop table if exists public.messages cascade;
    drop table if exists public.room_memberships cascade;
    drop function if exists public.is_room_member(text) cascade;
  `);
  for (const f of migrationFiles()) {
    const sql = readFileSync(join(MIGRATIONS_DIR, f), "utf8");
    try {
      await pool.query(sql);
    } catch (e) {
      throw new Error(`마이그레이션 적용 실패: ${f}\n${e.message}`);
    }
  }
  // Realtime(postgres_changes) 활성화: 운영에선 Supabase 대시보드가 messages 를 supabase_realtime
  // publication 에 넣어 두지만, 마이그레이션은 publication 을 관리하지 않는다. 위에서 테이블을
  // drop/재생성하면 publication 에서 빠져 postgres_changes 가 안 뜨므로, 운영과 동일하게 다시 넣는다.
  await pool.query(`
    do $$
    begin
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public' and tablename = 'messages'
      ) then
        alter publication supabase_realtime add table public.messages;
      end if;
    end $$;
  `);
}

// 테스트 간 데이터 격리: 모든 사용자 삭제(FK on delete cascade 로 멤버십/메시지도 정리).
export async function cleanupData(pool) {
  await pool.query("truncate public.messages, public.room_memberships cascade;");
  await pool.query("delete from auth.users;");
}
