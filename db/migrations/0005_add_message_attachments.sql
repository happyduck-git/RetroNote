-- 0005_add_message_attachments.sql
-- messages 테이블에 이미지/GIF 첨부 컬럼 추가 + 첨부 업로드용 Storage 버킷·정책.
--
-- 정책:
--   - 한 메시지는 text 또는 attachment 중 적어도 하나는 있어야 한다(check constraint).
--   - attachment_url 은 두 가지 출처:
--       (1) Supabase Storage 의 chat-uploads 버킷 public URL (사용자가 올린 png/jpg/webp/gif)
--       (2) Tenor 외부 GIF URL (검색 picker 로 보낸 GIF — 우리 storage 안 씀)
--     수신측 렌더는 출처 구분 없이 attachment_url 을 그대로 <img> src 로 박는다.
--   - attachment_kind 는 'image' | 'gif_external' — 표시는 동일하지만 출처를 메타데이터로 남겨
--     향후 통계/관리/이관 시 외부 GIF 와 본인 업로드를 분리할 수 있게 한다.
--   - width/height 는 layout shift 방지용. bytes 는 외부 GIF 의 경우 NULL 가능.
--
-- 이 파일은 idempotent — 이미 적용된 환경에 다시 실행해도 안전(IF NOT EXISTS / DROP IF EXISTS).

-- ===== messages 컬럼 =====

alter table public.messages
  alter column text drop not null;

alter table public.messages
  add column if not exists attachment_url   text,
  add column if not exists attachment_kind  text,
  add column if not exists attachment_mime  text,
  add column if not exists attachment_w     int,
  add column if not exists attachment_h     int,
  add column if not exists attachment_bytes int;

alter table public.messages
  drop constraint if exists messages_kind_chk;
alter table public.messages
  add constraint messages_kind_chk
  check (attachment_kind is null or attachment_kind in ('image', 'gif_external'));

-- text 또는 attachment 둘 중 하나는 있어야 한다.
alter table public.messages
  drop constraint if exists messages_has_content_chk;
alter table public.messages
  add constraint messages_has_content_chk
  check (text is not null or attachment_url is not null);

-- attachment_url 이 있으면 kind/mime/w/h 도 함께 있어야 한다(부분 채워진 row 방지).
alter table public.messages
  drop constraint if exists messages_attachment_complete_chk;
alter table public.messages
  add constraint messages_attachment_complete_chk
  check (
    attachment_url is null
    or (attachment_kind is not null
        and attachment_mime is not null
        and attachment_w is not null
        and attachment_h is not null)
  );

-- ===== Storage 버킷 =====
-- public read: 어차피 같은 방 멤버가 모두 봐야 하고 URL 추측 비용이 충분히 높다(uuid 파일명).
-- write: insert/update/delete 는 RLS 로 본인이 멤버인 방만 허용.
-- 객체 경로 규약: `<room_code>/<uuid>.<ext>`  → policy 에서 split_part(name, '/', 1) 로 room_code 추출.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'chat-uploads',
  'chat-uploads',
  true,
  5242880,  -- 5 MiB
  array['image/png', 'image/jpeg', 'image/gif', 'image/webp']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;

-- ===== Storage RLS =====
-- storage.objects 는 Supabase 기본으로 RLS enabled. 정책만 추가.
-- is_room_member(text) 함수는 0003 에서 만들어 둔 SECURITY DEFINER 함수 — 재사용.

drop policy if exists "chat-uploads read"   on storage.objects;
drop policy if exists "chat-uploads insert" on storage.objects;
drop policy if exists "chat-uploads delete" on storage.objects;

create policy "chat-uploads read"
  on storage.objects
  for select
  to public
  using (bucket_id = 'chat-uploads');

create policy "chat-uploads insert"
  on storage.objects
  for insert
  to authenticated
  with check (
    bucket_id = 'chat-uploads'
    and public.is_room_member(split_part(name, '/', 1))
  );

-- 본인이 올린 객체만 본인이 삭제. owner 는 auth.uid() 로 자동 채워진다.
create policy "chat-uploads delete"
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'chat-uploads'
    and owner = auth.uid()
  );
