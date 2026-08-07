-- 0009_enforce_first_joined_at.sql
-- M2: 멤버가 자기 room_memberships.first_joined_at 을 낮춰(또는 삭제 후 낮은 값으로 재삽입)
-- "가입 전 히스토리"를 열람할 수 있었다. messages SELECT 게이트(0001)가
-- `first_joined_at <= messages.ts` 이기 때문에, first_joined_at 을 0 으로 만들면 전체 백로그가 보인다.
-- "own memberships rw"(0001) 정책은 user_id=auth.uid() 만 확인하고 first_joined_at 값은 제약하지 않으며,
-- RLS WITH CHECK 는 OLD 를 볼 수 없어 "낮추기"를 정책만으로는 막을 수 없다 → 트리거로 강제한다.
--
-- 인증 사용자(PostgREST 경유, auth.uid() 존재)만 제약한다:
--   - INSERT: 클라이언트가 보낸 first_joined_at 을 무시하고 서버 시각(ms)으로 고정 → 백데이트(재삽입) 차단.
--             ensureMembership(app)은 insert 후 값을 되읽으므로 클라이언트/서버 정합성이 유지된다.
--   - UPDATE: first_joined_at 변경을 무시(old 유지) → 닉네임/별명 UPDATE 는 통과, 낮추기만 차단.
-- 직접 DB 연결(마이그레이션/관리/통합 테스트 셋업 — auth.uid() 가 NULL)은 건드리지 않는다.
--
-- idempotent: create or replace function + drop trigger if exists.

create or replace function public.enforce_first_joined_at()
returns trigger
language plpgsql
as $$
begin
  -- 인증 컨텍스트가 아니면(관리/마이그레이션/테스트 셋업) 그대로 통과.
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.first_joined_at := (extract(epoch from now()) * 1000)::bigint;
  elsif tg_op = 'UPDATE' then
    new.first_joined_at := old.first_joined_at;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_enforce_first_joined_at on public.room_memberships;
create trigger trg_enforce_first_joined_at
  before insert or update on public.room_memberships
  for each row execute function public.enforce_first_joined_at();
