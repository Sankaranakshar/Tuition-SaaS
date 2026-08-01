# ClassStackr Engineering Handoff

**What this is:** everything you need to pick up this codebase and be productive, in one read. Current state, how the system works, how to run it, and the rules that must not be broken.

**Companion docs:** [DEV_PLAN.md](DEV_PLAN.md) is what is left to build. [REDESIGN.md](REDESIGN.md) is the product-experience spec. [GO_TO_MARKET_BLUEPRINT.md](GO_TO_MARKET_BLUEPRINT.md) is strategy (its architecture and security sections are Firestore-era history). [docs/BUILD_LOG_ARCHIVE.md](docs/BUILD_LOG_ARCHIVE.md) is the old append-only build log, kept for narrative detail only. [docs/OPTIMIZATION_AUDIT.md](docs/OPTIMIZATION_AUDIT.md) is a 2026-07-26 performance/correctness audit; its fixes are applied (commit `b15f691`), see §8 for the two most consequential findings.

_Last verified 2026-08-01 against commit `b15f691`, working tree clean. Every number below was re-run, not inherited._

---

## 1. The product in a paragraph

Multi-tenant SaaS for Indian tuition centers: INR, GST invoices, UPI/Razorpay collection, DPDP consent. A tutor or center owner signs up, onboards in three beats (solo or center, first class from a template gallery, add students), then runs the daily loop: mark attendance, which accrues an invoice or debits a wallet, then collect payment. Six workspaces (Today, People, Student Story, Money, Inbox, Schedule) plus platform-level surfaces (Plan and Billing, super-admin console, audit log). Students and parents get self-views built from the same components, filtered by role.

## 2. Status

| Stage | Scope | Status |
|---|---|---|
| 0 | Security rewrite, server-authoritative money, design system, i18n | Complete |
| 1 | Payments, Today workspace, parent portal, live infra, wedge demo | Complete, money loop verified live |
| 2 | People, Student Story, Money, Inbox, Onboarding | Complete, all 14 legacy pages deleted |
| 3 | Schedule rebuild, subscription billing, super-admin, org export, audit log | Complete, all five browser-verified |
| 3 (rest) | Hardening: axe pass, route contracts, optimization audit, and real-scale k6 (p95 79-101ms vs 400ms target, live-prod verified 2026-08-01) done; external pentest open | **Active**, see DEV_PLAN §2 |
| 4 | Mobile polish, growth loop, AI morning brief | Not started |
| External | Razorpay live keys, Google OAuth, phone OTP, Sentry, staging, legal | Deferred by founder, see §7 |

**Gates, all re-run and green on 2026-08-01:**

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run lint` | clean |
| Unit | `npm test` | 167/167 (14 files) |
| RLS / authorization | `npm run test:rls` | 80/80 (4 files) |
| Route contracts | `npm run test:contract` | 179/179 (14 files) |
| Build | `npm run build` | passes, server bundle 127.7 KB |
| Bundle budget | `npm run check:bundle-size` | 196.8 KB gzip, budget 260 KB |
| API bundle | `npm run build:api && npm run check:api-bundle` | all 15 route mounts present |

Run all seven before every commit. None of them need Docker, Java, or a live database.

**CI now runs every gate above.** `.github/workflows/ci.yml` covers lint, `npm audit` (report-only, 17 pre-existing advisories need breaking upgrades so it doesn't fail the build), unit, RLS, route-contract, build, bundle-size, and the API-bundle rebuild+verify. The route-contract suite used to be local-only (old Tech Debt #10, now closed); it and the API-bundle check were added in the 2026-07-26 optimization pass alongside the fix for the stale-`api/index.js` bug described below.

## 3. Architecture

```
src/          React 19 + Vite + Tailwind 4 SPA
  pages/      thin pages, one per workspace
  hooks/      per-entity query hooks, own Realtime + bounding + errors
  lib/        pure logic, unit-tested, no IO
  components/ kit/ = shared primitives, see /app/kit for a live gallery
server/       stateless Express API, mounted at /api/v1
  routes/     15 route modules, split by domain
  db.ts       direct pg Pool + withTransaction, for money and scheduling
