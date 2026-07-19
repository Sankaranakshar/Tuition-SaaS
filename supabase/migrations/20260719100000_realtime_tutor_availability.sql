-- The Schedule workspace's availability overlay (src/hooks/useSchedule.ts's
-- useTutorAvailability) subscribes to `tutor_availability`, but it was never
-- added to the supabase_realtime publication in 20260710120000 — the exact
-- silent-no-op bug class from HANDOFF §16.2/§25.2. Same idempotent/guarded
-- pattern as 20260710130000_realtime_tutor_profiles.sql.
do $$
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'tutor_availability'
  ) then
    execute 'alter publication supabase_realtime add table public.tutor_availability;';
  end if;
end $$;
