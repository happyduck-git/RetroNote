# db/ — schema, RLS, migrations

Schema lives in `migrations/*.sql`. `0001_baseline.sql` is the operational snapshot (a full bootstrap for an empty `public` schema — **never run against prod**); later files are incremental and applied in order. The integration test harness replays every file in sequence, so each migration's applicability is itself part of what gets tested.

## Tables

- `messages` — `id` (uuid PK), `room_code`, `sender_uid` (defaults to `auth.uid()`, FK to `auth.users`), `sender_client_id`, `sender_nickname`, `text`, `ts` (bigint). Indexed on `(room_code, ts)`.
- `room_memberships` — PK `(room_code, user_id)`, `first_joined_at` (bigint). Later migrations add `nickname` and `alias` columns.

## RLS (read this before changing policies)

RLS is enabled on both tables; all table grants go to anon/authenticated/service_role, so **access control is entirely in the policies**.

- `messages` INSERT: allowed only when `sender_uid = auth.uid()`.
- `messages` SELECT: gated on having a `room_memberships` row for that room with `first_joined_at <= messages.ts`. This is *why* late joiners see no history before they joined — it is intentional, not a bug.
- `room_memberships`: own rows are read/write via `user_id = auth.uid()`.

**`42P17` recursion trap:** a policy on `room_memberships` that queries `room_memberships` (e.g. "let me see co-members in my rooms") can self-reference and trigger Postgres `42P17` infinite recursion, which silently breaks room entry. This has happened before. When a membership policy must reference the table, isolate the lookup (e.g. a `security definer` helper) so the policy does not recurse, and **add/extend an integration scenario** to guard it — unit tests cannot catch this.

## Realtime (postgres_changes 방송 명단)

채팅 메시지 echo 는 `messages` 에 대한 `postgres_changes` 로 동작한다. 이게 되려면 `messages` 가 `supabase_realtime` publication(Realtime 이 변경을 방송하는 테이블 명단)에 들어 있어야 한다. **운영 DB 는 이미 충족**한다 — 과거 Supabase 대시보드의 "Realtime" 토글로 테이블이 명단에 추가됐고(그게 내부적으로 `alter publication ... add table` 을 운영 DB 에 직접 실행), 이 변경은 마이그레이션 파일에 기록되지 않았다. 그래서 `migrations/*.sql` 만으로 스키마를 재생성하는 통합 harness 에는 `messages` 가 명단에 없어 모든 `postgres_changes` echo 가 타임아웃됐다(#48).

`0007_messages_realtime_publication.sql` 은 그 토글을 코드로 못박아 harness 가 운영을 그대로 재현하게 한다. **idempotent** 하다(이미 등록돼 있으면 건너뜀). **0007 은 운영에 적용할 필요가 없다** — 운영엔 이미 있으므로 재실행해도 무해한 no-op 이다. 이 파일은 통합 harness 와, 빈 프로젝트를 마이그레이션만으로 부트스트랩할 때를 위해 존재한다.

> **cold-start 주의:** 갓 기동한 로컬 realtime 컨테이너(예: `supabase start` 직후, 또는 컨테이너 재시작 직후)는 **첫 구독의 `postgres_changes` echo 를 놓친다** — 그 한 번만 20초 타임아웃 나고, 데워진 뒤로는 ~0.5초에 통과한다. 통합 테스트는 `before()` 의 `warmUpRealtime()` 으로 echo 가 올 때까지 재시도해 컨테이너를 데운 뒤 실제 시나리오를 돌리므로, 첫 실행도 안정적으로 통과한다. 운영과 무관한 로컬 한정 현상이다.
>
> 참고: `test:integration` 은 `--test-concurrency=1` 로 돈다. 이 시나리오들은 하나의 DB·하나의 supabase 싱글톤 클라이언트를 공유하고 `beforeEach` 마다 truncate/`signOut` 하므로, 통합 테스트 파일이 늘어도 **파일 단위 병렬 실행이 서로의 상태를 깨지 않게** 하는 안전장치다.
