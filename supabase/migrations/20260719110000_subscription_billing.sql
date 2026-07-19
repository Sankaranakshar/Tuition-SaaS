-- Stage 3: SaaS subscription billing (DEV_PLAN §5, GO_TO_MARKET_BLUEPRINT.md
-- "per-active-student pricing, free up to 15 students, then slab pricing").
-- The `subscriptions` table (plan/status) already existed from the original
-- schema migration but nothing ever wrote to it or read from it. This
-- migration makes it real: every org gets a subscription row automatically,
-- and the free tier's student cap is enforced by Postgres itself (a
-- BEFORE INSERT trigger), not just by the API — students are also created by
-- a direct client insert from People.tsx (RLS-permitted for staff), so an
-- application-layer-only check would be bypassable from that path.
--
-- The plan catalog (pricing, display names, feature flags per plan) is kept
-- in code (shared/schemas/subscription.ts) as the single source of truth for
-- everything except the one number Postgres must enforce independently:
-- student_limit. Whenever the server changes an org's plan it writes
-- student_limit alongside it, so the two can never drift.
--
-- Live Razorpay wiring for the platform's own subscription billing is
-- deferred per the founder's external-integrations decision (HANDOFF §17.1)
-- — razorpay_subscription_id/customer_id are here so the checkout/webhook
-- code path is complete now and only needs real platform keys later.

alter table subscriptions
  add column if not exists student_limit integer,
  add column if not exists price_paise integer not null default 0,
  add column if not exists trial_ends_at timestamptz,
  add column if not exists current_period_end timestamptz,
  add column if not exists razorpay_subscription_id text,
  add column if not exists razorpay_customer_id text,
  add column if not exists updated_at timestamptz not null default now();

comment on column subscriptions.student_limit is
  'Enforced by students_enforce_plan_limit trigger. NULL = unlimited. Kept in sync with plan by the server, never edited independently.';

-- Backfill: any organization created before this migration (or by a path
-- that predates the new-org trigger below) gets a free-plan row if it
-- doesn't already have one, so the enforcement trigger never has to guess.
insert into subscriptions (organization_id, plan, status, student_limit, price_paise)
select o.id, 'free', 'active', 15, 0
from organizations o
left join subscriptions s on s.organization_id = o.id
where s.organization_id is null;

-- New orgs get a free-plan subscription row the moment they're created —
-- server bootstrap (members.ts) no longer has to remember to do this, and
-- it can't be skipped by a future insert path the way an application-layer
-- check could be.
create or replace function create_default_subscription()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
begin
  insert into subscriptions (organization_id, plan, status, student_limit, price_paise)
  values (new.id, 'free', 'active', 15, 0)
  on conflict (organization_id) do nothing;
  return new;
end;
$$;

drop trigger if exists organizations_create_default_subscription on organizations;
create trigger organizations_create_default_subscription
  after insert on organizations
  for each row execute function create_default_subscription();

-- The enforcement itself. security definer so it reads `subscriptions`
-- regardless of the inserting role's RLS visibility (subscriptions_select
-- is admin-only, but any staff role — tutor, frontdesk — can create a
-- student). Counts active, non-deleted students only, so archiving a
-- student frees up a seat.
create or replace function students_enforce_plan_limit()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  cap integer;
  current_count integer;
begin
  select student_limit into cap from subscriptions where organization_id = new.organization_id;

  -- No subscription row (shouldn't happen post-backfill/trigger, but fail
  -- open rather than locking an org out over a data gap) or unlimited plan.
  if cap is null then
    return new;
  end if;

  select count(*) into current_count
  from students
  where organization_id = new.organization_id
    and is_deleted = false
    and status = 'active';

  if current_count >= cap then
    raise exception using
      errcode = 'P0001',
      message = format('plan_limit_exceeded: this organization''s plan allows %s active students', cap);
  end if;

  return new;
end;
$$;

drop trigger if exists students_enforce_plan_limit on students;
create trigger students_enforce_plan_limit
  before insert on students
  for each row execute function students_enforce_plan_limit();
