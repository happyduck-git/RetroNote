-- 0004_add_membership_alias.sql
-- room_memberships 에 alias 컬럼 추가.
-- 목적: 방별 별명(로비 표시 이름)을 서버에 영속화 → 다른 기기 로그인 시 별명 복원.
-- alias 는 사용자별 개인 라벨이라 멤버십(per user, per room)에 둔다(nickname 과 동일 성격).
-- 기존 row 들은 NULL 인 채로 남는다(첫 setRoomAlias 또는 다음 sync 의 reconcile 시 backfill 됨).
--
-- RLS 영향 없음: 새 정책을 만들지 않는다. alias 는 기존 room_memberships 정책
--   (own memberships rw + memberships visible to co-members)에 그대로 올라탄다.
--   0003 의 무한 재귀(42P17)는 정책이 자기 테이블을 참조할 때 발생하므로, 컬럼 추가만으로는
--   재귀가 생기지 않는다.

alter table public.room_memberships
  add column alias text;

alter table public.room_memberships
  add constraint room_memberships_alias_len_chk
  check (alias is null or char_length(alias) <= 30);
