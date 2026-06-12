-- 0002_add_membership_nickname.sql
-- room_memberships 에 nickname 컬럼 추가.
-- 목적: 방별 닉네임을 서버에 영속화 → 다른 기기 로그인 시 닉네임 입력 화면 재출현 방지.
-- 기존 row 들은 NULL 인 채로 남는다(첫 진입 시 1회만 prompt → backfill 됨).

alter table public.room_memberships
  add column nickname text;

alter table public.room_memberships
  add constraint room_memberships_nickname_len_chk
  check (nickname is null or char_length(nickname) <= 16);
