-- Phase 0: core schema, mapped 1:1 from firestore.rules collections.
-- auth.users is managed by Supabase Auth (GoTrue) — profiles.id references it directly,
-- replacing the old Firestore users/{uid} doc + Firebase custom claims split.

create extension if not exists "pgcrypto"; -- gen_random_uuid()

create table organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  phone text,
  email text,
  created_at timestamptz not null default now()
);

-- Replaces both Firebase custom claims (role, organizationId) and the
-- organization_members/{orgId}_{uid} Firestore doc — single source of truth now.
create table organization_members (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','admin','tutor','frontdesk','accountant','parent','student')),
  created_at timestamptz not null default now(),
  primary key (organization_id, user_id)
);

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid references organizations(id) on delete set null,
  name text,
  email text,
  phone text,
  school text,
  grade text,
  photo_url text,
  role_type text,
  roles text[] not null default '{}',
  profile_status text,
  is_active boolean not null default true,
  preferences jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table tutor_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  bio text,
  subjects text[] not null default '{}',
  hourly_rate numeric(10,2),
  created_at timestamptz not null default now()
);

create table parent_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table student_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  parent_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create table students (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  student_user_id uuid references auth.users(id) on delete set null,
  name text not null,
  notes text,
  status text not null default 'active',
  is_deleted boolean not null default false,
  phone text,
  email text,
  address text,
  parent_name text,
  parent_phone text,
  parent_email text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- parent <-> student join, replaces parent_links/{parentUid}_{studentId}
create table parent_links (
  parent_user_id uuid not null references auth.users(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (parent_user_id, student_id)
);

create table parent_invites (
  token text primary key,
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  used_at timestamptz,
  used_by uuid references auth.users(id) on delete set null
);

create table leads (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  contact_info jsonb not null default '{}'::jsonb,
  status text not null default 'new',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table programs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  name text not null,
  created_at timestamptz not null default now()
);

create table courses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  program_id uuid references programs(id) on delete set null,
  name text not null,
  created_at timestamptz not null default now()
);

create table class_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  course_id uuid references courses(id) on delete set null,
  tutor_id uuid references auth.users(id) on delete set null,
  name text not null,
  type text not null default 'BATCH', -- BATCH | ONE_ON_ONE
  capacity integer,
  pricing_model text, -- PER_SESSION | ...
  fee_amount numeric(10,2), -- rupees; billing math converts to paise
  student_ids uuid[] not null default '{}', -- default roster materialized onto new sessions
  days_of_week smallint[] not null default '{}', -- 0=Sun..6=Sat
  start_hour smallint,
  start_minute smallint not null default 0,
  duration_minutes integer not null default 60,
  is_online boolean not null default false,
  room_number text,
  created_at timestamptz not null default now()
);

create table class_sessions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tutor_id uuid references auth.users(id) on delete set null,
  template_id uuid references class_templates(id) on delete set null,
  student_ids uuid[] not null default '{}',   -- was Firestore array-contains target
  parent_user_ids uuid[] not null default '{}',
  start_time timestamptz not null,
  end_time timestamptz not null,
  status text not null default 'scheduled',
  is_online boolean not null default false,
  room_number text,
  attendance_marked_at timestamptz,
  attendance_marked_by uuid references auth.users(id) on delete set null,
  cancelled_at timestamptz,
  cancelled_by uuid references auth.users(id) on delete set null,
  -- Set only for sessions generated by materialize_session() (replaces the
  -- old deterministic Firestore doc id `${templateId}_${dateKey}` dedupe);
  -- null for manually-created one-off sessions. Nulls don't collide under a
  -- unique constraint, so manual sessions are unaffected.
  materialized_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (template_id, materialized_date)
);

create table tutor_availability (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  tutor_id uuid not null references auth.users(id) on delete cascade,
  day_of_week smallint,
  start_time time,
  end_time time,
  created_at timestamptz not null default now()
);

create table enrollments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  template_id uuid not null references class_templates(id) on delete cascade,
  status text not null default 'active',
  created_at timestamptz not null default now()
);

create table session_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  requested_by_user_id uuid not null references auth.users(id) on delete cascade,
  status text not null default 'pending',
  created_at timestamptz not null default now()
);

-- Gapless invoice numbers: one sequence per (org, year) instead of the old
-- counters/{orgId_invoice_year} Firestore-transaction counter. Sequences are
-- created lazily in code (`create sequence if not exists ...`) — see Phase 3.

-- Money is stored as integer paise (matches the existing applyPayment() status
-- machine in server/utils/invoiceStatus.ts, kept unchanged and reused as-is —
-- see supabase/README.md Phase 3 notes). totalAmount/subtotal rupee columns
-- are kept only as a legacy display mirror, same posture as the old Firestore
-- docs ("kept until the frontend migrates").
create table invoices (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id uuid references students(id) on delete cascade,
  tutor_id uuid references auth.users(id) on delete set null,
  invoice_number text,
  status text not null default 'draft',
  subtotal_paise integer not null default 0,
  tax_paise integer not null default 0,
  discount_paise integer not null default 0,
  total_paise integer not null default 0,
  paid_paise integer not null default 0,
  total_amount numeric(10,2), -- legacy rupee mirror
  subtotal numeric(10,2),     -- legacy rupee mirror
  due_date date,
  items jsonb not null default '[]'::jsonb, -- [{description, amountPaise, quantity}]
  source jsonb not null default '{}'::jsonb, -- {kind, sessionId}
  payment_link jsonb, -- {id, shortUrl, status, amountPaise, createdAt}
  gst_snapshot jsonb, -- {legalName, gstin, placeOfSupply}, frozen at finalize time
  finalized_at timestamptz,
  finalized_by uuid references auth.users(id) on delete set null,
  voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  last_payment_at timestamptz,
  last_refund_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, invoice_number)
);

