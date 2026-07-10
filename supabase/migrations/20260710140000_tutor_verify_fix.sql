-- Real, pre-existing bug found while rebuilding tutor verification into the
-- People workspace's Tutors lens (DEV_PLAN §2a Stage 2 item 1): the old
-- `tutor_profiles_rw` policy's `with check` only allowed `user_id =
-- auth.uid()`, so an org admin's UPDATE of *another* tutor's `is_verified`
-- flag always satisfied `using` (is_staff lets them see/target the row) but
-- always failed `with check` (the row being written still has a different
-- user_id) — Postgres RLS silently rejects the row, which surfaces to the
-- client as "0 rows updated", not an error. The original Admin.tsx's
-- Verify/Revoke buttons could therefore never have worked for their entire
-- stated purpose (an admin verifying someone else); only a tutor
-- self-editing their own row ever actually persisted.
--
-- Fix: allow the write when the caller is specifically an org admin/owner
-- (is_org_admin, not the broader is_staff which also includes tutors —
-- verification must not be self-service or peer-service), in addition to
-- the existing self-write case.
drop policy if exists tutor_profiles_rw on tutor_profiles;
create policy tutor_profiles_rw on tutor_profiles for all
  using (user_id = auth.uid() or is_staff(organization_id))
  with check (user_id = auth.uid() or is_org_admin(organization_id));
