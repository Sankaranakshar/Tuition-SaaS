-- Captures infrastructure that already exists on the hosted project
-- (ref cwugpiernnwrhcximjwh) but was never checked into migrations --
-- discovered via the 2026-07-19 linter audit. Definition below matches
-- pg_proc/pg_event_trigger on the live DB exactly; this migration is a
-- no-op there and only exists so local dev / `supabase db reset` gets
-- the same behavior.
--
-- What it does: an event trigger that auto-enables RLS on every new table
-- created in the public schema, so RLS can never be forgotten on a new
-- table. This is why deny-all RLS shows up on tables with no explicit
-- `alter table ... enable row level security` in their own migration.
create or replace function public.rls_auto_enable()
returns event_trigger
language plpgsql
security definer
set search_path to 'pg_catalog'
as $function$
DECLARE
  cmd record;
BEGIN
  FOR cmd IN
    SELECT *
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE TABLE', 'CREATE TABLE AS', 'SELECT INTO')
      AND object_type IN ('table','partitioned table')
  LOOP
     IF cmd.schema_name IS NOT NULL AND cmd.schema_name IN ('public') AND cmd.schema_name NOT IN ('pg_catalog','information_schema') AND cmd.schema_name NOT LIKE 'pg_toast%' AND cmd.schema_name NOT LIKE 'pg_temp%' THEN
      BEGIN
        EXECUTE format('alter table if exists %s enable row level security', cmd.object_identity);
        RAISE LOG 'rls_auto_enable: enabled RLS on %', cmd.object_identity;
      EXCEPTION
        WHEN OTHERS THEN
          RAISE LOG 'rls_auto_enable: failed to enable RLS on %', cmd.object_identity;
      END;
     ELSE
        RAISE LOG 'rls_auto_enable: skip % (either system schema or not in enforced list: %.)', cmd.object_identity, cmd.schema_name;
     END IF;
  END LOOP;
END;
$function$;

drop event trigger if exists ensure_rls;
create event trigger ensure_rls
  on ddl_command_end
  execute function public.rls_auto_enable();

-- Event trigger functions can't be invoked directly via PostgREST RPC
-- (Postgres rejects calls outside event-trigger context), so this was
-- always dead surface -- revoking closes it explicitly rather than
-- relying on that implicit behavior.
revoke execute on function public.rls_auto_enable() from anon, authenticated;
