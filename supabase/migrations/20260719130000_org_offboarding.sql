-- Stage 3: org export/offboarding (DEV_PLAN §5, old E16.3). "Offboarding" is
-- deliberately a status flip, never a row delete: invoices/payments (and
-- everything they transitively reference — students, class_sessions, etc.,
-- all `on delete cascade` from organizations per the original schema) must
-- survive 8 years for financial-retention compliance, and this schema has no
-- way to delete an org's non-financial rows without also cascading away its
-- financial ones (invoices.student_id and attendance_records.session_id are
-- both `on delete cascade`). So "deletion" here means: mark the org
-- offboarded, block further app usage (enforced in requireOrg,
-- server/middleware/auth.ts), and keep every row exactly as it was.
alter table organizations
  add column status text not null default 'active',
  add column offboarded_at timestamptz,
  add column offboarded_by uuid references auth.users(id) on delete set null;

alter table organizations
  add constraint organizations_status_check check (status in ('active', 'offboarded'));
