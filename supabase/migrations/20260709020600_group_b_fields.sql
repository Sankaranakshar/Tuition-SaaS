-- Group B client-data-layer migration (Today.tsx, StudentProfile.tsx,
-- StudentDashboard.tsx, Timetable.tsx): additive columns for fields these
-- pages read/write that had no home in the Phase 0 schema (0001_schema.sql).
-- Typed columns preferred over jsonb, per the migration's own convention.

-- class_sessions: online-meeting link and a free-text title, both read by
-- Today.tsx / StudentDashboard.tsx / Timetable.tsx (title falls back to the
-- roster names client-side when absent).
alter table class_sessions add column if not exists meeting_link text;
alter table class_sessions add column if not exists title text;

-- students: Today.tsx filters a tutor's own roster by tutor_id; StudentProfile.tsx
-- reads/writes the full intake-form field set that the old Firestore students
-- docs carried loosely (age, gender, school, academic-interest notes, distinct
-- student contact fields, emergency contact, fee plan, wallet credit shortcut).
alter table students add column if not exists tutor_id uuid references auth.users(id) on delete set null;
alter table students add column if not exists age text;
alter table students add column if not exists gender text;
alter table students add column if not exists school_name text;
alter table students add column if not exists board text;
alter table students add column if not exists grade text;
alter table students add column if not exists subject text;
alter table students add column if not exists areas_of_difficulty text;
alter table students add column if not exists learning_goals text;
alter table students add column if not exists student_phone text;
alter table students add column if not exists student_email text;
alter table students add column if not exists emergency_contact_name text;
alter table students add column if not exists emergency_contact_phone text;
alter table students add column if not exists fee_structure text;
alter table students add column if not exists fee_amount numeric(10,2);
alter table students add column if not exists credits integer not null default 0;

-- class_templates: StudentProfile.tsx's "Join Group" flow matches/display by
-- subject and grade, neither of which existed on the template row.
alter table class_templates add column if not exists subject text;
alter table class_templates add column if not exists grade text;

-- assessments: the Phase 0 table was a bare stub (id/org/student/created_at);
-- StudentProfile.tsx's assessment form and StudentDashboard.tsx's gradebook
-- widget need the actual assessment record fields.
alter table assessments add column if not exists tutor_id uuid references auth.users(id) on delete set null;
alter table assessments add column if not exists title text;
alter table assessments add column if not exists type text;
alter table assessments add column if not exists date date;
alter table assessments add column if not exists score numeric(6,2);
alter table assessments add column if not exists total_score numeric(6,2);
alter table assessments add column if not exists feedback text;
