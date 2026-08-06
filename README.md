# ClassStackr

Tuition management that collects your fees. Scheduling, attendance, billing, and parent communication for tuition centers and independent tutors.

**Project documents:** [MASTER_PLAN.md](MASTER_PLAN.md) (start here: source map, release plan, ranked backlog, open founder decisions), [EXECUTION_PLAN.md](EXECUTION_PLAN.md) (step-by-step, checkbox-trackable execution order for the current release), [HANDOFF.md](HANDOFF.md) (current state, architecture, runbook, invariants), [DEV_PLAN.md](DEV_PLAN.md) (tech-debt detail, superseded release numbering), [REDESIGN.md](REDESIGN.md) (product experience), [GO_TO_MARKET_BLUEPRINT.md](GO_TO_MARKET_BLUEPRINT.md) (GTM strategy; its architecture and security sections are Firestore-era history).

## Architecture

- **Frontend:** React 19 + Vite + Tailwind 4 SPA, talking directly to Supabase (PostgREST) for reads, enforced by Postgres Row Level Security (RLS). Every privileged write goes through the Express API instead.
- **API (Express, stateless):** privileged mutations only — org membership/roles (`/api/v1/members`), attendance + money (`/api/v1/billing`), scheduling, documents, subscriptions, super-admin, org export, audit log. Deployed both as a traditional Node server (`server.ts`) and as a Vercel serverless function (`server/vercelHandler.ts` → `api/index.js`).
- **Authorization:** `authenticateToken` verifies the Supabase JWT per request (JWKS, HS256 fallback), then does a fresh `organization_members` lookup for role/org. No custom claims and no token-revocation dance — a role change takes effect on the next API call. RLS is the authorization boundary for direct-to-Supabase reads.
- **Money:** integer paise, server-authoritative, `FOR UPDATE` row locks and idempotency keys via a direct `pg` transaction (PostgREST can't hold a lock across a read-then-write). Razorpay per-org payment links, webhook-reconciled.
- **The RBAC constitution:** the RLS test suite (`tests/integration/`) plus the route-contract suite (`tests/contract/`) encode the permission matrix. Any change to a migration's RLS policy or a privileged endpoint must keep both green.

## Development

```bash
npm install
cp .env.example .env        # fill in Supabase + secrets, see .env.example for where each comes from
npm run dev                  # Express + Vite on :3000 (PORT env respected)
npm run seed                  # idempotent demo org, tutor, courses, students, sessions
```

Secrets: generate `JWT_SECRET`, `ENCRYPTION_KEY`, and `CRON_SECRET` with `openssl rand -hex 32`. In production these belong in your host's secret manager.

**There is no staging environment.** Local dev points at the production Supabase project — be deliberate about test data and clean up after walkthroughs.

## Testing

```bash
npm run lint         # typecheck
npm test             # unit tests
npm run test:rls     # RLS/RBAC suite, PGlite-backed, no Docker or live database needed
npm run test:contract # route-contract suite (supertest against the real Express app, PGlite-backed)
npm run test:load:smoke # k6 load test against a running server (not run in CI)
```

CI (`.github/workflows/ci.yml`) runs typecheck, a report-only `npm audit`, unit, RLS, route-contract, the production build, the bundle-size budget, and a rebuild+verify of the Vercel API bundle on every PR — all seven gates, none needing Docker, Java, or a live database.

## Deployment

- Live at `https://tuition-saas-two.vercel.app` (Vercel project `tuition-saas`), Supabase Cloud project `cwugpiernnwrhcximjwh`. Push to `main` auto-deploys.
- `supabase db push` applies migrations to the hosted project — a separate step from a green local RLS suite; forgetting it is a recurring trap (see HANDOFF.md §8).
- Vercel's build command produces `api/index.js` from `server/vercelHandler.ts`; that file is committed because Vercel only registers functions it can see in a git scan.
- Rate limiting is per authenticated user (falls back to IP for unauthenticated requests), 120 req/min.

## Security invariants (do not regress)

1. Roles are set only via `/api/v1/members`. Never write `organization_members` from the client.
2. Money mutates only via `/api/v1/billing`, idempotency-keyed; every mutation writes an `audit_events` row. `invoices`, `payments`, `wallets`, `wallet_ledger`, and `refunds` have no client write policy at all.
3. Attendance marking is one real transaction covering the attendance record, wallet debit, and invoice accrual.
4. Money is integer paise (`*_paise` columns). The `total_amount`/`subtotal` rupee columns are legacy display mirrors, not sources of truth.
5. Server-only tables (`google_tokens`, `audit_events`, `payment_gateways`, `refunds`, `platform_admins`, and others) have RLS enabled with no policy at all — default-deny for everything except `service_role`.
6. Every webhook is HMAC-verified before its body is trusted. The raw-body mount in `server/app.ts` sits before JSON parsing and rate limiting — do not reorder it.

See [HANDOFF.md](HANDOFF.md) for the full list and the traps this stack has already sprung.
