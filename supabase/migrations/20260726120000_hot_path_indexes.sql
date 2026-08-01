-- Indexes for four hot paths that were running unindexed. Each one below is
-- a lookup the server issues on a per-request (not per-report) basis, and
-- each was resolving to a sequential scan because the table's existing
-- primary key leads with a different column.
--
-- Deliberately NOT added here: a second index on audit_events. That table
-- takes an insert on essentially every privileged mutation in the app, so
-- each additional index is a tax on the whole write path — the one below
-- earns its keep by serving both readers; an actor_id index would only
-- serve the audit viewer's optional filter, which already narrows by org.

-- audit_events had no indexes at all, despite being the highest-volume
-- table in the schema. Two readers need this one:
--   - server/routes/auditLog.ts: filter by organization_id, order by
--     created_at desc, paginated.
--   - server/routes/admin.ts /orgs: max(created_at) per organization_id for
--     the "last activity" column.
-- DESC matches the viewer's sort so the index is walked, not sorted.
create index if not exists idx_audit_events_org_created
  on audit_events (organization_id, created_at desc);

-- parent_links' primary key is (parent_user_id, student_id), so a lookup
-- keyed on student_id alone can't use it. That is exactly the direction
-- resolveUserIds() queries (scheduling.ts and inbox.ts), which runs on every
-- session insert and once per template on the materialize sweep.
create index if not exists idx_parent_links_student
  on parent_links (student_id);

-- class_templates is scanned by organization_id on the staff-triggered
-- materialize route and on every template read; only the id primary key
-- existed.
create index if not exists idx_class_templates_org
  on class_templates (organization_id);

-- google_tokens' primary key is (organization_id, user_id); the settings
-- routes look tokens up by user_id alone (connection status, disconnect).
create index if not exists idx_google_tokens_user
  on google_tokens (user_id);
