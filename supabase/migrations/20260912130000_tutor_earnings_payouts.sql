-- B-08 (MASTER_PLAN.md §3 R2 / EXECUTION_PLAN.md Step 21): tutor payouts and
-- earnings ledger. A dedicated, staff-only-writable payroll rate table --
-- deliberately NOT tutor_profiles.hourly_rate (confirmed dead: zero reads,
-- zero writes anywhere in the tree) and NOT tutor_profiles.price_range_min/
-- max (a self-editable marketplace asking-price range) -- reusing either
-- would let a tutor set or launder their own pay, the exact bug shape
-- 20260710140000_tutor_verify_fix.sql already found and fixed once for
-- is_verified.

create table tutor_compensation_rates (
  tutor_id uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  hourly_rate_paise integer not null default 0,
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (tutor_id, organization_id)
);
alter table tutor_compensation_rates enable row level security;
-- Viewing a rate (owner/admin/accountant, or the tutor themselves) is wider
-- than setting one (owner/admin only, enforced entirely in the route below --
-- this table has no write policy at all) -- an accountant needs to see a
-- tutor's rate to make sense of a payout without being able to change it.
create policy tutor_compensation_rates_select on tutor_compensation_rates for select
  using (has_role(organization_id, array['owner','admin','accountant']) or tutor_id = auth.uid());
-- No insert/update/delete policy: every write goes through
-- PUT /api/v1/payouts/tutors/:tutorId/rate on service_role -- same posture
-- as consent_records / student_payment_permissions.

create table tutor_payouts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tutor_id uuid not null references auth.users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  gross_paise integer not null,
  tds_percent numeric(5,2) not null default 0,
  tds_paise integer not null default 0,
  net_paise integer not null,
  status text not null default 'issued', -- issued | paid
  run_by uuid references auth.users(id) on delete set null,
  paid_at timestamptz,
  created_at timestamptz not null default now()
);
alter table tutor_payouts enable row level security;
create policy tutor_payouts_select on tutor_payouts for select
  using (has_role(organization_id, array['owner','admin','accountant']) or tutor_id = auth.uid());
-- is_staff() also lets frontdesk/other tutors see rows -- deliberately not
-- used here; payroll visibility is narrower than general org staffing.

-- One row per session, ever (unique(session_id)) -- accrued once, the first
-- time attendance is marked for that session, in the same transaction as
-- the attendance write (server/routes/billing.ts POST /attendance).
-- Independent of any individual student's billing outcome: a tutor is paid
-- for delivering the session, not contingent on which students paid, so a
-- later per-student attendance reversal (POST /attendance/reverse) never
-- touches this table.
create table tutor_earnings_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tutor_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references class_sessions(id) on delete cascade,
  session_start timestamptz not null,
  duration_minutes integer not null,
  rate_paise_per_hour integer not null,
  amount_paise integer not null,
  payout_id uuid references tutor_payouts(id) on delete set null,
  created_at timestamptz not null default now(),
  unique (session_id)
);
alter table tutor_earnings_ledger enable row level security;
create policy tutor_earnings_ledger_select on tutor_earnings_ledger for select
  using (has_role(organization_id, array['owner','admin','accountant']) or tutor_id = auth.uid());

-- Backs both the payout-run's "sum unpaid rows for this tutor in this
-- period" query and the tutor's own recent-earnings view.
create index idx_tutor_earnings_ledger_unpaid on tutor_earnings_ledger (tutor_id, session_start) where payout_id is null;
