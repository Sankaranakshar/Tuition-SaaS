-- Student Story workspace (DEV_PLAN §2a Stage 2 item 2, REDESIGN §6.3): the
-- timeline's inline composer needs a place to write a tutor note as a
-- discrete, timestamped event. Nothing in the existing schema models this —
-- students.notes is a single free-text field, not an event log. Deliberately
-- staff-only (no parent/student select policy): these are private tutor
-- notes, and REDESIGN §6.3 requires the parent-facing view of the same
-- component to omit them.
create table student_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  author_user_id uuid not null references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

alter table student_notes enable row level security;

create policy student_notes_rw on student_notes for all
  using (is_staff(organization_id))
  with check (is_staff(organization_id) and author_user_id = auth.uid());

create index student_notes_student_idx on student_notes (student_id, created_at desc);
