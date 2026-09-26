-- C-07 (EXECUTION_PLAN.md Step 32): activation analytics, per D-11
-- (MASTER_PLAN.md §13, decided 2026-09-14): a hand-rolled events table on
-- the existing Postgres, no third-party analytics, because behavioural data
-- about an org's minors must not leave the DPDP boundary before a legal
-- review.
--
-- Three tables, all server-only in exactly the message_outbox /
-- payment_gateways sense: RLS enabled, no policy of any kind, so no client
-- (including an org's own owner) can read or write them. Every write comes
-- from server/utils/analytics.ts or the analytics-rollup cron on
-- service_role; every read goes through GET /api/v1/admin/analytics, which
-- requires a platform admin.

-- ---------------------------------------------------------------------
-- product_events: the append-only event log.
--
-- Payload rule (enforced in server/utils/analytics.ts against
-- shared/analyticsEvents.ts before any insert): properties hold only
-- record ids, counts, paise amounts and fixed enum values. Never a name,
-- phone, email, message text or any other free text, and never a student
-- or parent id. The size check below is a second, cruder line.
-- ---------------------------------------------------------------------
create table product_events (
  id uuid primary key default gen_random_uuid(),
  -- Null only for the onboarding beats a brand-new user passes through
  -- before their org exists (the org is created on onboarding's final
  -- submit); the check constraint below keeps every other event org-scoped.
  organization_id uuid references organizations(id) on delete cascade,
  actor_user_id uuid references auth.users(id) on delete set null,
  name text not null check (name ~ '^[a-z][a-z_]*\.[a-z][a-z_]*$'),
  properties jsonb not null default '{}'::jsonb
    check (jsonb_typeof(properties) = 'object' and octet_length(properties::text) <= 1024),
  -- Set when an event must land at most once (org.created, org.activated,
  -- a payment's own idempotency key, one portal open per parent per day).
  -- Writers use `on conflict do nothing`, so a retried request or a cron
  -- re-run is a no-op rather than a double count.
  dedupe_key text,
  occurred_at timestamptz not null default now(),
  constraint product_events_org_scoped check (organization_id is not null or name like 'onboarding.%')
);
alter table product_events enable row level security;
-- No policies at all: default-deny for every role except service_role.

create unique index product_events_dedupe_key on product_events (dedupe_key) where dedupe_key is not null;
create index idx_product_events_org_time on product_events (organization_id, occurred_at desc);
create index idx_product_events_name_time on product_events (name, occurred_at desc);

-- Append-only, for service_role too. A direct UPDATE or DELETE statement is
-- refused. A change made by a foreign-key cascade is allowed: deleting an
-- org must still delete its events, and deleting a user must still null
-- actor_user_id. Those arrive through Postgres's own referential-integrity
-- triggers, so this trigger runs nested (pg_trigger_depth() > 1) for them
-- and at depth 1 for a statement anyone typed.
create or replace function product_events_append_only() returns trigger
  language plpgsql
  as $$
begin
  if pg_trigger_depth() > 1 then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;
  raise exception 'product_events is append-only (% refused)', tg_op
    using errcode = 'insufficient_privilege';
end;
$$;

create trigger product_events_append_only
  before update or delete on product_events
  for each row execute function product_events_append_only();

-- ---------------------------------------------------------------------
-- org_activation: one row per org, recomputed in full by the
-- analytics-rollup cron (server/routes/cron.ts) from the tables of record.
--
-- Activation (MASTER_PLAN.md §11): 10 or more sessions with attendance
-- marked, and at least one rupee collected through ClassStackr, both
-- within 14 days of signup. Computed by shared/analytics.ts's
-- computeActivation(); see that file for what counts as each.
-- ---------------------------------------------------------------------
create table org_activation (
  organization_id uuid primary key references organizations(id) on delete cascade,
  signup_at timestamptz not null,
  window_ends_at timestamptz not null,
  first_class_at timestamptz,
  first_attendance_at timestamptz,
  sessions_attended_in_window integer not null default 0,
  tenth_session_attended_at timestamptz,
  first_collected_at timestamptz,
  collected_in_window_paise bigint not null default 0,
  collected_online_in_window_paise bigint not null default 0,
  activated_at timestamptz,
  computed_at timestamptz not null default now()
);
alter table org_activation enable row level security;

-- ---------------------------------------------------------------------
-- org_weekly_loop: the weekly per-org loop (MASTER_PLAN.md §11 item 2),
-- one row per org per week since signup, weeks starting Monday in the
-- org's own timezone. Retention cohorts (item 3) and parent engagement
-- (item 4) are read off these rows. Recomputed in full on every run, so a
-- later void or reversal corrects the past week it belongs to.
-- ---------------------------------------------------------------------
create table org_weekly_loop (
  organization_id uuid not null references organizations(id) on delete cascade,
  week_start date not null,
  sessions_scheduled integer not null default 0,
  sessions_attended integer not null default 0,
  attendance_marked integer not null default 0,
  invoices_raised integer not null default 0,
  messages_delivered integer not null default 0,
  collected_paise bigint not null default 0,
  collected_online_paise bigint not null default 0,
  parent_portal_opens integer not null default 0,
  parent_payments_started integer not null default 0,
  computed_at timestamptz not null default now(),
  primary key (organization_id, week_start)
);
alter table org_weekly_loop enable row level security;
