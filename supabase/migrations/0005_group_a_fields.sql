-- Group A (Leads.tsx, Students.tsx, CommandPalette.tsx, Settings.tsx) client
-- data-layer migration: additive columns for fields the old Firestore docs
-- carried that 0001_schema.sql didn't model. Plain typed columns, matching
-- the existing convention on these tables (jsonb reserved for genuinely
-- free-form/nested data like leads.contact_info, which we reuse below).

-- leads: studentName -> existing `name` column; email/phone fold into the
-- existing `contact_info` jsonb (that's what it's there for). Everything
-- else the Leads.tsx form/kanban board reads needs a real column.
alter table leads add column if not exists parent_name text;
alter table leads add column if not exists grade text;
alter table leads add column if not exists subject text;
alter table leads add column if not exists source text;
alter table leads add column if not exists notes text;

-- students: fee + academic + emergency-contact fields the Students.tsx form
-- collects. None of this belongs on student_profiles (that table is purely
-- the auth-linkage join row for a student's own login, no demographic
-- data lives there for any role) so it goes on `students` alongside the
-- rest of the roster record.
alter table students add column if not exists grade text;
alter table students add column if not exists subject text;
alter table students add column if not exists fee_structure text;
alter table students add column if not exists fee_amount numeric(10,2);
alter table students add column if not exists emergency_contact_name text;
alter table students add column if not exists emergency_contact_phone text;
-- Per-student assigned tutor (Students.tsx scopes the roster query to
-- `tutorId` for the tutor role and stamps it on create) — missing from
-- 0001_schema.sql entirely, distinct from class_templates.tutor_id.
alter table students add column if not exists tutor_id uuid references auth.users(id) on delete set null;

-- documents: Students.tsx's per-student document upload modal needs these;
-- `name` and `file_url` already exist on the table.
alter table documents add column if not exists category text;
alter table documents add column if not exists notes text;

-- profiles: Settings.tsx's Google Calendar connect/disconnect flow needs a
-- client-readable, client-writable flag. google_tokens has no client SELECT
-- policy (service_role/Express only, see 0002_rls.sql), so the connection
-- status can't be inferred from it directly on the client — profiles is
-- the right home since profiles_update already allows self-writes.
alter table profiles add column if not exists google_calendar_connected boolean not null default false;
