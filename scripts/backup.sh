#!/usr/bin/env bash
# Nightly backup: pg_dump's the Supabase project directly. Self-hosted means
# there's no Firebase-style automatic backup; this is the safety net
# DEV_PLAN.md's "Backup/restore" MVP item calls for.
#
# `supabase db dump --linked` was tried first and rejected: the Supabase CLI
# shells out to a pg_dump it runs inside a Docker container it manages, so it
# fails outright wherever Docker isn't installed. This script instead uses a
# real standalone pg_dump (Homebrew: `brew install libpq`, keg-only — not on
# PATH by default) against BACKUP_DATABASE_URL directly.
#
# BACKUP_DATABASE_URL must be the DIRECT connection (port 5432), not the
# transaction-mode pooler (port 6543, what server/db.ts and DATABASE_URL use)
# — pgbouncer's transaction mode doesn't support the session-level features
# pg_dump needs. Get it from Supabase Dashboard -> Project Settings ->
# Database -> Connection string -> "Direct connection".
#
# Usage: BACKUP_DATABASE_URL="postgresql://postgres:PASSWORD@db.<ref>.supabase.co:5432/postgres" ./scripts/backup.sh
# Schedule with cron/Cloud Scheduler for a nightly run, e.g.:
#   0 3 * * * cd /path/to/repo && BACKUP_DATABASE_URL="..." ./scripts/backup.sh >> backups/backup.log 2>&1
#
# Restore procedure (rehearse this before you need it for real):
#   1. Stand up a throwaway Postgres target — either a local Postgres/Docker
#      instance or a second scratch Supabase project. Never restore into the
#      live project to "test" a restore.
#   2. psql "$TARGET_DATABASE_URL" -f backups/<timestamp>.sql
#   3. Verify: row counts on a few key tables match the source
#      (organizations, students, invoices), and the app boots and logs in
#      against the restored database.

set -euo pipefail
cd "$(dirname "$0")/.."

if [ -z "${BACKUP_DATABASE_URL:-}" ]; then
  echo "BACKUP_DATABASE_URL is not set — see the comment at the top of this script." >&2
  exit 1
fi

PG_DUMP="${PG_DUMP:-pg_dump}"
if ! command -v "$PG_DUMP" >/dev/null 2>&1; then
  # Homebrew's libpq is keg-only and not symlinked onto PATH by default.
  if [ -x /opt/homebrew/opt/libpq/bin/pg_dump ]; then
    PG_DUMP=/opt/homebrew/opt/libpq/bin/pg_dump
  else
    echo "pg_dump not found. Install with: brew install libpq" >&2
    exit 1
  fi
fi

mkdir -p backups
TIMESTAMP=$(date +%Y%m%d-%H%M%S)
OUT="backups/backup-${TIMESTAMP}.sql"

# Strip ?pgbouncer=true if present (a Supabase pooler-URL convention that
# app code needs but libpq's pg_dump doesn't recognize as a valid parameter).
DUMP_URL="${BACKUP_DATABASE_URL%%\?pgbouncer=true}"

echo "Dumping to ${OUT}..."
"$PG_DUMP" "$DUMP_URL" --no-owner --no-privileges -f "$OUT"

echo "Done: ${OUT} ($(du -h "$OUT" | cut -f1))"
