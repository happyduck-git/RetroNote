# Database migrations

Supabase Postgres 스키마를 위한 forward-only SQL 마이그레이션.

## 규칙

- 파일명: `NNNN_short_description.sql` (4자리 0-padding, 순차).
- Forward-only — 되돌리려면 새 마이그레이션을 작성한다.
- 적용: Supabase 대시보드 → SQL Editor → New query → 붙여넣고 Run.
- 파일명 순서대로 적용한다.
- 적용 후 마이그레이션 번호를 커밋 메시지에 명시.

## Baseline

`0001_baseline.sql` 은 2026-06-10 시점 운영 스키마의 스냅샷이다.
**운영 DB에는 실행하지 않는다** — 이미 적용된 상태다.
새 Supabase 프로젝트(테스트/복구 등)를 부트스트랩할 때만 사용한다.

## 새 마이그레이션 적용 절차

1. `db/migrations/NNNN_*.sql` 작성.
2. Supabase SQL Editor 에서 실행 → 성공 확인.
3. `git commit` (메시지에 마이그레이션 번호 명시).

## 새 환경 부트스트랩

빈 Supabase 프로젝트의 `public` 스키마에 대해 파일명 순서대로 전부 실행한다:

1. `0001_baseline.sql`
2. `0002_add_membership_nickname.sql`
3. ...
