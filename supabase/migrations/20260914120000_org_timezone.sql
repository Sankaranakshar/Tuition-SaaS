-- C-01 (MASTER_PLAN.md §6.3, EXECUTION_PLAN.md Step 25): the schema had no
-- notion of an org's timezone, so server/routes/scheduling.ts materialized
-- recurring sessions using the server process's ambient timezone (UTC on
-- Vercel) instead of the org's actual wall-clock zone. 'Asia/Kolkata' is a
-- real default, not a placeholder — the entire current customer base is
-- India (MASTER_PLAN.md §2) — unlike D-07's credit expiry, where the
-- founder deliberately chose no default.
--
-- No backfill UPDATE needed on this table: every existing row gets
-- 'Asia/Kolkata' via the column default below, and that is also the correct
-- value for every org that exists today. The backfill this step actually
-- requires is on `class_sessions` (existing materialized rows whose stored
-- start_time doesn't match their template's wall-clock time when
-- interpreted in the org's zone) — see the query and the go/no-go decision
-- recorded in EXECUTION_PLAN.md Step 25 and HANDOFF.md's verification log.
-- That is data-dependent and is run separately, only with founder go-ahead
-- and a fresh backup — never bundled into a schema migration.
alter table organizations
  add column timezone text not null default 'Asia/Kolkata';
