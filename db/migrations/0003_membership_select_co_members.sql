-- 0003_membership_select_co_members.sql
-- room_memberships 에 공동 멤버 select RLS 정책 추가.
-- 목적: 같은 방 멤버끼리 서로의 nickname(과 first_joined_at) 을 볼 수 있게 한다.
--       방 입장 시 fetchRoomMembers 로 nicknameMap 을 구성해 메시지 표시에 라이브 lookup 적용.
-- 기존 "own memberships rw" 정책은 그대로 유지 → insert/update/delete 는 여전히 본인 row 만.
--
-- 무한 재귀 회피 (Postgres 42P17):
--   정책이 자기 자신(room_memberships)을 참조하는 EXISTS 서브쿼리를 가지면 그 서브쿼리에도
--   같은 RLS 가 다시 적용되어 무한 재귀가 발생한다. → SECURITY DEFINER 함수로 우회.
--   함수 본문의 SELECT 는 함수 소유자(postgres) 권한으로 실행되어 RLS 평가를 건너뛴다.
--   함수 시그니처는 auth.uid() 와의 비교만 노출 — 외부 데이터 누수 위험 없음(supabase 권장 패턴).
--
-- 이 파일은 idempotent — 이미 적용된 환경에 다시 실행해도 안전(이전의 잘못된 정책을 정리).

drop policy if exists "memberships visible to co-members" on public.room_memberships;

create or replace function public.is_room_member(p_room_code text)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists(
    select 1
    from public.room_memberships
    where room_code = p_room_code
      and user_id = auth.uid()
  );
$$;

-- SECURITY DEFINER 함수는 명시적으로 호출 권한을 부여해야 한다.
grant execute on function public.is_room_member(text) to anon, authenticated;

create policy "memberships visible to co-members"
  on public.room_memberships
  for select
  to public
  using (public.is_room_member(room_code));
