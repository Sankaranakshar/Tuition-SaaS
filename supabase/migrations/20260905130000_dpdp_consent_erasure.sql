-- B-11 / EXECUTION_PLAN.md Step 10: DPDP consent record + per-student erasure.
--
-- Two independent pieces, one migration:
--
-- 1. consent_records — until now DPDP consent was a throwaway boolean on the
--    parent-invite redeem request (shared/schemas/parents.ts: `consent:
--    z.literal(true)`), validated and then dropped on the floor. Nothing was
--    ever persisted, so a center could not show *when* or *to what* a parent
--    consented. This table is the durable record: one row per redeem, stamped
--    with a CONSENT_VERSION string (shared/consent.ts). The document that
--    version points at is a legal deliverable and still does not exist —
--    tracked in MASTER_PLAN.md §8, out of engineering scope for this step.
--    Server-writes only (service_role): no insert/update/delete policy, same
--    posture as audit_events / the other server-authoritative tables
--    (HANDOFF.md §5 rule 5). Readable by the consenting user (their own rows)
--    and by staff of the org.
--
-- 2. students.erased_at / erased_by — the marker for a completed erasure.
--    Erasure is NOT a row delete: invoices / payments / refunds /
--    wallet_ledger / wallets / attendance_records all reference students(id)
--    (mostly `on delete cascade`) and must survive 8 years for financial
--    retention (GO_TO_MARKET_BLUEPRINT.md §8.2, HANDOFF.md §5). Same problem
--    org offboarding hit (20260719130000_org_offboarding.sql). So erasure
--    (server/utils/erasure.ts) hard-deletes the non-financial rows, scrubs
--    every identifying column on the students row itself, and leaves an
--    anonymized stub so the financial trail stays intact and B-03's
--    `balance == ledger sum` invariant still holds. These two columns record
--    that it happened and by whom; is_deleted (set true by the same path)
--    is what actually drops the stub out of every existing UI query.

create table consent_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Nulled by an erasure of this student (the consent fact — "user X
  -- consented to version V at time T" — is kept; its link to the erased
  -- student is not). `set null` also covers a raw students-row delete.
  student_id uuid references students(id) on delete set null,
  role text not null check (role in ('parent', 'student')),
  consent_version text not null,
  consented_at timestamptz not null default now()
);

alter table consent_records enable row level security;

-- The consenting user reads their own rows; org staff read their org's.
-- No write policy at all — every insert goes through the redeem routes on
-- the service_role key (server/routes/parents.ts, server/routes/students.ts).
create policy consent_records_select on consent_records for select
  using (user_id = auth.uid() or is_staff(organization_id));

create index consent_records_org_idx on consent_records (organization_id, consented_at desc);
create index consent_records_student_idx on consent_records (student_id);

alter table students
  add column erased_at timestamptz,
  add column erased_by uuid references auth.users(id) on delete set null;
