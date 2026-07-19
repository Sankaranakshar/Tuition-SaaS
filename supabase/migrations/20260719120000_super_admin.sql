-- Stage 3: super-admin console (DEV_PLAN §5, old E16.2).
--
-- Deliberately NOT built on organization_members.role or profiles.role_type:
-- those are per-org concepts (who runs a given tuition center), and Tech
-- Debt #25 already documents that the in-org 'admin' tier is unreachable
-- through any real signup flow anyway. A super-admin is a ClassStackr team
-- member who can see and act across every org — a platform-level allowlist,
-- checked server-side only (requirePlatformAdmin in server/middleware/auth.ts),
-- completely decoupled from any org's own RBAC.

create table platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  note text,
  created_at timestamptz not null default now()
);

alter table platform_admins enable row level security;

-- A user may check only whether THEY are a platform admin (so the client
-- can decide whether to show the admin nav entry) — never the full roster.
-- No insert/update/delete policy at all: only service_role (a human running
-- a one-off SQL statement, or a future admin-inviting-admin server route)
-- can grant platform-admin status.
create policy platform_admins_select_self on platform_admins
  for select using (user_id = auth.uid());

-- Append-only log of privileged platform-admin actions (impersonation,
-- feature-flag toggles from the super-admin console, etc.) — separate from
-- the per-org `audit_events` table because this is the platform's own
-- record, not any one org's. Server-only, same posture as audit_events:
-- RLS enabled, zero client policies.
create table platform_admin_actions (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid not null references auth.users(id),
  action text not null,
  target_organization_id uuid references organizations(id) on delete set null,
  target_user_id uuid references auth.users(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

alter table platform_admin_actions enable row level security;
