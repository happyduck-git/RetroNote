-- 0003_membership_select_co_members.sql
-- room_memberships 에 공동 멤버 select RLS 정책 추가.
-- 목적: 같은 방 멤버끼리 서로의 nickname(과 first_joined_at) 을 볼 수 있게 한다.
--       방 입장 시 fetchRoomMembers 로 nicknameMap 을 구성해 메시지 표시에 라이브 lookup 적용.
-- 기존 "own memberships rw" 정책은 그대로 유지 → insert/update/delete 는 여전히 본인 row 만.

create policy "memberships visible to co-members"
  on public.room_memberships
  for select
  to public
  using (
    exists (
      select 1
      from public.room_memberships me
      where me.room_code = room_memberships.room_code
        and me.user_id = auth.uid()
    )
  );