supabase/     28 timestamped migrations, RLS on every table
shared/       Zod contracts + plans.ts, imported by both sides
tests/        unit/ · integration/ (RLS) · contract/ (supertest) · load/ (k6)
```

**Request path.** The client talks to Supabase directly for reads (RLS is the authorization boundary) and to the Express API for every privileged write. `authenticateToken` verifies the Supabase JWT per request (JWKS, HS256 fallback), then `requireOrg` does a fresh `organization_members` lookup. There are no custom claims and no token revocation dance: a role change takes effect on the next API call.

**Why two data paths.** PostgREST cannot hold a lock across a read-then-write, so anything touching money or scheduling conflicts uses a direct `pg` transaction (`withTransaction`) with `FOR UPDATE` row locks and an idempotency key. Everything else goes through supabase-js.

**The three-layer pattern, mandatory for new work.** Pure logic in a tested `src/lib/*.ts` core, data access in a `src/hooks/use*.ts` hook built on `useRealtimeList`, and a thin page that renders. Every workspace follows it.

## 4. Environment and commands

**Live:** `https://tuition-saas-two.vercel.app` (Vercel project `tuition-saas`) against Supabase Cloud `cwugpiernnwrhcximjwh` (ap-south-1). Repo `Sankaranakshar/Tuition-SaaS`, branch `main`, push auto-deploys.

**There is no staging.** Local dev points at the production Supabase project. Be deliberate about test data and clean up after walkthroughs.

```bash
npm install
cp .env.example .env     # then fill in, see below
npm run dev              # Express + Vite on :3000
npm run seed             # idempotent demo org, tutor, courses, students, sessions
supabase db push         # apply migrations to the hosted project
./scripts/backup.sh      # pg_dump via the pooler, restore rehearsed once
```

**Env vars.** Client needs `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` (Vite bakes these at build time). Server needs `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `DATABASE_URL` (transaction pooler, port 6543, URL-encoded password), `JWT_SECRET`, `ENCRYPTION_KEY`, `CRON_SECRET`, `APP_URL`. `SUPABASE_JWT_SECRET` is a legacy fallback. `SENTRY_DSN` and `VITE_SENTRY_DSN` stay unset until go-to-market. Generate secrets with `openssl rand -hex 32`.

## 5. Security invariants, do not regress

1. **Roles are set only via `/api/v1/members`.** Never write `organization_members` from the client.
2. **Money mutates only via `/api/v1/billing`,** idempotency-keyed, each writing an `audit_events` row. `invoices`, `payments`, `wallets`, `wallet_ledger`, and `refunds` have no client write policy at all.
3. **Attendance is one real transaction** covering the attendance record, wallet debit, and invoice accrual.
4. **Money is integer paise** (`*_paise` columns). The `total_amount` and `subtotal` rupee columns are legacy display mirrors, not sources of truth.
5. **Server-only tables stay server-only:** `google_tokens`, `audit_events`, `payment_gateways`, `refunds`, `invoice_counters`, `parent_invites`, `student_invites`, `platform_admins` writes, `platform_admin_actions`. RLS is enabled on every table, and these simply have no policy, which means default-deny for everything except `service_role`.
6. **Never fabricate** meeting links, invoice numbers, or payment confirmations client-side.
7. **Gateway secrets are AES-GCM encrypted, server-only, write-only** from the client's perspective.
8. **Every webhook is HMAC-verified before its body is trusted,** and settled idempotently by gateway payment id. The raw-body mount in `server/app.ts` sits before JSON parsing and rate limiting: do not reorder it.
9. **`class_sessions` has three id spaces.** `student_ids` holds student RECORD ids. `student_user_ids` and `parent_user_ids` hold auth uids, which is what RLS matches on. Any code path creating a `class_sessions` row must populate all three via `resolveUserIds()`. Mixing these caused a real bug where students saw an empty schedule.
10. **Any PR touching `supabase/migrations/*.sql` or a privileged route runs `npm run test:rls` before merge.** For an uncertain policy change, deliberately re-break it and confirm the expected test fails, so you know the test is real.

## 6. Engineering rules for new work

- Delete the legacy page in the same PR as its replacement. No parallel implementations.
- Pure logic goes in `src/lib/*.ts` with unit tests. Pages stay thin.
- Data access goes through a per-entity hook on `useRealtimeList`, never ad-hoc queries in a page.
- All user-facing strings through `t()`. All money through `formatINR` / `formatPaise`.
- Every new table or policy lands with RLS tests in the same PR.
- **Any new Realtime-subscribed table needs a `supabase_realtime` publication migration.** This is not automatic. See §8.
- If a client module imports a runtime value from `shared/`, that value must live in a Zod-free file. Importing from a file that builds Zod schemas drags Zod into the browser bundle.

## 7. The founder's external-integrations deferral

**Decided 2026-07-10 and still in force:** all external integrations and third-party accounts are postponed until every build stage is complete and go-to-market begins. This covers Razorpay live KYC (both org-level and platform-level), Google OAuth verification, SMS/phone OTP provider, WhatsApp Business API, email domain verification, Sentry, staging spend, and legal documents.

**What this means for engineering:** do not stop to ask about these and do not attempt them. They are not blockers, they are the go-to-market checklist (DEV_PLAN §6). Build every feature that touches an external service to completion behind its degradation path (an error toast, "link pending", or a manual share link), and note the seam.

Every deferred integration already has its degradation path built and tested. Subscription checkout returns a friendly "email us" message until platform keys exist. The platform webhook returns 503 until its secret is set. Payment links surface a clear `gateway_not_connected` error. Sessions without a real Meet link show "link pending".

## 8. Traps this stack has already sprung

Each of these cost real debugging time. They are distilled here so they cost nobody else.

**Realtime is not automatic.** A `postgres_changes` subscription against a table that is not in the `supabase_realtime` publication is a silent no-op: no error, no events, nothing. This shipped twice. Once it silently disabled every subscription in the app. Every new subscribed table needs its own idempotent publication migration.

**A green local RLS suite does not mean the hosted DB is migrated.** `supabase db push` is a separate, easily-forgotten step. If a feature works locally and mysteriously fails live, check this first.

**Vercel's Supabase integration sets the wrong env var names and can point at the wrong project.** It injects `SUPABASE_*` and `NEXT_PUBLIC_SUPABASE_*`, never the `VITE_*` names Vite requires, and never `DATABASE_URL`. It has also populated credentials from an entirely different Supabase project, which made every JWT verification 401 against the wrong JWKS. After any reconnect, verify each auto-populated var actually carries the `cwugpiernnwrhcximjwh` ref.

**Vercel only registers functions it can see in a git scan.** A gitignored, build-time-generated `api/index.js` is invisible to that scan, so every `/api/*` request silently served the SPA shell instead. The file is committed for this reason, and the build regenerates it.

**`/api/health` returning 200 proves nothing about the database.** It is a static handler that never touches Postgres. A paused Supabase project still returns a healthy 200.

**`dotenv` being a dependency does not mean it is invoked.** It was listed but never imported, so every server-side `process.env` read was silently undefined in local dev while client-side Supabase calls worked fine (Vite loads `.env` independently). The `import "dotenv/config"` on `server.ts`'s first line is load-bearing: do not move it.

**Typecheck, unit, and RLS tests cannot catch interaction bugs.** The Schedule rebuild's four worst bugs (a drag that never changed days, an out-of-order refetch race blanking the grid, a stale effect dependency, a 500 on a missing column) were all invisible to every automated gate and only appeared when someone actually dragged something in a browser. Budget for a real walkthrough on any interactive feature.

**Absolute paths must include the `/app` prefix.** Routes live nested under `/app`, so a `Link to="/students/:id"` resolves outside the router match and renders a blank page. This has caused dead ends on the payment path twice.

**Two more from the 2026-07-26 optimization audit (docs/OPTIMIZATION_AUDIT.md), both fixed:**

- **CI validating a build artifact nobody deploys is worse than not validating one.** `npm run build` bundles `server.ts` to `dist/server.js`; Vercel's `buildCommand` bundles the different entry point `server/vercelHandler.ts` to `api/index.js`. For 15 days the committed `api/index.js` was stale and silently missing 7 of 14 route groups, and every other gate was green the whole time. CI now runs `npm run build:api` (the exact esbuild command Vercel runs) and `npm run check:api-bundle`, which fails if any `server/app.ts` route mount is missing from the built artifact.
- **A Realtime subscription can refetch through a stale closure.** `useRealtimeList`'s subscribing effect ran once and its callback permanently captured the mount-time `load` closure, so (for example) a `class_sessions` change event while viewing Schedule week 3 could silently overwrite the grid with week 1's data. Fixed via `src/hooks/realtimeMerge.ts`. This class of bug is invisible to typecheck/unit/RLS/contract tests, since none of them mount the hook — only a real interactive walkthrough (or, here, a careful code read) surfaces it.

## 9. What is verified, and what is not

**Verified live in a browser:** signup, onboarding (solo and center, CSV import, invite redeem), course and class creation, drag-reschedule with conflict rejection, attendance, invoice accrual and PDF download, manual payment, Money's Outstanding and insights, Inbox class channels and DM and archive, student-sees-own-session, Plan and Billing with the real student-cap trigger, the super-admin console including impersonation link generation, org export, and the audit log.

**Built and covered by tests, but never clicked in a browser.** Not known-broken, just unexercised: admin verify/revoke on another tutor (also gated on Tech Debt #1, the unreachable admin tier), Student Story's Record Payment composer and the parent-facing view, Money's wallet top-up and bulk reminder links and invoice void, Inbox's anchor cards and snooze, Onboarding's parent invite-redeem path, Schedule's cancel-session popover and month-view day-click, and Supabase Storage upload/download through the app (no file has ever been uploaded against the live project).

**Blocked on the founder's deferral, not on engineering:** parent portal at 375px, Google OAuth, phone OTP, and any real Razorpay flow.
