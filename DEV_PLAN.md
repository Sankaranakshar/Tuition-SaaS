# ClassStackr Development Plan (Supabase era)

_Rewritten from scratch on 2026-07-10, after the Firebase → self-hosted Supabase/Postgres migration (HANDOFF.md §11). The previous DEV_PLAN.md was Firestore-era and is superseded by this document; its product intent survives in REDESIGN.md and GO_TO_MARKET_BLUEPRINT.md. This plan treats the current repository as the baseline: completed work is listed as status, not as future tasks._

**Stack (current, verified):** React 19 + Vite + Tailwind 4 SPA, stateless Express API (`server/`), self-hosted Supabase (Postgres + RLS, GoTrue auth, Realtime, Storage), direct `pg` transactions for money/scheduling, Razorpay per-org payment links.

**Audit basis:** every claim in "Current Status" was re-verified against the code on 2026-07-10: `tsc --noEmit` clean, 51/51 unit tests, 40/40 RLS integration tests (PGlite), production build passing. Nothing in this repo has ever run against a live Supabase instance or a browser; that gap defines the blocker list.

---

## 1. Current Status

### Done and verified (locally, static + test-suite level)

- **Migration complete.** Zero Firebase/Firestore code remains (comments only). No firebase deps in package.json. Auth is GoTrue JWT (HS256, verified locally per request) + a fresh `organization_members` lookup per API call; no custom claims, no token-revocation dance.
- **Database:** 37 tables in `supabase/migrations/0001_schema.sql`, RLS enabled on every table (`0002_rls.sql` + fix migrations 0009/0011/0012/0013), money tables server-only (no client write policies), composite indexes (`0003_indexes.sql`), private storage bucket (`0004_storage.sql`).
- **Server-authoritative money:** attendance, manual payments, wallet top-up, refunds, invoice finalize/void/payment-link, all inside real `pg` transactions with `FOR UPDATE` row locks, idempotency keys, and `audit_events` writes.
- **Payments (Epic 6):** per-org Razorpay creds (AES-GCM encrypted, write-only), payment links, HMAC-verified webhooks mounted on a raw-body parser before JSON/rate-limit middleware, hourly reconcile endpoint, gap-free invoice numbering, GST snapshot, server-side PDF invoices.
- **Scheduling:** server-side enrollment capacity + tutor conflict checks in transactions; session materialization (rolling 8-week window, idempotent, cron-triggered); the `class_sessions` three-array id-space model (`student_ids` record ids, `student_user_ids`/`parent_user_ids` auth uids) with `resolveUserIds()` as the mandatory write path.
- **Today workspace (Epic 9):** pure tested core (`src/lib/today.ts`, 26 tests), session Line, one-tap optimistic attendance with undo-then-flush, attention queue, Pulse, admin per-tutor lanes. Legacy Dashboard deleted.
- **Parent portal (Epic 10):** staff-minted single-use invites, phone-OTP redeem with DPDP consent capture, mobile-first portal (overview/invoices/wallet), Pay Now via hosted Razorpay page, WhatsApp share, PDF download.
- **Security test suite:** `npm run test:rls` (40 assertions, PGlite, no Docker/Java) is the constitution. It has caught two real shipped bugs (profiles org immutability, class_sessions id-space). CI runs typecheck → unit → RLS → build.
- **Hygiene:** Sentry (both sides, DSN-gated), pino with redaction, helmet, per-user rate limiting, JSON 404s, central error handler with Zod → 422, graceful shutdown, error boundaries per route, bounded + org-scoped queries throughout, INR formatting everywhere.

### Deferred by design (external blockers, not engineering)

- **Epic 7, outbound comms** (WhatsApp Business API, SMS DLT, email domain verification): blocked on provider onboarding. Manual UPI-link sharing covers the gap.
- **Epic 8, Google Calendar/Meet:** blocked on OAuth consent-screen verification. Sessions degrade to "link pending".

### Built but never runtime-verified (the single biggest risk)

Everything above passes static checks and tests, but **no code in this repository has ever executed against a live Supabase instance, a real browser, real GoTrue auth, Realtime, Storage, or Razorpay.** The 63 `onSnapshot` call sites were rewritten to `postgres_changes` refetch patterns without ever connecting to a Realtime server. Treat every feature as "expected working" until Blocker 1 below is cleared.

