-- Inbox workspace (DEV_PLAN §2a Stage 2 item 4, REDESIGN §6.5): conversations
-- has existed since the original schema but was never actually writable (no
-- insert policy) or anchorable (no way to tie a thread to a student/session/
-- invoice/homework item) or channel-aware (no way to distinguish a DM from a
-- class broadcast channel). This migration adds what Inbox needs without
-- touching the existing messages/conversations select policies.

alter table conversations
  add column kind text not null default 'dm' check (kind in ('dm', 'class_channel')),
  add column anchor_type text check (anchor_type in ('student', 'session', 'invoice', 'homework', 'class')),
  add column anchor_id uuid;

-- Nothing could create a conversation before this — Messaging.tsx never used
-- this table at all, it only ever wrote directly into messages and
-- synthesized "threads" client-side by grouping on sender/receiver pairs.
-- Anyone in the org can start a DM they're a participant of; only staff can
-- create a class_channel (mirrors class_templates' staff-only write
-- policies). is_org_member() is required on top of the participant check —
-- without it, an outsider could plant a conversation row under someone
-- else's organization_id just by naming themselves in participant_ids.
create policy conversations_insert on conversations for insert
  with check (
    is_org_member(organization_id)
    and auth.uid() = any(participant_ids)
    and (kind = 'dm' or is_staff(organization_id))
  );

create index conversations_anchor_idx on conversations (anchor_type, anchor_id) where anchor_type is not null;
-- Lets ensureClassChannel() upsert idempotently: one channel per (org, class_templates.id).
create unique index conversations_class_channel_idx on conversations (organization_id, anchor_id) where kind = 'class_channel';

-- Backfill: pre-existing messages never had conversation_id populated
-- (Messaging.tsx grouped by sender/receiver pair client-side instead). Do the
-- same grouping once here so Inbox has real threads for existing history
-- instead of starting empty.
do $$
declare
  pair record;
  new_conversation_id uuid;
begin
  for pair in
    select
      organization_id,
      least(sender_id, receiver_id) as user_a,
      greatest(sender_id, receiver_id) as user_b
    from messages
    where conversation_id is null and receiver_id is not null
    group by organization_id, least(sender_id, receiver_id), greatest(sender_id, receiver_id)
  loop
    insert into conversations (organization_id, participant_ids, kind)
    values (pair.organization_id, array[pair.user_a, pair.user_b], 'dm')
    returning id into new_conversation_id;

    update messages
    set conversation_id = new_conversation_id
    where conversation_id is null
      and organization_id = pair.organization_id
      and least(sender_id, receiver_id) = pair.user_a
      and greatest(sender_id, receiver_id) = pair.user_b;
  end loop;
end $$;

-- Per-viewer triage state (archive/snooze) — REDESIGN §6.5's triage
-- affordances. Deliberately separate from `conversations`: archiving or
-- snoozing is a per-viewer decision, not a shared thread property. A tutor
-- archiving a thread must not hide it from the parent still waiting on it.
-- "Waiting for reply" is deliberately NOT stored here — it's derived
-- client-side from message order (src/lib/inbox.ts), so it can't go stale.
create table inbox_state (
  conversation_id uuid not null references conversations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  archived_at timestamptz,
  snoozed_until timestamptz,
  updated_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

alter table inbox_state enable row level security;

create policy inbox_state_rw on inbox_state for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
