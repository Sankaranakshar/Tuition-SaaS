# Self-hosted Supabase setup

Infra (Docker containers) is not vendored into this repo — it lives in Supabase's
own maintained `docker` directory so you get their fixes/upgrades for Kong, Realtime,
GoTrue, etc. This repo only carries the SQL migrations and app code that point at it.

## 1. Stand up the stack (on the VM)

```bash
git clone --depth 1 https://github.com/supabase/supabase
cd supabase/docker
cp .env.example .env
# Edit .env: set POSTGRES_PASSWORD, JWT_SECRET (32+ chars), ANON_KEY, SERVICE_ROLE_KEY
# (generate ANON_KEY/SERVICE_ROLE_KEY from JWT_SECRET — see Supabase self-hosting docs'
# "Generate API Keys" step), SITE_URL (your app's URL), SMTP_* if you want auth emails.
docker compose up -d
```

Studio will be reachable at `http://<vm-ip>:8000` (through Kong), Postgres at port 5432.
**Do not expose 5432 or the Studio port publicly without a firewall/VPN** — lock down
with `ufw`/security groups to your IP and the app server only.

## 2. Apply migrations

Run the files in this directory in order against the stack's Postgres
(`postgres://postgres:$POSTGRES_PASSWORD@<vm-ip>:5432/postgres`). `0004_storage.sql`
creates the private `documents` Storage bucket used by `server/routes/documents.ts`;
any `NNNN_*_fields.sql` files are additive column migrations discovered while
porting individual pages — apply them all, in filename order:

```bash
for f in supabase/migrations/*.sql; do psql "$DATABASE_URL" -f "$f"; done
```

## 3. App env vars

Add to `.env` (app repo, not the Supabase stack's `.env`):

```
SUPABASE_URL=http://<vm-ip>:8000
SUPABASE_ANON_KEY=<from supabase/docker/.env ANON_KEY>
SUPABASE_SERVICE_ROLE_KEY=<from supabase/docker/.env SERVICE_ROLE_KEY>
```

- Client code (`src/`) uses `SUPABASE_URL` + `SUPABASE_ANON_KEY` — subject to RLS.
- Server code (`server/`) uses `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` — bypasses
  RLS, same trust boundary `firebase-admin` had.
- The billing/scheduling routes additionally need `DATABASE_URL` (a direct Postgres
  connection string, e.g. `postgres://postgres:$POSTGRES_PASSWORD@<vm-ip>:5432/postgres`)
  — PostgREST is one request per call, so it can't hold a row lock across a
  read-then-write the way Firestore's `runTransaction` could. `server/db.ts` opens
  real `BEGIN`/`COMMIT` transactions over this connection instead.

## 4. Google OAuth (for the existing "Sign in with Google" flow)

In `supabase/docker/.env`, set `GOTRUE_EXTERNAL_GOOGLE_ENABLED=true` plus
`GOTRUE_EXTERNAL_GOOGLE_CLIENT_ID` / `GOTRUE_EXTERNAL_GOOGLE_SECRET` (reuse the same
Google OAuth client already configured for Firebase Auth — just add
`http://<vm-ip>:8000/auth/v1/callback` as an authorized redirect URI in the Google
Cloud Console).

## 5. Phone/OTP

Self-hosted GoTrue needs an SMS provider for `signInWithOtp` (phone) to work —
set `GOTRUE_SMS_PROVIDER` + credentials (Twilio is the most common choice) in
`supabase/docker/.env`. This is a new account/config requirement — Firebase Auth's
phone OTP had this bundled, self-hosted GoTrue does not.

## Moving providers later (AWS/GCP)

Because everything above is just Docker containers + a Postgres database, moving
providers is: `pg_dump` the database, stand up the same `docker compose` stack on the
new host (ECS/EKS/GKE/Cloud Run + a managed or self-hosted Postgres), `pg_restore`,
point DNS/env vars at the new `SUPABASE_URL`. No schema or application code changes.
