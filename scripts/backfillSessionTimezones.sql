-- C-01 (MASTER_PLAN.md §6.3, EXECUTION_PLAN.md Step 25): before this step,
-- server/routes/scheduling.ts's materializeTemplate() built each session's
-- start_time using the SERVER PROCESS's ambient timezone (UTC on Vercel),
-- not the org's actual wall-clock zone (now organizations.timezone,
-- 20260914120000_org_timezone.sql). Every already-materialized recurring
-- session's start_time may therefore be wrong by the org's UTC offset.
--
-- Run against `classstackr-staging` first, always. Do NOT run the UPDATE at
-- the bottom against production without: (1) founder go-ahead, (2) a fresh
-- backup (scripts/backup.sh), (3) having reviewed the diagnostic SELECT's
-- output for that specific database. This file changes nothing by being
-- read — every statement below must be run by hand, deliberately.
--
-- How it works: for each materialized session, reconstruct what its
-- start_time *should* be by taking materialized_date (a plain `date`) plus
-- the template's start_hour/start_minute as a naive timestamp, then
-- reinterpreting that naive timestamp in the org's own timezone via
-- Postgres's native `AT TIME ZONE` operator — the same DST-aware,
-- tzdata-backed conversion shared/timezone.ts's zonedTimeToUtc() does in
-- JS, expressed here in SQL instead so the check can run directly against
-- the database without a Node process. Only `status = 'scheduled'` rows are
-- touched — completed and cancelled sessions are historical record and
-- must never be rewritten (same rule PATCH /templates/:id already applies).

-- ---------------------------------------------------------------------
-- STEP 1 — diagnostic only. Always safe to run: a plain SELECT, no writes.
-- Run this FIRST. If it returns zero rows, the backfill is unnecessary and
-- Step 25's DoD is satisfied by this query's output alone — no UPDATE needed.
-- ---------------------------------------------------------------------
select
  cs.id as session_id,
  cs.organization_id,
  o.timezone,
  cs.template_id,
  cs.materialized_date,
  cs.status,
  cs.start_time as stored_start_time,
  ((cs.materialized_date::timestamp
      + make_interval(hours => ct.start_hour, mins => coalesce(ct.start_minute, 0)))
    at time zone o.timezone) as expected_start_time
from class_sessions cs
join class_templates ct on ct.id = cs.template_id
join organizations o on o.id = ct.organization_id
where cs.materialized_date is not null
  and ct.start_hour is not null
  and cs.start_time <> (
    (cs.materialized_date::timestamp + make_interval(hours => ct.start_hour, mins => coalesce(ct.start_minute, 0)))
    at time zone o.timezone
  )
order by cs.organization_id, cs.materialized_date;

-- Aggregate the same check by org, to see the blast radius at a glance
-- before deciding whether/when to run the correction below.
select
  cs.organization_id,
  o.timezone,
  count(*) filter (where cs.status = 'scheduled') as mismatched_scheduled,
  count(*) filter (where cs.status <> 'scheduled') as mismatched_historical_left_untouched
from class_sessions cs
join class_templates ct on ct.id = cs.template_id
join organizations o on o.id = ct.organization_id
where cs.materialized_date is not null
  and ct.start_hour is not null
  and cs.start_time <> (
    (cs.materialized_date::timestamp + make_interval(hours => ct.start_hour, mins => coalesce(ct.start_minute, 0)))
    at time zone o.timezone
  )
group by cs.organization_id, o.timezone;

-- ---------------------------------------------------------------------
-- STEP 2 — the correction. Only run this after Step 1 shows mismatched rows
-- AND you have founder go-ahead AND a fresh backup. Wrapped in a transaction
-- that you must explicitly COMMIT or ROLLBACK — nothing here auto-commits.
-- Record the row count `UPDATE` reports (or the RETURNING list's length)
-- before and after, per EXECUTION_PLAN.md Step 25's DoD.
-- ---------------------------------------------------------------------
begin;

with expected as (
  select
    cs.id,
    ((cs.materialized_date::timestamp + make_interval(hours => ct.start_hour, mins => coalesce(ct.start_minute, 0)))
      at time zone o.timezone) as expected_start_time,
    ct.duration_minutes
  from class_sessions cs
  join class_templates ct on ct.id = cs.template_id
  join organizations o on o.id = ct.organization_id
  where cs.materialized_date is not null
    and ct.start_hour is not null
    and cs.status = 'scheduled' -- never rewrite completed/cancelled historical record
)
update class_sessions cs
set start_time = e.expected_start_time,
    end_time = e.expected_start_time + make_interval(mins => coalesce(e.duration_minutes, 60))
from expected e
where cs.id = e.id
  and cs.start_time <> e.expected_start_time
returning cs.id, cs.organization_id, cs.start_time;

-- Review the returned rows and count above. Then either:
--   commit;
-- or, if anything looks wrong:
--   rollback;
