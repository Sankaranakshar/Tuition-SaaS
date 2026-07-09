-- Phase 5 follow-up: RLS gaps surfaced by the client migration agents, closed
-- rather than left as silent write failures.

-- Messages: receiver needs to mark their own inbox read. Sender-side fields
-- (body, sender_id) stay immutable via this policy — receiver can only ever
-- flip `read`, enforced by application code, not by column-level RLS (kept
-- simple to match the rest of this schema's posture).
create policy messages_update on messages for update
  using (receiver_id = auth.uid())
  with check (receiver_id = auth.uid());

-- Assessments: staff create/grade; a student may update their own assessment
-- row (assignment submission) but can never mark themselves graded — status
-- transitions into "completed"/"graded" stay off-limits from the client,
-- mirroring the class_sessions "status → completed is server-only" rule below.
create policy assessments_insert on assessments for insert
  with check (is_staff(organization_id));
create policy assessments_update on assessments for update
  using (is_staff(organization_id) or is_student_self(student_id))
  with check (
    is_staff(organization_id)
    or (is_student_self(student_id) and status is distinct from 'graded' and status is distinct from 'completed')
  );

-- class_sessions: the original Firestore rules only forced *creation* and the
-- status→completed transition through the server (so the transactional
-- double-booking check / attendance-billing settle can't be bypassed).
-- Reschedule (time/room/online toggle) was always a direct staff write —
-- restore that, but keep completing a session blocked here too (that must
-- go through POST /api/v1/billing/attendance, which uses service_role and
-- so bypasses RLS entirely).
create policy class_sessions_update on class_sessions for update
  using (is_staff(organization_id))
  with check (is_staff(organization_id) and status is distinct from 'completed');

-- payments: 0002_rls.sql's original policy was staff-only, inconsistent with
-- invoices/wallets/wallet_ledger which all allow a parent/student to see
-- their own money history. Widen to match (replaces the original policy).
drop policy if exists payments_select on payments;
create policy payments_select on payments for select
  using (is_staff(organization_id) or is_student_self(student_id) or is_parent_of(student_id));

-- wallet_ledger: needed for the new staff-recorded wallet top-up route
-- (server/routes/billing.ts POST /wallets/topup), same idempotency shape as
-- payments/refunds. Nullable + a partial unique index since most ledger rows
-- (attendance debits, overpayment credits) don't need one.
alter table wallet_ledger add column if not exists idempotency_key text;
create unique index if not exists wallet_ledger_org_idempotency_key
  on wallet_ledger (organization_id, idempotency_key) where idempotency_key is not null;
