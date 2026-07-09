-- Cross-checked 0002/0009's RLS against the old firestore.rules RBAC test
-- suite (tests/rules/rbac.test.ts, deleted in the Phase 6 cutover along with
-- the rest of the Firestore test infra) before removing it, to make sure the
-- role matrix it encoded didn't silently regress. Three real gaps found:

-- 1. leads: was using the blanket is_staff() (owner/admin/tutor/frontdesk/
-- accountant), but the original matrix explicitly excludes accountant from
-- the lead pipeline — narrow to the actual leads role set.
drop policy if exists leads_rw on leads;
create policy leads_rw on leads for all
  using (has_role(organization_id, array['owner','admin','tutor','frontdesk']))
  with check (has_role(organization_id, array['owner','admin','tutor','frontdesk']));

-- 2. students: is_staff() let a tutor update any column, but the original
-- rules restricted tutor writes to `notes` only (onlyChanges(['notes',
-- 'updatedAt'])). RLS alone can't express "this role may only touch these
-- columns" (USING/WITH CHECK see whole rows, not a column diff) — a
-- BEFORE UPDATE trigger is the standard way to enforce that in Postgres.
-- Generic over columns (diffs to_jsonb(old) vs to_jsonb(new)) so it doesn't
-- need updating every time a students column is added.
create or replace function enforce_student_tutor_update_scope()
returns trigger language plpgsql as $$
declare
  caller_role text;
  allowed_keys text[] := array['notes', 'updated_at'];
  old_j jsonb := to_jsonb(old);
  new_j jsonb := to_jsonb(new);
  k text;
begin
  select role into caller_role from organization_members
    where organization_id = new.organization_id and user_id = auth.uid();

  if caller_role = 'tutor' then
    for k in select jsonb_object_keys(new_j) loop
      if not (k = any(allowed_keys)) and old_j -> k is distinct from new_j -> k then
        raise exception 'Tutors may only update notes on student records (attempted to change %)', k;
      end if;
    end loop;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_students_tutor_scope on students;
create trigger trg_students_tutor_scope
  before update on students
  for each row execute function enforce_student_tutor_update_scope();

-- 3. audit_events: was is_org_admin() (owner/admin only), but the original
-- matrix has accountant reading audit events too (just not writing them —
-- unaffected, there's still no client insert/update/delete policy).
drop policy if exists audit_events_select on audit_events;
create policy audit_events_select on audit_events for select
  using (has_role(organization_id, array['owner','admin','accountant']));
