-- Minimal shim of the pieces of self-hosted Supabase's `auth` schema that
-- our RLS policies depend on, for testing RLS against a plain Postgres
-- instance (no GoTrue/full Supabase stack). Mirrors production behavior:
-- auth.uid() reads the caller's identity from a per-request GUC that
-- PostgREST sets from the verified JWT; policies never trust anything else.
-- NOT applied to the real Supabase instance — production already has the
-- real auth schema. This file is test-only infrastructure.

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key,
  email text
);

create or replace function auth.uid() returns uuid
  language sql stable
  as $$
    select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
  $$;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role bypassrls;
  end if;
end $$;

grant usage on schema public to anon, authenticated, service_role;
grant usage on schema auth to anon, authenticated, service_role;
grant select on auth.users to anon, authenticated, service_role;
-- Real GoTrue owns auth.users exclusively; app code never inserts into it.
-- Test fixtures need to, though, so grant write only to service_role, which
-- test seeding runs as (mirrors "only trusted server code touches this").
grant insert, update, delete on auth.users to service_role;

-- Real Supabase grants broad table access to anon/authenticated and relies
-- entirely on RLS as the actual gate — same posture here. Run again after
-- the app migrations create their tables (grants don't apply retroactively
-- to not-yet-created objects in some Postgres versions' default privileges,
-- so the test harness re-runs this block after loading 0001_schema.sql).
grant all on all tables in schema public to anon, authenticated, service_role;
