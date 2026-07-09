-- Group D (client data-layer migration: Messaging, AcademicProgress, Calendar,
-- StudyMaterial, Documents, ClassManager/Onboarding) additive columns for
-- fields the Firestore documents carried that the Phase 0 schema didn't yet have.

-- assessments: AcademicProgress.tsx / StudyMaterial.tsx read/write these.
alter table assessments add column if not exists date date;
alter table assessments add column if not exists title text;
alter table assessments add column if not exists type text;
alter table assessments add column if not exists score numeric;
alter table assessments add column if not exists total_score numeric;
alter table assessments add column if not exists max_score numeric;
alter table assessments add column if not exists feedback text;
alter table assessments add column if not exists comments text;
alter table assessments add column if not exists due_date timestamptz;
alter table assessments add column if not exists status text;
alter table assessments add column if not exists updated_at timestamptz not null default now();

-- documents: StudyMaterial.tsx / Documents.tsx metadata fields beyond the
-- Phase 0 columns (name/storage_path/file_url already existed).
alter table documents add column if not exists category text;
alter table documents add column if not exists notes text;
alter table documents add column if not exists file_size bigint;

-- students: Messaging.tsx / Calendar.tsx / Documents.tsx all filter students
-- by assigned tutor for the 'tutor' role, a field the Phase 0 schema dropped.
alter table students add column if not exists tutor_id uuid references auth.users(id) on delete set null;

-- class_sessions: Calendar.tsx surfaces a per-session meeting link for online
-- classes (join-meeting popover, .ics export).
alter table class_sessions add column if not exists meeting_link text;

-- messages: Messaging.tsx marks messages read when the recipient opens a
-- conversation.
alter table messages add column if not exists read boolean not null default false;

-- tutor_profiles: Onboarding.tsx's tutor step collects far more than the
-- Phase 0 bio/subjects/hourly_rate columns.
alter table tutor_profiles add column if not exists full_name text;
alter table tutor_profiles add column if not exists grades text[] not null default '{}';
alter table tutor_profiles add column if not exists experience_years integer;
alter table tutor_profiles add column if not exists qualification text;
alter table tutor_profiles add column if not exists teaching_mode text;
alter table tutor_profiles add column if not exists location text;
alter table tutor_profiles add column if not exists price_model text;
alter table tutor_profiles add column if not exists price_range_min numeric(10,2);
alter table tutor_profiles add column if not exists price_range_max numeric(10,2);
alter table tutor_profiles add column if not exists max_batch_size integer;
alter table tutor_profiles add column if not exists is_verified boolean not null default false;

-- student_profiles: Onboarding.tsx's student step collects far more than the
-- Phase 0 parent_id-only columns.
alter table student_profiles add column if not exists full_name text;
alter table student_profiles add column if not exists grade text;
alter table student_profiles add column if not exists board text;
alter table student_profiles add column if not exists dob date;
alter table student_profiles add column if not exists subjects_needed text[] not null default '{}';
alter table student_profiles add column if not exists learning_preferences text;
