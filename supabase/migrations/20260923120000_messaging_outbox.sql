-- B-17 (MASTER_PLAN.md §7 R3 / EXECUTION_PLAN.md Step 27): outbound comms
-- router. This is the outbox a provider-agnostic transport abstraction
-- writes to and a delivery sweep reads from -- server-write-only, matching
-- parent_invites/student_invites/payment_gateways' posture exactly: RLS
-- enabled, no policy of any kind, so every read and write (enqueue, sweep,
-- webhook settlement) goes through server/utils/messaging/*.ts and
-- server/routes/cron.ts on service_role. No client, including the org's own
-- owner, can read a parent's phone number or message content through this
-- table.
create table message_outbox (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references organizations(id) on delete cascade,
  -- A recipient is a user (parent/student/staff with a login) or a bare
  -- phone (e.g. a parent captured only as students.parent_phone, with no
  -- auth.users row of their own yet) -- never both, always at least one.
  recipient_user_id uuid references auth.users(id) on delete set null,
  recipient_phone text,
  channel text not null check (channel in ('whatsapp', 'sms')),
  template_key text not null,
  payload jsonb not null default '{}'::jsonb,
  state text not null default 'queued'
    check (state in ('queued', 'sent', 'delivered', 'read', 'failed', 'dead_letter', 'suppressed')),
  attempts integer not null default 0,
  next_attempt_at timestamptz not null default now(),
  provider_message_id text,
  error text,
  -- {kind, entityId}, mirrors invoices.source -- what real-world thing this
  -- message is about, for the delivery-state join Money's reminder surface
  -- needs and for debugging without grepping payload.
  source jsonb not null default '{}'::jsonb,
  -- Idempotency key covers all enqueue origins: an event-sourced send derives
  -- it from the source event id (e.g. `invoice_raised:<invoiceId>`,
  -- `payment_received:<paymentId>`) so a retried request or a replayed
  -- webhook can't double-message a parent; a human-initiated send (Money's
  -- "remind") derives it from the entity plus a day bucket, so repeated
  -- manual reminders are still possible but a double-click within the same
  -- request isn't a double send.
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  check (recipient_user_id is not null or recipient_phone is not null),
  unique (organization_id, idempotency_key)
);
alter table message_outbox enable row level security;
-- No policies at all -- default-deny for every role except service_role,
-- same as parent_invites/student_invites/payment_gateways/refunds.

-- Backs the delivery-sweep cron's "what's due" scan.
create index idx_message_outbox_sweep on message_outbox (state, next_attempt_at)
  where state in ('queued', 'failed');
-- Backs the provider delivery-status webhook's settlement lookup.
create index idx_message_outbox_provider_msg on message_outbox (provider_message_id)
  where provider_message_id is not null;
-- Backs Money's reminder-surface join: "latest message for this invoice".
create index idx_message_outbox_source on message_outbox ((source ->> 'kind'), (source ->> 'entityId'), created_at desc);
