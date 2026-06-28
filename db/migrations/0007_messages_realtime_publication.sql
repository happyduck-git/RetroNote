-- 0007_messages_realtime_publication.sql
-- messages 를 Realtime 방송 명단(supabase_realtime publication)에 등록.
-- 운영은 대시보드 "Realtime" 토글로 이미 등록돼 있으나 그 설정이 마이그레이션 파일에 기록되지
-- 않아, 파일만으로 스키마를 재생성하는 통합 harness 에서 postgres_changes echo 가 끊겼다(#48).
-- 이미 등록돼 있으면 건너뛴다 → 운영 재적용해도 no-op(안전). 운영엔 적용 불필요.
-- 자세한 배경/운영 적용 불필요 사유: db/CLAUDE.md 의 "Realtime (postgres_changes 방송 명단)" 참고.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime'
      and schemaname = 'public'
      and tablename = 'messages'
  ) then
    alter publication supabase_realtime add table public.messages;
  end if;
end $$;
