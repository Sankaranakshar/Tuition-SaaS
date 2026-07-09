-- Confirmed via the new integration test harness (tests/integration/), not
-- just reasoned about: profiles_update's RLS policy (`using (id = auth.uid())`)
-- has no column-level restriction, so a user can currently rewrite their own
-- profiles.organization_id to any other org. Nothing in this schema actually
-- trusts that column for authorization (RLS and the server middleware both
-- read organization_id exclusively from organization_members), so this
-- isn't presently exploitable — but the old Firestore rules explicitly
-- blocked this (C1: "denies a user setting organizationId on their own user
-- doc"), and leaving a self-service-writable column that merely happens to
-- be unused today is exactly the kind of latent landmine that becomes a real
-- bug the moment someone later adds a policy that trusts it. Close it now.
--
-- RLS's WITH CHECK can't reliably express "this column is immutable" via a
-- self-referential subquery (verified empirically: it doesn't work — the
-- subquery sees the row as already updated). A BEFORE UPDATE trigger is the
-- correct tool, same pattern as enforce_student_tutor_update_scope().
create or replace function enforce_profiles_org_immutable()
returns trigger language plpgsql as $$
begin
  if current_setting('role', true) = 'service_role' then
    return new;
  end if;
  if new.organization_id is distinct from old.organization_id then
    raise exception 'organization_id is immutable from the client';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_profiles_org_immutable on profiles;
create trigger trg_profiles_org_immutable
  before update on profiles
  for each row execute function enforce_profiles_org_immutable();
