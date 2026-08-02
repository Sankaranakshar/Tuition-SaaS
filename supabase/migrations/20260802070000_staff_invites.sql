-- Tech Debt #1 (DEV_PLAN.md): no org could ever get a second staff member —
-- there was no invite mechanism for owner/admin to grant tutor/frontdesk/
-- accountant/admin access to a new person. Mirrors the parent_invites/
-- student_invites pattern (Epic 10 / Tech Debt #16) exactly, but redeeming
-- creates an organization_members row via setMembership() instead of a
-- parent_links row or claiming a students row. 'owner' is deliberately not an
-- invitable role — there is exactly one, created via /members/bootstrap.
create table staff_invites (
  token text primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  role text not null check (role in ('admin', 'tutor', 'frontdesk', 'accountant')),
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null
);

-- Server-only, same default-deny posture as parent_invites/student_invites:
-- no client read or write path exists (or should ever exist) on this table.
alter table staff_invites enable row level security;
