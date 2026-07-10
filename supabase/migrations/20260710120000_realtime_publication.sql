-- A real, confirmed-live bug found during the wedge-demo walkthrough
-- (2026-07-10): every client-side `.channel(...).on("postgres_changes", ...)`
-- subscription across the app (~63 call sites per HANDOFF.md §11.6/§13.4,
-- flagged there as "never done" but not previously confirmed broken) was
-- silently a no-op. Supabase Realtime only streams changes for tables
-- explicitly added to the `supabase_realtime` publication — unlike Firestore's
-- onSnapshot, this isn't automatic, and no prior migration ever did it.
-- Confirmed live: creating a course via Courses.tsx succeeded (toast fired,
-- row existed after a reload) but the subscribed list never updated without
-- a manual page reload.
--
-- Adding a table here does not bypass RLS: postgres_changes still filters
-- each subscriber's events through the table's existing RLS policies, so
-- server-only tables (attendance_records, payments, wallets, wallet_ledger,
-- parent_links) remain invisible to clients exactly as before — this only
-- turns on the change-stream mechanism for rows a client could already
-- SELECT.
--
-- Idempotent: ALTER PUBLICATION ... ADD TABLE errors if a table is already a
-- member, so this loops and adds only tables not already present, rather than
-- assuming a fresh publication. Also guarded on the publication existing at
-- all: real Supabase projects always create `supabase_realtime`, but the
-- PGlite-based RLS test harness (tests/integration/db.ts) boots a plain
-- Postgres with no Supabase platform bootstrapping, so it has no such
-- publication — this is a deliberate no-op there, not a bug.
do $$
declare
  t text;
  tables text[] := array[
    'assessments', 'attendance_records', 'class_sessions', 'class_templates',
    'courses', 'documents', 'invoices', 'leads', 'messages', 'parent_links',
    'payments', 'profiles', 'students', 'wallet_ledger', 'wallets'
  ];
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
