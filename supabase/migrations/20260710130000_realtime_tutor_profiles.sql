-- The People workspace's Tutors lens (DEV_PLAN §2a Stage 2 item 1, REDESIGN
-- §6.2) subscribes to `tutor_profiles` for the first time — it was never
-- added to the supabase_realtime publication in 20260710120000, so without
-- this it would repeat the exact silent-no-op bug found in HANDOFF §16.2 for
-- every other table. Same idempotent/guarded pattern as that migration.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tutor_profiles'
  ) then
    execute 'alter publication supabase_realtime add table public.tutor_profiles;';
  end if;
end $$;
