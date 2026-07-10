-- Student Story workspace (DEV_PLAN §2a Stage 2 item 2) subscribes to the new
-- student_notes table for the first time — never added to the
-- supabase_realtime publication in 20260710120000, so without this it would
-- repeat the exact silent-no-op bug found in HANDOFF §16.2. Same
-- idempotent/guarded pattern as that migration.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'student_notes'
  ) then
    execute 'alter publication supabase_realtime add table public.student_notes;';
  end if;
end $$;
