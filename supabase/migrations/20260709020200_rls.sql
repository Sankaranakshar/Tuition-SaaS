-- Phase 0: RLS policies, translated from firestore.rules helper functions.
-- Money tables stay writable only by the service_role key (the Express backend),
-- mirroring today's "Admin SDK only" pattern — service_role bypasses RLS entirely
-- in Supabase, same trust boundary as firebase-admin has today.

create or replace function is_org_member(org_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from organization_members
    where organization_id = org_id and user_id = auth.uid()
  );
$$;

create or replace function has_role(org_id uuid, roles text[])
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from organization_members
    where organization_id = org_id and user_id = auth.uid() and role = any(roles)
  );
$$;

create or replace function is_staff(org_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select has_role(org_id, array['owner','admin','tutor','frontdesk','accountant']);
$$;

create or replace function is_org_admin(org_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select has_role(org_id, array['owner','admin']);
$$;

create or replace function is_parent_of(p_student_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from parent_links
    where student_id = p_student_id and parent_user_id = auth.uid()
  );
$$;

create or replace function is_student_self(p_student_id uuid)
returns boolean language sql stable security definer set search_path = public, pg_temp as $$
  select exists (
    select 1 from students
    where id = p_student_id and student_user_id = auth.uid()
  );
$$;

-- Enable RLS everywhere.
do $$
declare t text;
begin
  for t in select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;

-- organizations: members can read; no client create/delete (server-only via service_role).
create policy org_select on organizations for select
  using (is_org_member(id));
create policy org_update on organizations for update
  using (is_org_admin(id));

-- organization_members: server-only writes (Phase 1 rewrites members.ts to use service_role).
create policy org_members_select on organization_members for select
  using (is_org_member(organization_id));

-- profiles: self or org staff/admin read; self create/update only.
create policy profiles_select on profiles for select
  using (id = auth.uid() or is_staff(organization_id));
create policy profiles_upsert on profiles for insert
  with check (id = auth.uid());
create policy profiles_update on profiles for update
  using (id = auth.uid());

-- tutor/parent/student profile tables: same self-or-staff shape.
create policy tutor_profiles_rw on tutor_profiles for all
  using (user_id = auth.uid() or is_staff(organization_id))
  with check (user_id = auth.uid());
create policy parent_profiles_rw on parent_profiles for all
  using (user_id = auth.uid() or is_staff(organization_id))
  with check (user_id = auth.uid());
create policy student_profiles_rw on student_profiles for all
  using (user_id = auth.uid() or is_staff(organization_id))
  with check (user_id = auth.uid());

-- students: staff full CRUD (soft-delete only enforced app-side); parent/self read;
-- tutor limited-field update enforced app-side (RLS can't easily diff old/new columns
-- the way firestore.rules onlyChanges() did — keep that guard in the API route).
create policy students_select on students for select
  using (is_staff(organization_id) or is_parent_of(id) or is_student_self(id));
create policy students_staff_write on students for insert
  with check (is_staff(organization_id));
create policy students_staff_update on students for update
  using (is_staff(organization_id));

-- leads / programs / courses / class_templates / tutor_availability / session_requests:
-- straightforward org-scoped staff CRUD.
create policy leads_rw on leads for all
  using (is_staff(organization_id)) with check (is_staff(organization_id));
create policy programs_read on programs for select using (is_org_member(organization_id));
create policy programs_write on programs for all
  using (is_org_admin(organization_id)) with check (is_org_admin(organization_id));
create policy courses_read on courses for select using (is_org_member(organization_id));
create policy courses_write on courses for all
  using (is_org_admin(organization_id)) with check (is_org_admin(organization_id));
create policy class_templates_read on class_templates for select using (is_org_member(organization_id));
create policy class_templates_write on class_templates for all
  using (is_org_admin(organization_id)) with check (is_org_admin(organization_id));
create policy tutor_availability_rw on tutor_availability for all
  using (tutor_id = auth.uid() or is_org_admin(organization_id))
  with check (tutor_id = auth.uid() or is_org_admin(organization_id));
create policy session_requests_select on session_requests for select
  using (requested_by_user_id = auth.uid() or is_staff(organization_id));
create policy session_requests_insert on session_requests for insert
  with check (requested_by_user_id = auth.uid());

-- class_sessions: create/status-transition stays server-only (Phase 3 double-booking
-- check needs FOR UPDATE locking that only the service_role backend performs);
-- staff and participants (via student_ids/parent_user_ids arrays) can read.
create policy class_sessions_select on class_sessions for select
  using (
    is_staff(organization_id)
    or tutor_id = auth.uid()
    or auth.uid() = any(student_ids)
    or auth.uid() = any(parent_user_ids)
  );

-- enrollments: create is server-only (capacity check, Phase 3); read is staff/self.
create policy enrollments_select on enrollments for select
  using (is_staff(organization_id) or is_student_self(student_id) or is_parent_of(student_id));

-- money tables: fully server-only (service_role bypasses RLS, no policies = no client access).
create policy invoices_select on invoices for select
  using (is_staff(organization_id) or is_student_self(student_id) or is_parent_of(student_id));
create policy payments_select on payments for select
  using (is_staff(organization_id));
create policy wallets_select on wallets for select
  using (is_staff(organization_id) or is_student_self(student_id) or is_parent_of(student_id));
create policy wallet_ledger_select on wallet_ledger for select
  using (is_staff(organization_id) or is_student_self(student_id) or is_parent_of(student_id));
create policy transactions_select on transactions for select
  using (is_staff(organization_id));
create policy attendance_records_select on attendance_records for select
  using (is_staff(organization_id) or is_student_self(student_id) or is_parent_of(student_id));
create policy billing_events_select on billing_events for select
  using (is_staff(organization_id));
-- refunds, payment_gateways: no select policy for clients at all — staff-console reads for
-- these go through the Express API (service_role), not direct client queries.

-- assessments / documents: staff + parent/self read; documents self-upload path handled
-- in the Phase 4 route (server validates uploader before insert).
create policy assessments_select on assessments for select
  using (is_staff(organization_id) or is_student_self(student_id) or is_parent_of(student_id));
create policy documents_select on documents for select
  using (is_staff(organization_id) or is_student_self(student_id) or is_parent_of(student_id) or uploaded_by_user_id = auth.uid());
create policy documents_insert on documents for insert
  with check (uploaded_by_user_id = auth.uid() and (is_staff(organization_id) or is_student_self(student_id) or is_parent_of(student_id)));

-- conversations / messages: participant-scoped.
create policy conversations_select on conversations for select
  using (auth.uid() = any(participant_ids));
create policy messages_select on messages for select
  using (sender_id = auth.uid() or receiver_id = auth.uid());
create policy messages_insert on messages for insert
  with check (sender_id = auth.uid());

-- notifications: owner read/update; create is server/staff only.
create policy notifications_select on notifications for select
  using (user_id = auth.uid());
create policy notifications_update on notifications for update
  using (user_id = auth.uid());
create policy notifications_insert on notifications for insert
  with check (is_staff(organization_id));

-- audit_events / org_stats_daily / feature_flags / google_tokens / subscriptions:
-- admin read only, no client writes.
create policy audit_events_select on audit_events for select using (is_org_admin(organization_id));
create policy org_stats_daily_select on org_stats_daily for select using (is_org_admin(organization_id));
create policy feature_flags_select on feature_flags for select using (is_org_member(organization_id));
create policy subscriptions_select on subscriptions for select using (is_org_admin(organization_id));
-- google_tokens, payment_gateways: no client policies — service_role (Express) only,
-- same as today (encrypted creds, admin-SDK-only in firestore.rules).

-- parent_links / parent_invites: server-only writes (Phase 3 redemption flow),
-- but parents/staff can read their own links.
create policy parent_links_select on parent_links for select
  using (parent_user_id = auth.uid() or is_staff(organization_id));
