-- B-13 (MASTER_PLAN.md §3 R2 / EXECUTION_PLAN.md Step 23): substitute and
-- leave management. A tutor logs a leave date range; owner/admin review and
-- approve/reject it, then staff find the sessions it affects and reassign a
-- substitute tutor to them. Substitution itself needs no new column --
-- class_sessions.tutor_id is reassigned directly (server/routes/scheduling.ts's
-- reassignSessionTutorTx, reusing the same advisory-lock + range-overlap
-- conflict check B-07 already scopes by tutor_id alone across orgs) and the
-- change is recorded as a session.reassign_tutor audit_events row, not a new
-- audit column -- same "reuse what already exists" posture Step 21 used for
-- tutor_earnings_ledger vs the dead tutor_profiles.hourly_rate column.

create table tutor_leave_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tutor_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  reason text,
  status text not null default 'pending', -- pending | approved | rejected | cancelled
  requested_by uuid not null references auth.users(id) on delete set null,
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);
alter table tutor_leave_requests enable row level security;

-- Select-only, same posture as tutor_earnings_ledger/tutor_payouts/
-- student_payment_permissions: every write (create/approve/reject/cancel)
-- goes through server/routes/leave.ts on service_role, so decided_by/
-- decided_at bookkeeping and the audit-log write can never be bypassed by a
-- direct client insert/update. is_staff() already includes the tutor role,
-- so this also covers a tutor reading their own requests -- a shared team
-- leave calendar, same visibility posture as tutor_availability.
create policy tutor_leave_requests_select on tutor_leave_requests for select
  using (is_staff(organization_id));

-- Backs both the "leave requests for this tutor" list and the
-- affected-sessions lookup's date-range filter.
create index idx_tutor_leave_requests_tutor_range on tutor_leave_requests (tutor_id, start_date, end_date);
