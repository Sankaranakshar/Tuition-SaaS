-- Tech Debt #16 (DEV_PLAN.md): student self-onboarding had no join mechanism
-- at all. Mirrors the parent_invites pattern (Epic 10) exactly, but redeeming
-- claims an existing `students` row (sets student_user_id) instead of
-- creating a parent_links row.
create table student_invites (
  token text primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null
);

-- Server-only, same default-deny posture as parent_invites: no client read or
-- write path exists (or should ever exist) on this table. The redeem screen's
-- preview comes from a server endpoint, never a direct client select.
alter table student_invites enable row level security;
