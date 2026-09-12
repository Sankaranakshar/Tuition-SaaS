-- D-05 (MASTER_PLAN.md §5, decided 2026-09-12): per-student parent-controlled
-- payment permissions — "a real permissions model to design and build... not
-- a single boolean," no platform-wide age cutoff. Defaults closed (no row =
-- no self-pay), same "no platform-wide default" posture as D-07's credit
-- expiry opt-in (supabase/migrations/... creditExpiry). Enforced on the one
-- self-serve student-initiated path that exists today: POST
-- /api/v1/session-requests (server/routes/sessionRequests.ts).
--
-- Two pieces:
--
-- 1. student_payment_permissions — one row per student, written only by the
--    new PUT /api/v1/students/:studentId/payment-permissions route on
--    service_role. Select-only client policy, same "server writes, staff/
--    parent/self read" shape as consent_records (20260905130000): no insert/
--    update/delete policy at all, so a spending limit can't be edited by
--    anyone the route itself doesn't allow.
create table student_payment_permissions (
  student_id uuid primary key references students(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  self_pay_allowed boolean not null default false,
  spending_limit_paise integer,                          -- null = no limit
  allowed_payment_methods text[] not null default '{}',   -- subset of {'wallet','razorpay_link'}
  updated_by uuid references auth.users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table student_payment_permissions enable row level security;

create policy student_payment_permissions_select on student_payment_permissions for select
  using (is_staff(organization_id) or is_parent_of(student_id) or is_student_self(student_id));

create index student_payment_permissions_org_idx on student_payment_permissions (organization_id);

-- 2. session_requests.requires_parent_approval — set true when a student-role
--    requester has no self_pay_allowed permission (the closed-by-default
--    case). Staff's own /accept route refuses to accept while this is true,
--    until a parent clears it via POST /:id/parent-approve. Table confirmed
--    to have a real write path already (20260905120000_booking_requests.sql),
--    so this is additive-only, defaulting every existing row to false (no
--    approval was ever required before this feature existed).
alter table session_requests
  add column requires_parent_approval boolean not null default false;
