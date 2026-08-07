-- 0008_restrict_attachment_read.sql
-- H1: chat-uploads 읽기 정책이 `to public` 이라 익명(anon) 포함 누구나 storage.objects 를
-- 열거(list)할 수 있었다 → 모든 방/UUID 를 전수 열거해 public URL 로 받아갈 수 있어,
-- 코드가 가정한 "UUID 파일명이라 추측 불가"(0005 주석) 보호가 무효화됐다.
-- SELECT(=list) 를 방 멤버로 제한해 열거를 차단한다.
--
-- 버킷은 public 을 유지한다 → 렌더 경로(getPublicUrl 로 만든 public URL)는 그대로 동작한다.
-- (public 버킷의 public 오브젝트 엔드포인트는 RLS 를 거치지 않으므로 표시에는 영향 없음.
--  바뀌는 것은 "인증 API 로 목록을 나열하는" 경로뿐 — 이게 열거 취약점의 통로였다.)
--
-- is_room_member(text): 0003 의 SECURITY DEFINER 함수(42P17 무한재귀 안전) 재사용,
-- 0005 의 insert 정책과 동일한 패턴(경로 `<room_code>/<uuid>.<ext>` 에서 room_code 추출).
--
-- idempotent: drop policy if exists → create.

drop policy if exists "chat-uploads read" on storage.objects;

create policy "chat-uploads read"
  on storage.objects
  for select
  to authenticated
  using (
    bucket_id = 'chat-uploads'
    and public.is_room_member(split_part(name, '/', 1))
  );