create table payments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  student_id uuid references students(id) on delete set null,
  amount_paise integer not null,
  method text, -- cash | upi | bank_transfer | cheque | other
  gateway text, -- e.g. "razorpay", null for manual payments
  gateway_payment_id text,
  gateway_link_id text,
  note text,
  recorded_by uuid references auth.users(id) on delete set null,
  source text, -- e.g. "reconcile"; null for the normal webhook/manual paths
  invoice_status text not null, -- snapshot of invoice status right after this payment applied
  -- Idempotency key covers all three payment origins: `rzp_<paymentId>` from
  -- the webhook, a caller-supplied key for manual payments, and
  -- `rzp_link_<linkId>` from the reconciliation poll — replaces using the
  -- Firestore doc id itself as the dedupe key.
  idempotency_key text not null,
  at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

create table wallets (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  balance_credits integer not null default 0,   -- prepaid session-credit packs
  balance_currency numeric(10,2) not null default 0, -- prepaid rupee balance
  created_at timestamptz not null default now(),
  unique (organization_id, student_id)
);

create table wallet_ledger (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  type text not null, -- debit_credit | credit_currency | debit_currency
  credits integer not null default 0, -- signed delta
  paise integer not null default 0,   -- signed delta
  reason text not null, -- attendance | overpayment | ...
  session_id uuid references class_sessions(id) on delete set null,
  invoice_id uuid references invoices(id) on delete set null,
  gateway_payment_id text,
  by text not null, -- actor user id, or a system tag like "razorpay_webhook"
  at timestamptz not null default now()
);

create table transactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  kind text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table attendance_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  session_id uuid not null references class_sessions(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  template_id uuid references class_templates(id) on delete set null,
  tutor_id uuid references auth.users(id) on delete set null,
  status text not null,
  billed boolean not null default false,
  session_start timestamptz not null,
  marked_by uuid references auth.users(id) on delete set null,
  marked_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (session_id, student_id) -- replaces Firestore doc id `${sessionId}_${studentId}` dedupe
);

create table billing_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table refunds (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  invoice_id uuid references invoices(id) on delete set null,
  student_id uuid references students(id) on delete set null,
  amount_paise integer not null,
  reason text,
  refunded_by uuid references auth.users(id) on delete set null,
  invoice_status text not null, -- snapshot of invoice status right after this refund applied
  idempotency_key text not null,
  at timestamptz not null default now(),
  unique (organization_id, idempotency_key)
);

-- Atomic, gap-free per-org-per-year invoice number counter (replaces the
-- Firestore counters/{orgId_invoice_year} transactional-doc pattern). A
-- single `INSERT ... ON CONFLICT ... DO UPDATE ... RETURNING` is atomic on
-- its own — no explicit row lock needed, no dynamic per-org CREATE SEQUENCE.
create table invoice_counters (
  organization_id uuid not null references organizations(id) on delete cascade,
  year integer not null,
  seq integer not null default 0,
  primary key (organization_id, year)
);

create table payment_gateways (
  organization_id uuid primary key references organizations(id) on delete cascade,
  key_id text,
  key_secret_enc text,
  webhook_secret_enc text,
  tax jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table assessments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  created_at timestamptz not null default now()
);

create table documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  student_id uuid not null references students(id) on delete cascade,
  uploaded_by_user_id uuid not null references auth.users(id) on delete cascade,
  tutor_id uuid references auth.users(id) on delete set null,
  file_name text not null,
  content_type text,
  category text,
  notes text,
  storage_path text not null,
  created_at timestamptz not null default now()
);

create table conversations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  participant_ids uuid[] not null default '{}',
  created_at timestamptz not null default now()
);

create table messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  conversation_id uuid references conversations(id) on delete cascade,
  sender_id uuid not null references auth.users(id) on delete cascade,
  receiver_id uuid references auth.users(id) on delete cascade,
  body text not null,
  created_at timestamptz not null default now()
);

create table notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  type text not null,
  payload jsonb not null default '{}'::jsonb,
  read boolean not null default false,
  created_at timestamptz not null default now()
);

create table audit_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table org_stats_daily (
  organization_id uuid not null references organizations(id) on delete cascade,
  date date not null,
  stats jsonb not null default '{}'::jsonb,
  primary key (organization_id, date)
);

create table feature_flags (
  organization_id uuid not null references organizations(id) on delete cascade,
  key text not null,
  enabled boolean not null default false,
  primary key (organization_id, key)
);

create table google_tokens (
  organization_id uuid not null references organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  access_token_enc text,
  refresh_token_enc text,
  expires_at timestamptz,
  primary key (organization_id, user_id)
);

create table subscriptions (
  organization_id uuid primary key references organizations(id) on delete cascade,
  plan text not null,
  status text not null default 'active',
  updated_at timestamptz not null default now()
);
