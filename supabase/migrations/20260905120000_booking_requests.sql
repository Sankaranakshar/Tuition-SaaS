-- Booking-request approval UI (EXECUTION_PLAN.md Step 5, carried from spec
-- v2 Tutor tab, MASTER_PLAN.md §3). session_requests existed since the
-- original schema but as a bare stub (id, org, requester, status,
-- created_at) that no route or client ever read or wrote — it couldn't
-- represent an actual request (no reference to what's being requested).
-- This fleshes it out to support both request shapes the product needs:
-- joining an existing recurring class (template_id) or booking a
-- one-on-one with a specific tutor at a specific time (tutor_id +
-- requested_start_time/end_time) — exactly one of the two, enforced below.
-- Table is confirmed empty in production (no write path ever existed), so
-- adding NOT NULL/CHECK constraints directly needs no backfill step.
alter table session_requests
  add column student_id uuid references students(id) on delete cascade,
  add column template_id uuid references class_templates(id) on delete cascade,
  add column tutor_id uuid references auth.users(id) on delete set null,
  add column requested_start_time timestamptz,
  add column requested_end_time timestamptz,
  add column notes text,
  -- Staff's counter-offer when declining the original ask outright isn't
  -- the right call but accepting it as-is isn't either (MASTER_PLAN.md §3
  -- "propose-alternative"). Same target-shape convention as the request
  -- itself: a countered template-join request gets proposed_template_id,
  -- a countered one-on-one gets proposed_start_time/end_time.
  add column proposed_template_id uuid references class_templates(id) on delete set null,
  add column proposed_start_time timestamptz,
  add column proposed_end_time timestamptz,
  add column response_note text,
  add column responded_by_user_id uuid references auth.users(id) on delete set null,
  add column responded_at timestamptz,
  -- Set on acceptance (original or of a counter-offer) so the request row
  -- keeps a durable link to what it actually became.
  add column resulting_enrollment_id uuid references enrollments(id) on delete set null,
  add column resulting_session_id uuid references class_sessions(id) on delete set null;

alter table session_requests alter column student_id set not null;

alter table session_requests
  add constraint session_requests_target_xor
    check ((template_id is not null) <> (tutor_id is not null)),
  add constraint session_requests_tutor_needs_time
    check (tutor_id is null or (requested_start_time is not null and requested_end_time is not null));

create index idx_session_requests_org_status on session_requests (organization_id, status);
