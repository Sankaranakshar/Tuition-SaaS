-- B-07 (EXECUTION_PLAN.md Step 20): the tutor-conflict check
-- (server/routes/scheduling.ts) now scopes by tutor_id alone, not
-- (organization_id, tutor_id) — a tutor's calendar is one calendar across
-- every org they belong to, and the old org-scoped check let the same
-- tutor be double-booked in two different orgs at the same time. The
-- existing idx_class_sessions_org_tutor_start has organization_id as its
-- leading column, so it can't serve a tutor_id-only lookup; this index can.
create index idx_class_sessions_tutor_status_start on class_sessions (tutor_id, status, start_time);
