-- Inbox workspace (DEV_PLAN §2a Stage 2 item 4) subscribes to conversations
-- and inbox_state for the first time, and notifications for the first time
-- ever (Notifications.tsx was mock data, so nobody noticed it was never
-- added to the publication either). Same silent-no-op bug class as
-- HANDOFF §16.2 and the student_notes fix in 20260711100100 — same
-- idempotent/guarded pattern.
do $$
declare
  t text;
  tables text[] := array['conversations', 'inbox_state', 'notifications'];
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array tables loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I;', t);
    end if;
  end loop;
end $$;
