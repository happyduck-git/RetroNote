-- 0001_baseline.sql
-- 2026-06-10 시점의 운영 스키마 스냅샷.
-- 운영 DB에는 절대 실행하지 말 것 — 이미 적용된 상태.
-- 새 Supabase 프로젝트(빈 public 스키마) 부트스트랩 시에만 실행.

-- ===== Tables =====

create table public.messages (
  id                uuid    not null,
  room_code         text    not null,
  sender_uid        uuid    not null default auth.uid()
                    constraint messages_sender_uid_fkey
                    references auth.users(id) on delete cascade,
  sender_client_id  text    not null,
  sender_nickname   text    not null,
  text              text    not null,
  ts                bigint  not null,
  constraint messages_pkey primary key (id)
);

create index messages_room_code_ts_idx
  on public.messages using btree (room_code, ts);

create table public.room_memberships (
  room_code        text   not null,
  user_id          uuid   not null default auth.uid()
                   constraint room_memberships_user_id_fkey
                   references auth.users(id) on delete cascade,
  first_joined_at  bigint not null,
  constraint room_memberships_pkey primary key (room_code, user_id)
);

-- ===== Grants =====
-- Supabase 기본: anon/authenticated/service_role 에 테이블 권한 전부 부여.
-- 실제 접근 제어는 아래 RLS가 담당.

grant all on public.messages         to anon, authenticated, service_role;
grant all on public.room_memberships to anon, authenticated, service_role;

-- ===== RLS =====

alter table public.messages         enable row level security;
alter table public.room_memberships enable row level security;

create policy "messages insert own"
  on public.messages
  for insert
  to public
  with check (sender_uid = auth.uid());

create policy "messages select in joined rooms"
  on public.messages
  for select
  to public
  using (
    exists (
      select 1
      from public.room_memberships m
      where m.room_code = messages.room_code
        and m.user_id = auth.uid()
        and m.first_joined_at <= messages.ts
    )
  );

create policy "own memberships rw"
  on public.room_memberships
  for all
  to public
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
