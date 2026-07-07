# ClassStackr

Tuition management that collects your fees. Scheduling, attendance, billing, and parent communication for tuition centers and independent tutors.

**Project documents:** [REDESIGN.md](REDESIGN.md) (product experience), [GO_TO_MARKET_BLUEPRINT.md](GO_TO_MARKET_BLUEPRINT.md) (architecture, security, GTM), [DEV_PLAN.md](DEV_PLAN.md) (the executable plan; Stage 0 is implemented).

## Architecture

- **Frontend:** React 19 + Vite + Tailwind 4, talking directly to Firestore for reads and benign writes, enforced by `firestore.rules`.
- **API (Express, stateless):** privileged mutations only — org membership/claims (`/api/v1/members`), attendance + money (`/api/v1/billing`), Google OAuth (`/api/v1/settings`). No SQLite, no local file storage.
- **Authorization:** roles live in server-written `organization_members` docs and Firebase custom claims. Client documents carry no authority. Financial collections (`invoices`, `payments`, `wallets`, `wallet_ledger`, `attendance_records`) have zero client write paths.
- **The RBAC constitution:** `tests/rules/rbac.test.ts` encodes the permission matrix. Any change to `firestore.rules` or a privileged endpoint must keep it green.

## Development

```bash
npm install
cp .env.example .env        # fill in Firebase + Google OAuth + secrets
npm run dev                  # Express + Vite on :3000 (PORT env respected)
```

Secrets: generate `JWT_SECRET` and `ENCRYPTION_KEY` with `openssl rand -hex 32`. In production both belong in Secret Manager.

## Testing

```bash
npm run lint        # typecheck
npm test            # unit tests (money math, formatting)
npm run test:rules  # Firestore rules suite (needs Java + firebase-tools)
```

CI (`.github/workflows/ci.yml`) runs typecheck, unit tests, the rules suite against the emulator, and the production build on every PR.

## Deployment

- `Dockerfile` builds a stateless image (SPA + API) for Cloud Run.
- `firebase deploy --only firestore:rules,firestore:indexes,storage` publishes rules and indexes (`firebase.json`, `firestore.indexes.json`, `storage.rules`).
- Rate limiting is per authenticated user (falls back to IP), 120 req/min.

## Security invariants (do not regress)

1. Roles are set only via `/api/v1/members` (custom claims + membership doc, tokens revoked on change).
2. Money mutations go only through `/api/v1/billing` with idempotency keys; every mutation writes an `audit_events` record.
3. Attendance marking is a single Firestore transaction covering attendance records, wallet debits, and invoice accrual.
4. Amounts are integer paise in new fields (`totalPaise`, `paidPaise`); rupee floats exist only as legacy display fields.
5. `google_tokens` (AES-256-GCM encrypted, `v1:` key-version prefix) and `audit_events` have no client access path at all.
