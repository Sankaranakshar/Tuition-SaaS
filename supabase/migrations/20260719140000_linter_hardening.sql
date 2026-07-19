-- Supabase Database Linter remediation (2026-07-19 audit). See audit notes
-- for full reasoning; this migration covers the two fixes that are safe to
-- apply blind (both functions and their behavior are confirmed in-repo).
--
-- NOT included here: the 8 "RLS enabled, no policy" INFO findings (deny-all
-- for service-role-only tables is correct, not a bug) and the 6 is_*/has_role
-- RLS helper functions (already `security definer set search_path`, and
-- revoking `authenticated` EXECUTE would break RLS policies that call them
-- from USING/WITH CHECK clauses -- left alone deliberately).

-- 1. function_search_path_mutable: both are BEFORE UPDATE triggers that run
-- SECURITY INVOKER (not DEFINER), so this was never a live privilege-escalation
-- path -- but pinning search_path is free and closes the pattern for good so
-- nobody copies an unpinned trigger function into a future SECURITY DEFINER one.
alter function public.enforce_student_tutor_update_scope()
  set search_path = public, pg_temp;

alter function public.enforce_profiles_org_immutable()
  set search_path = public, pg_temp;

-- 2. anon/authenticated_security_definer_function_executable: both functions
-- `returns trigger` and are only ever invoked by their triggers (create_default_subscription
-- on organizations AFTER INSERT, students_enforce_plan_limit on students BEFORE INSERT --
-- see 20260719110000_subscription_billing.sql), never meant to be called directly.
-- Trigger firing doesn't need EXECUTE grants on the function itself, so revoking
-- direct RPC access closes dead PostgREST surface with no behavior change.
revoke execute on function public.create_default_subscription() from anon, authenticated;
revoke execute on function public.students_enforce_plan_limit() from anon, authenticated;
