-- Phase 4: Supabase Storage bucket for student documents (replaces Firebase
-- Storage). Private bucket — clients never get a permanent public link, only
-- short-lived signed URLs minted by the server (server/routes/documents.ts).
insert into storage.buckets (id, name, public)
values ('documents', 'documents', false)
on conflict (id) do nothing;

-- No client storage.objects policies: all reads/writes to this bucket go
-- through the service_role key in server/routes/documents.ts (signed URLs,
-- magic-byte content sniffing, filename sanitization), same posture as the
-- old Storage rules which had no client-writable path either.
