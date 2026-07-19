-- public.notes was never part of this app's schema -- it's leftover seed
-- data from Supabase's own quickstart tutorial ("Today I created a Supabase
-- project... queried it from Next.js"), created directly on the hosted
-- project outside migrations. RLS-enabled-no-policy on it (2026-07-19 audit)
-- was correctly deny-all, but it's dead surface with no app code reference
-- anywhere in server/, api/, or src/. Confirmed row contents before dropping.
drop table if exists public.notes;