### Not started

- Stage 2 workspaces (Student Story, People, Money, Inbox, Onboarding rebuild): Epics 11 to 14.
- Stage 3 (Schedule rebuild, SaaS subscription billing, super-admin, hardening gauntlet): Epics 15 to 17.
- Stage 4 (mobile polish, growth loop, AI brief): Epics 18 to 20.
- Legacy pages still live inside the new shell, functional but not token-styled: StudentProfile (1,308 lines), Calendar, Students, Invoices, Bookings, Timetable, Wallet, Transactions, Messaging, Notifications, Settings/Profile/Preferences.

---

## 2. Immediate Blockers (ranked)

1. **Apply the migrations to the hosted project and run the app for the first time.** As of 2026-07-10 no migration has ever been applied to any live database — the Supabase Cloud project (`cwugpiernnwrhcximjwh`) exists but is empty. Direction is now decided (hosted Cloud) and the repo is prepared: migrations renamed to `db push` format, `supabase/config.toml` added, `.env.example` + `supabase/README.md` updated for hosted (see §Option A). What remains **needs your Supabase login/DB password and cannot be done from here**:
   - `brew install supabase/tap/supabase` → `supabase login` → `supabase link --project-ref cwugpiernnwrhcximjwh` → `supabase db push` (or paste the migrations into the SQL editor in filename order).
   - Fill real env values (`VITE_SUPABASE_URL`, anon key, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL` pooler URI) from Dashboard → Project Settings.
   Nothing else on this list is meaningful until this works.
2. **First end-to-end walkthrough:** signup → org bootstrap → add student → book session → student sees own session (the exact §11.4 regression) → Today attendance → invoice accrual → manual payment → ledger. Fix whatever breaks; expect breakage in Realtime subscriptions and auth flows since they have never run.
3. **GoTrue configuration:** Google OAuth redirect URI; SMS provider (Twilio or MSG91) for phone OTP, which the parent portal hard-depends on.
4. **Payment loop wiring:** Razorpay live KYC (long lead, start now), per-org key connection, webhook URL registration, real ₹ test payment, hourly reconcile + session-materialization cron jobs (any scheduler that can POST with the `CRON_SECRET` header).
5. ~~Production hosting decision.~~ **DECIDED (2026-07-10): Vercel (app) + Supabase Cloud (backend).** The Express server was restructured to run as a Vercel serverless function (`api/index.ts` + `server/app.ts` + `vercel.json`); the Vite SPA deploys as static. Remaining: create the Vercel project from the repo, set env vars in Vercel (not a local `.env`), and point `DATABASE_URL` at Supabase's **transaction pooler (port 6543)** — the direct 5432 connection will exhaust under serverless concurrency. Untested until a real deploy (see Blocker 2).
6. **Legal:** privacy policy, ToS, DPDP parental-consent language (the portal already captures consent; the document it references must exist), refund policy.

---

## 3. MVP Launch Tasks (before the first paying customer)

Effort in engineer-days (ed).

### Critical

| Task | Effort | Notes |
|---|---|---|
| Blockers 1 and 2 (infra up + e2e walkthrough + fixes) | 3 to 7 ed | Budget for surprises; Realtime and GoTrue paths are unexercised |
| Browser QA: Today, Parent portal (375px), Calendar booking, invoice lifecycle | 2 ed | The three built-not-verified epics |
| Real-device parent flow: OTP → invite redeem → Pay Now → webhook reconcile | 1 ed | Needs Blockers 3 and 4 |
| ~~Fix: Students.tsx legacy base64 document upload~~ **DONE (2026-07-10)** | — | Upload/download/delete now route through the server storage API (`uploadDocument`/`getDocumentUrl`/`deleteDocument`); no more base64-into-Postgres or direct client insert/delete. Typecheck clean |
| Backup/restore: nightly `pg_dump` + storage sync, one rehearsed restore | 1 ed | Self-hosted means no Firebase safety net; do this before real data exists |
| Staging vs prod environments (two Supabase stacks or two projects) | 1 ed | |

### High

| Task | Effort | Notes |
|---|---|---|
| **Fix: client-side jsPDF invoice/report generation** (Invoices.tsx, StudentProfile.tsx, AcademicProgress.tsx) | 1 ed | Duplicates the server PDF with a different (non-GST-snapshot) layout; also statically imports jspdf + autotable (~620KB of chunks). Invoices should call `downloadInvoicePdf`; progress reports either move server-side or dynamic-import |
| Seed script for demo/staging data | 1 ed | Unblocks all QA; no seed exists |
| Uptime monitoring + Sentry DSNs wired in prod, alert on 5xx | 0.5 ed | |
| Onboarding walkthrough polish after first real signup attempt | 1 ed | Bootstrap flow has never run |
| Manual send of payment reminders (copy-link UX on Invoices page) documented as the interim Epic 7 | 0.5 ed | |

### Medium

| Task | Effort | Notes |
|---|---|---|
| Bundle budget: dynamic-import jspdf, drop `recharts` (imported nowhere), verify exceljs stays lazy, add size check to CI | 1 ed | Main chunk is 678KB raw today; the old plan's 200KB-gzip gate was never enforced |
| Delete `/api/settings` alias once frontend confirmed on `/api/v1` | 0.2 ed | |
| Sweep stale Firestore-era comments (~20 files) and the `.env.example` AI-Studio header | 0.5 ed | Cheap, prevents newcomer confusion |
| Resume Epic 7 (comms router) when provider KYC clears | 5 ed | Was fully specced in the old plan; templates, fallback, quiet hours, bulk remind |
| Resume Epic 8 (Calendar/Meet) when OAuth verification clears | 3 ed | Token storage already migrated |

### Low

| Task | Effort |
|---|---|
| Drop vestigial `profiles.organization_id` column (currently trigger-guarded) | 0.5 ed |
| Remove legacy rupee mirror columns once all readers use paise (see Tech Debt) | 1 ed |
| i18n: move remaining hardcoded strings in legacy pages through `t()` as they are rebuilt | rolls into Stage 2 |

---

## 4. Phase 2: Operate and Harden (post first customer, pre scale)

- **Stage 2 workspaces** (the old plan's Epics 11 to 14, still the right product spec, see REDESIGN.md 6.2 to 6.7): Student Story timeline, People directory with lead funnel, Money workspace (aging buckets, batch drafting, insights from `org_stats_daily`), Inbox + homework loop, three-beat onboarding. Delete each legacy page in the same PR as its replacement. ~8 to 10 engineer-weeks.
- **Observability:** structured request IDs end to end, slow-query logging (`pg_stat_statements`), Realtime connection-count metrics, dashboard for webhook failures and reconcile catches.
- **Infra hardening:** Postgres tuning for the VPS, connection-pool sizing (PgBouncer if needed; `pg.Pool` + PostgREST both hit the same DB), automated offsite backups with tested restore, TLS renewal automation, container restart policies.
- **Performance:** replace refetch-on-any-change Realtime handlers with targeted row merges on the chattiest tables (messages, class_sessions); consider caching the per-request `organization_members` lookup (60s TTL) once request volume justifies it; k6 load test of the Monday-6pm attendance burst (old E17.1 target: p95 API < 400ms).
- **Scalability decision point:** single-box Supabase serves pilots comfortably; document the migration path (managed Postgres or Supabase Cloud) before passing ~50 orgs.
- **Security:** external pentest after Stage 2 surfaces land; axe accessibility pass in CI; quarterly RLS-suite review against new tables.

## 5. Phase 3: Growth and Intelligence

- **Schedule workspace rebuild** (old Epic 15): drag-based week calendar, recurring edit scopes, availability overlay.
- **SaaS subscription billing** (old E16.1): org plans on Razorpay subscriptions, feature gating, free-tier limits.
- **Super-admin console** (old E16.2): org health, audited impersonation, feature flags (`feature_flags` table already exists).
- **Org export/offboarding** (old E16.3): full JSON/XLSX export, deletion honoring 8-year financial retention.
- **Mobile polish** (old E18): bottom tab bar, swipe attendance, payment bottom sheet.
- **Growth loop** (old E19): payment-link referral footer, activation funnel analytics (PostHog or self-hosted equivalent).
- **AI morning brief** (old E20): Claude API narrative over the existing rules-based queue, per-org toggle, evidence links. The queue itself is already live; this is a narration layer only.
- **Reporting:** nightly `org_stats_daily` aggregation job (table exists, nothing populates it yet), revenue/collection/aging insights.

---

## 6. Technical Debt Backlog

| # | Item | Priority | Risk | Effort | Impact | Depends on |
|---|---|---|---|---|---|---|
| 1 | ~~Students.tsx base64 document upload~~ **DONE (2026-07-10)** — now on the server storage API | — | — | — | Resolved | — |
| 2 | Client-side jsPDF invoices diverge from server GST invoice | High | A parent and an accountant can hold two different PDFs for the same invoice | 1 ed | One canonical invoice artifact | none |
| 3 | Legacy pages awaiting Stage 2 rebuild (StudentProfile et al.) | High | 1,300-line files, direct client writes, not token-styled | Stage 2 | Velocity, consistency | Stage 2 schedule |
| 4 | Dual money columns: `wallets.balance_currency` numeric rupees + `Math.round(x*100)` conversions in billing, legacy `total_amount`/`subtotal` mirrors on invoices | High | Rounding drift between ledger paise and wallet rupees | 2 ed | Invariant #4 becomes true instead of aspirational | e2e verified first |
| 5 | Realtime refetch-on-any-change (63 call sites) | Medium | Thundering refetch on busy orgs | 3 ed | Perf at scale | live Realtime observed |
| 6 | `recharts` dead dependency; jspdf/html2canvas static chunks | Medium | 1MB+ of avoidable JS | 0.5 ed | Bundle size | none |
| 7 | Membership lookup per API request, single-membership assumption (`limit(1)`) | Medium | Multi-org users silently get one org | 1 ed | Correctness for multi-branch future | product decision |
| 8 | `profiles.organization_id` vestigial column | Low | Confusion landmine (trigger-guarded) | 0.5 ed | Schema clarity | none |
| 9 | Firestore-era comments, stale `.env.example` header, `/api/settings` alias | Low | Newcomer confusion | 0.5 ed | Readability | none |
| 10 | `metadata.json` and other AI-Studio scaffolding remnants | Low | none | 0.1 ed | Cleanliness | none |
| 11 | ~~Hosted vs self-hosted direction unresolved~~ **DONE (2026-07-10)** — hosted Cloud chosen; `.env.example`/`README` updated, self-hosted kept as Option B | — | — | — | Resolved | — |
| 12 | ~~Migration filenames incompatible with `supabase db push`~~ **DONE (2026-07-10)** — renamed to `<timestamp>_name.sql`, added `supabase/config.toml`; RLS suite still 40/40. Remaining: install CLI + `supabase link` (needs your login) | — | — | — | Resolved (repo side) | — |

---

## 7. Architecture Improvements

- **Module boundaries are healthy; keep them.** Pure logic in `src/lib/today.ts` and `server/utils/*` (unit-tested, IO-free) is the pattern to extend: every new workspace gets a pure core module + a thin page.
- **Shared types:** there is no shared type package between `server/` and `src/`; API request/response shapes are duplicated informally. Introduce a `shared/` directory with Zod schemas used by both (server validates, client infers types). ~2 ed, do before Stage 2 to stop drift.
- **API organization:** routes are cleanly split by domain. When Epic 7 lands, put the channel router in `server/jobs/` rather than routes, and formalize the cron surface (`/api/cron/*`) with a job registry.
- **Data access on the client:** pages talk to `supabase-js` directly with ad-hoc queries. Extract per-entity query hooks (`useSessions`, `useInvoices`) so Realtime subscription, bounding, and error handling live in one place each; adopt during Stage 2 rebuilds, not as a big-bang refactor.
- **Testing strategy:** keep the three-layer pyramid (unit for money math and today-derivations, PGlite RLS suite for authorization, supertest for route contracts). Add Playwright E2E for the five golden journeys once a seeded staging exists; E2E is the only layer that can catch the "never ran in a browser" class of bug.
- **CI/CD:** CI is solid (typecheck, unit, RLS, build, no external deps). Add: bundle-size check, `npm audit` gate, deploy-to-staging on merge once hosting exists, migration-ordering lint (applying 0001..N to a fresh PGlite already happens in the RLS suite, which is an excellent migration test; keep it mandatory).
- **Deployment:** write the runbook: compose up Supabase, run migrations, boot Express, smoke script (`/api/health`, login, one read per table group). One command, documented, rehearsed twice.

---

## 8. Production Readiness Checklist

**Infrastructure:** □ Supabase stack live with restart policies □ TLS + domain □ staging environment □ resource monitoring (disk, RAM, connections) □ documented rebuild-from-scratch procedure

**Security:** □ RLS suite green in CI (standing) □ service-role key only on server □ `SUPABASE_JWT_SECRET` rotated from default □ GoTrue email-confirmation + rate limits on □ secrets in a manager, not files □ dependency audit clean □ pentest scheduled (Phase 2)

**Payments:** □ Razorpay live KYC □ per-org webhook secrets set □ webhook URL registered (payment_link.paid, payment.captured) □ real ₹1 payment reconciled on staging □ hourly reconcile cron □ refund flow rehearsed □ CA-approved GST invoice sample

**Database:** □ migrations applied and versioned □ nightly `pg_dump` offsite □ restore rehearsed (RPO 24h / RTO 4h) □ `pg_stat_statements` on □ connection limits sized

**Monitoring/Observability:** □ Sentry receiving from both sides □ uptime probe on `/api/health` □ 5xx alerting □ webhook-failure alerting □ log retention defined

**Performance:** □ e2e walkthrough under 3G throttle on mid-range Android □ main bundle budget enforced in CI □ slow-query log reviewed once under seed load

**Testing:** □ 51 unit + 40 RLS green □ supertest route contracts for billing/scheduling/parents □ Playwright golden journeys on staging □ manual QA script for the wedge demo

**Compliance/Legal:** □ privacy policy + ToS live □ DPDP consent doc versioned (portal already stamps `consentVersion`) □ refund policy □ financial-data retention (8y) documented

**Deployment:** □ one-command deploy □ rollback procedure □ release smoke script □ incident one-pager (who restarts what)

**Product:** □ demo org with wipe □ onboarding tested with a stranger □ support channel (WhatsApp number) staffed

---

## 9. Testing Plan

- **Unit (vitest, standing, 51 tests):** money math, invoice status machine, invoice numbering, webhook signatures, PDF composer, Today derivations. Rule: any new money math or queue rule lands with unit tests in the same PR.
- **RLS/RBAC integration (PGlite, standing, 40 tests):** the constitution. Any PR touching `supabase/migrations/*.sql` or a privileged route runs `npm run test:rls`; for uncertain policy changes, deliberately re-break and confirm the expected test fails (HANDOFF §11.3 procedure).
- **Route contracts (supertest, partial):** expand to cover every privileged endpoint's auth matrix (401 unauthenticated, 403 wrong role, 200 happy path, 409/422 idempotency and validation) against a PGlite-backed test app. ~3 ed.
- **E2E (Playwright, new):** five golden journeys on seeded staging: (1) signup → org bootstrap → first class, (2) book → student sees session → attendance → invoice, (3) invoice → payment link → webhook → paid, (4) parent invite → OTP → consent → portal → pay, (5) template edit → materialization reshapes future sessions. Required before first paying customer.
- **Load (k6, Phase 2):** Monday-6pm attendance burst at 5x pilot volume; p95 API < 400ms, Today interactive < 2s on mid-range Android.
- **Security testing:** RLS suite (standing), `npm audit` in CI, external pentest in Phase 2 after Stage 2 surfaces land.
- **Manual QA:** wedge-demo script run before every release; 375px parent portal pass on a real device.
- **Coverage bar for production:** all standing suites green, route contracts for every money endpoint, E2E journeys 1 to 4 passing on staging, one rehearsed restore.

---

## 10. Obsolete documentation

- **This file's predecessor** (Firestore-era DEV_PLAN.md): superseded, recoverable from git history.
- **HANDOFF.md §1 to §10:** already correctly marked historical; keep as-is, §11 is current.
- **GO_TO_MARKET_BLUEPRINT.md:** GTM strategy, RBAC matrix, pricing, and wedge positioning remain valid; all architecture/security sections (Firestore rules, Cloud Functions, SQLite dual-store findings) are historical. Add a banner noting this rather than rewriting.
- **REDESIGN.md:** still the active product-experience spec for Stages 2 to 4. Keep.
- **`metadata.json`:** AI-Studio scaffolding, delete.
