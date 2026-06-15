# Integration / scenario tests

단위 테스트(`npm test`)는 서버·스토리지를 fake 로 주입하므로 **DB 레벨 문제(RLS 정책, 세션, Realtime)** 는
잡지 못한다. 지난번 닉네임 작업의 RLS 무한 재귀(Postgres 42P17)로 방 진입이 막힌 사고가 그 사각지대였다.

이 통합 테스트는 **실제 로컬 Supabase 스택**(Postgres + Auth + PostgREST + Realtime)에 앱 모듈을
그대로 구동해 전체 사용 flow 를 patch 전에 검증한다.

## 검증 범위

- **RLS 재귀 회귀 가드** — `openRoom` 이 42P17 없이 성공 (지난번 사고 재현 방지)
- **Realtime 왕복** — `transport.send` → `postgres_changes` echo 수신
- **alias 기기 간 보존** — 다른 기기(같은 계정)에서 방 이름 복원 + 서버 우선 reconcile
- **nickname 기기 간 보존** — 지난 기능 회귀 가드
- **사용자 격리** — 다른 계정은 내 방/alias 를 못 봄
- **방 제거** — `removeSavedRoom` 후 sync 로 부활하지 않음

## 사전 준비 (한 번만)

1. **Docker Desktop** 실행 (로컬 스택이 Docker 위에서 돈다).
2. 의존성 설치: `npm install` (`pg`, `supabase` CLI 포함).

## 실행

```bash
npm run db:start          # supabase start — 로컬 스택 기동(첫 실행은 이미지 pull 로 수 분)
npm run test:integration  # 시나리오 테스트
npm run db:stop           # 끝나면 정리(선택)
```

`test:integration` 은 `supabase status -o env` 로 URL/anon key/DB URL 을 자동으로 읽는다.
명시하고 싶으면 환경변수로 덮어쓸 수 있다: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_DB_URL`.

## 재현성 (다른 컴퓨터/CI)

`supabase/config.toml` 과 `db/migrations/` 가 저장소에 있어, `supabase start` 는 어느 머신에서나
**동일한 포트·키·스키마**로 같은 스택을 띄운다. 동료/CI 는 클론 → `npm install` → 위 3줄이면 끝.
테스트 harness 가 매 실행마다 `db/migrations/*.sql` 을 순서대로 재적용하므로 **마이그레이션 파일 자체의
적용 가능성**도 함께 검증된다. (머신 종속 상태 없음.)

## 동작 메모

- 이메일 확인은 로컬에서 꺼져 있어(`config.toml`) `signUp` 이 즉시 세션을 준다.
- "다른 기기(같은 계정)"는 `localStorage` 만 비워 모사한다 — supabase-js 가 세션을 메모리에도
  들고 있어 인증은 유지되고 앱 로컬 데이터만 빈 상태가 된다(= 실제 새 기기 상황).
- "다른 사용자"는 `signOut` → 새 계정 `signUp` 으로 전환한다.
- 테스트 간 모든 사용자/메시지/멤버십을 정리한다.
