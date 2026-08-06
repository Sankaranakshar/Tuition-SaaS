-- B-01 (MASTER_PLAN.md §3): attendance reversal and wallet credit-back.
-- `reversed_at`/`reversed_by` is the idempotency guard for
-- POST /api/v1/billing/attendance/reverse, mirroring how `billed` already
-- guards against double-billing on this same table. No change needed to
-- wallet_ledger.type: it is a plain `text not null`, no CHECK constraint, so
-- the new 'credit_reversal' literal needs no migration.
alter table attendance_records
  add column reversed_at timestamptz,
  add column reversed_by uuid references auth.users(id) on delete set null;
