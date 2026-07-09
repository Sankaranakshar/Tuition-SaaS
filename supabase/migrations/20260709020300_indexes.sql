-- Phase 0: indexes, ported from firestore.indexes.json composite indexes.

create index idx_class_sessions_org_tutor_start on class_sessions (organization_id, tutor_id, start_time);
create index idx_class_sessions_org_status_start on class_sessions (organization_id, status, start_time);
create index idx_class_sessions_student_ids on class_sessions using gin (student_ids);
create index idx_class_sessions_parent_user_ids on class_sessions using gin (parent_user_ids);

create index idx_invoices_org_status_due on invoices (organization_id, status, due_date);
create index idx_invoices_org_tutor_created on invoices (organization_id, tutor_id, created_at desc);
create index idx_invoices_org_created on invoices (organization_id, created_at desc);

create index idx_leads_org_created on leads (organization_id, created_at desc);

create index idx_messages_org_sender_created on messages (organization_id, sender_id, created_at desc);
create index idx_messages_org_receiver_created on messages (organization_id, receiver_id, created_at desc);

create index idx_attendance_org_student_start on attendance_records (organization_id, student_id, session_start desc);

create index idx_enrollments_template_status on enrollments (template_id, status);

create index idx_wallet_ledger_org_student_at on wallet_ledger (organization_id, student_id, at desc);

-- Common lookups not present as Firestore composite indexes (single-field
-- equality was auto-indexed by Firestore; Postgres needs these explicit).
create index idx_org_members_user on organization_members (user_id);
create index idx_students_org on students (organization_id);
create index idx_documents_org_student on documents (organization_id, student_id);
create index idx_notifications_user_read on notifications (user_id, read);
