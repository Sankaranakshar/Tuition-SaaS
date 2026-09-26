-- D-06 / EXECUTION_PLAN.md Step 30 (C-05): every message between a tutor and
-- a student is visible to that student's parent, unconditionally.
--
-- Before this migration conversations_select was participant-only and a DM's
-- participant_ids holds exactly two auth uids, so a parent was structurally
-- unable to see a tutor-student thread, while useMessageableContacts() let
-- any staff member start one with any student in the org.
--
-- Mechanism (chosen deliberately, see Step 30): the parent is NOT added to
-- participant_ids. That would break findOrCreateDirectConversation()'s
-- two-element `contains` lookup and make the parent look like a sender.
-- Instead:
--   1. conversations.student_id, a dedicated anchor to the student row. It is
--      separate from anchor_type/anchor_id, which is the thread's *context*
--      (an invoice, a homework item) and can legitimately point elsewhere.
--   2. A trigger sets student_id from the participants on every DM write, so
--      no caller (client insert, server route, a future marketplace path)
--      can omit it or point it at a different child. A caller-supplied value
--      that doesn't match is rejected.
--   3. conversations_select / messages_select widened with
--      is_parent_of(student_id). Read-only: messages_insert now requires the
--      sender to be a real participant of the conversation, so a guardian can
--      read a thread but never post into it (D-06 reply decision, 2026-09-26,
--      MASTER_PLAN.md §13).

alter table conversations
  add column student_id uuid references students(id) on delete set null;

create index conversations_student_idx on conversations (student_id) where student_id is not null;

-- Backfill existing DMs before the trigger exists, so a legacy row with an
-- unexpected shape can't abort the migration. Picks the live, newest student
-- row when one student uid somehow has more than one row in the org.
update conversations c
set student_id = (
  select s.id from students s
  where s.organization_id = c.organization_id
    and s.student_user_id = any(c.participant_ids)
  order by s.is_deleted asc, s.created_at desc
  limit 1
)
where c.kind = 'dm' and c.student_id is null;

-- Reported, not failed: a legacy DM between two students got one anchor
-- above. New ones are rejected by the trigger below.
do $$
declare
  v_anchored int;
  v_multi int;
begin
  select count(*) into v_anchored from conversations where student_id is not null;
  select count(*) into v_multi
  from conversations c
  where c.kind = 'dm'
    and (select count(distinct s.student_user_id) from students s
         where s.organization_id = c.organization_id and s.student_user_id = any(c.participant_ids)) > 1;
  raise notice 'guardian_thread_visibility: % DM(s) anchored to a student, % legacy student-to-student DM(s)', v_anchored, v_multi;
end $$;

create or replace function conversations_resolve_student_anchor()
returns trigger language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_student_users int;
  v_student_id uuid;
begin
  if new.kind <> 'dm' then
    -- Class channels already carry every rostered parent as a participant
    -- (server/routes/inbox.ts's resolveClassParticipantIds).
    if new.student_id is not null then
      raise exception 'only a direct message can be anchored to a student' using errcode = '23514';
    end if;
    return new;
  end if;

  select count(distinct s.student_user_id) into v_student_users
  from students s
  where s.organization_id = new.organization_id
    and s.student_user_id = any(new.participant_ids);

  if v_student_users > 1 then
    raise exception 'direct messages between two students are not supported' using errcode = '23514';
  end if;

  if new.student_id is not null then
    if not exists (
      select 1 from students s
      where s.id = new.student_id
        and s.organization_id = new.organization_id
        and s.student_user_id = any(new.participant_ids)
    ) then
      raise exception 'student anchor does not match the student in this conversation' using errcode = '23514';
    end if;
    return new;
  end if;

  select s.id into v_student_id
  from students s
  where s.organization_id = new.organization_id
    and s.student_user_id = any(new.participant_ids)
  order by s.is_deleted asc, s.created_at desc
  limit 1;

  new.student_id := v_student_id;
  return new;
end $$;

create trigger conversations_student_anchor
  before insert or update of participant_ids, student_id, kind, organization_id on conversations
  for each row execute function conversations_resolve_student_anchor();

-- Trigger-only, never an RPC (same posture as 20260719140000_linter_hardening.sql).
revoke execute on function conversations_resolve_student_anchor() from anon, authenticated;

-- RLS helpers. Unlike the trigger function, these must stay executable by
-- `authenticated`: policies call them from USING / WITH CHECK.
create or replace function can_read_conversation(p_conversation_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from conversations c
    where c.id = p_conversation_id
      and (auth.uid() = any(c.participant_ids)
           or (c.student_id is not null and is_parent_of(c.student_id)))
  );
$$;

create or replace function can_post_to_conversation(p_conversation_id uuid, p_org_id uuid, p_receiver_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from conversations c
    where c.id = p_conversation_id
      and c.organization_id = p_org_id
      and auth.uid() = any(c.participant_ids)
      and (p_receiver_id is null or p_receiver_id = any(c.participant_ids))
  );
$$;

drop policy conversations_select on conversations;
create policy conversations_select on conversations for select
  using (
    auth.uid() = any(participant_ids)
    or (student_id is not null and is_parent_of(student_id))
  );

-- Readable if you sent it, received it, or can read its conversation. The
-- third clause also lets every participant of a class channel read its
-- broadcasts (receiver_id is null there), which the old sender/receiver-only
-- policy silently denied to everyone but the sender.
drop policy messages_select on messages;
create policy messages_select on messages for select
  using (
    sender_id = auth.uid()
    or receiver_id = auth.uid()
    or (conversation_id is not null and can_read_conversation(conversation_id))
  );

-- Previously `sender_id = auth.uid()` alone: anyone could post into any
-- conversation id, under any org, addressed to any user. Now the sender must
-- be a participant of a conversation in the same org, and a receiver (if
-- named) must be a participant too. This is what makes guardian access
-- read-only rather than a policy nobody enforces.
drop policy messages_insert on messages;
create policy messages_insert on messages for insert
  with check (
    sender_id = auth.uid()
    and can_post_to_conversation(conversation_id, organization_id, receiver_id)
  );
