-- Fixes a real bug found while cross-checking the migration: the original
-- Firestore class_sessions doc had THREE separate arrays — studentIds
-- (student record ids), studentUserIds (student auth uids), and
-- parentUserIds (parent auth uids) — kept separate specifically so
-- record-id lookups (staff UI) and auth.uid()-based RLS checks never
-- collide. The Postgres schema collapsed studentIds/studentUserIds into one
-- `student_ids` column, reintroducing that collision: the booking UI
-- populates it with student RECORD ids, but the RLS policy and two client
-- pages (Timetable.tsx, StudentDashboard.tsx) compared it against
-- auth.uid() — the wrong id space — so a student's own timetable/dashboard
-- silently returned zero sessions. `parent_user_ids` was never written by
-- server/routes/scheduling.ts at all, so ParentPortal.tsx's equivalent
-- query always returned zero too.
--
-- Fix: restore the three-array shape. `student_ids` keeps its current
-- record-id semantics (StudentProfile.tsx, Calendar.tsx, Today.tsx,
-- ParentPortal.tsx's own-student filtering all already rely on that
-- correctly); add `student_user_ids` for the auth-uid case and start
-- actually populating it and `parent_user_ids`.
alter table class_sessions add column if not exists student_user_ids uuid[] not null default '{}';
create index if not exists idx_class_sessions_student_user_ids on class_sessions using gin (student_user_ids);

drop policy if exists class_sessions_select on class_sessions;
create policy class_sessions_select on class_sessions for select
  using (
    is_staff(organization_id)
    or tutor_id = auth.uid()
    or auth.uid() = any(student_user_ids)
    or auth.uid() = any(parent_user_ids)
  );
