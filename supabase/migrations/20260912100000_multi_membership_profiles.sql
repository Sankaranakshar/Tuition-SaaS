-- B-06a (EXECUTION_PLAN.md Step 15): a tutor/parent/student profile row is
-- keyed per (user, org), not per user, so one person can hold a role-profile
-- at more than one organization. organization_members already allows this
-- (primary key (organization_id, user_id), see 20260709020100_schema.sql) —
-- these three tables were the actual single-org holdout.
--
-- Additive only: every existing row already has exactly one
-- (user_id, organization_id) pair (organization_id has been NOT NULL since
-- Phase 0), so this is a pure constraint change, no backfill/dedup needed.
-- No other table has an FK referencing tutor_profiles(user_id) /
-- parent_profiles(user_id) / student_profiles(user_id) (grepped every
-- migration file for "references tutor_profiles" etc., zero hits), so
-- dropping and re-adding the primary key needs no cascading changes.
--
-- RLS is unaffected: tutor_profiles_rw / parent_profiles_rw /
-- student_profiles_rw (20260709020200_rls.sql) already key off
-- `user_id = auth.uid() or is_staff(organization_id)` at the row level, not
-- the primary key's shape.

alter table tutor_profiles drop constraint tutor_profiles_pkey;
alter table tutor_profiles add primary key (user_id, organization_id);

alter table parent_profiles drop constraint parent_profiles_pkey;
alter table parent_profiles add primary key (user_id, organization_id);

alter table student_profiles drop constraint student_profiles_pkey;
alter table student_profiles add primary key (user_id, organization_id);
