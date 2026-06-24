-- 0006_messages_insert_requires_membership.sql
-- messages INSERT 정책에 멤버십 검증 추가 — 가입한 방에만 메시지를 보낼 수 있게 한다.
-- 기존 "messages insert own"(0001)은 sender_uid = auth.uid() 만 확인해, 가입하지 않은
-- 방에도 메시지를 INSERT 할 수 있었다. is_room_member()(0003, SECURITY DEFINER)를 재사용해
-- 본인이 멤버인 방인지까지 확인한다 → 42P17 무한재귀 회피(0005 storage 정책과 동일 패턴).
--
-- 한계: room_memberships 가입 자체는 "own memberships rw" 정책으로 본인이 자유롭게 INSERT
--   가능하다. 따라서 "비멤버 → 스스로 가입 → 작성"은 막지 않는다(정상 흐름). 본 정책은 단단한
--   접근 통제가 아니라 "글쓰기 전 가입" 불변식을 DB 레벨에서 강제하는 것이 목적이다.
--
-- 이 파일은 idempotent — 이미 적용된 환경에 다시 실행해도 안전(drop if exists → create).

drop policy if exists "messages insert own" on public.messages;

create policy "messages insert own"
  on public.messages
  for insert
  to public
  with check (
    sender_uid = auth.uid()
    and public.is_room_member(room_code)
  );
