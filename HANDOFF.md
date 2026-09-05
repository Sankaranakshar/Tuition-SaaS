# ClassStackr Engineering Handoff

**What this is:** everything you need to pick up this codebase and be productive, in one read. Current state, how the system works, how to run it, and the rules that must not be broken.

**Companion docs:** [MASTER_PLAN.md](MASTER_PLAN.md) is the current release plan (R1-R4) and the one open founder decisions live in. [EXECUTION_PLAN.md](EXECUTION_PLAN.md) is the step-by-step, checkbox-trackable execution order for R1 — start there for day-to-day work. [DEV_PLAN.md](DEV_PLAN.md) is tech-debt detail and the shipped-when build log (its stage numbering is superseded by MASTER_PLAN.md). [REDESIGN.md](REDESIGN.md) is the product-experience spec. [GO_TO_MARKET_BLUEPRINT.md](GO_TO_MARKET_BLUEPRINT.md) is strategy (its architecture and security sections are Firestore-era history). [docs/BUILD_LOG_ARCHIVE.md](docs/BUILD_LOG_ARCHIVE.md) is the old append-only build log, kept for narrative detail only. [docs/OPTIMIZATION_AUDIT.md](docs/OPTIMIZATION_AUDIT.md) is a 2026-07-26 performance/correctness audit; its fixes are applied (commit `b15f691`), see §8 for the two most consequential findings.

_Last verified 2026-09-05 against commit `4bf162a` plus the R1 stack (Steps 6–9, unmerged) and an uncommitted pass closing MASTER_PLAN.md's R1 item B-11 (DPDP consent + per-student erasure), EXECUTION_PLAN.md Step 10 — new `consent_records` table (migration `20260905130000`, pushed to production), `students.erased_at/erased_by`, `POST /api/v1/students/:studentId/erase` (owner/admin, no new route mount), a per-org `settings.erasure.walletPolicy` (block/writeoff), a `CONSENT_VERSION` record written on every parent/student invite redeem, and People/Settings UI. Every number below was re-run, not inherited._

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
| 3 (rest) | Hardening: axe pass, route contracts, optimization audit, and real-scale k6 (p95 79-101ms vs 400ms target, live-prod verified 2026-08-01) done; external pentest open | Only the pentest remains, see DEV_PLAN §2 |
| 4 | Mobile polish (done); growth-loop payment-link footer (done, not live-verified — no Razorpay creds locally); reporting (done, see DEV_PLAN §3.3); AI morning brief deferred by founder (2026-08-02); activation-funnel analytics not started | **Active**, see DEV_PLAN §3 |
| External | Razorpay live keys, Google OAuth, phone OTP, Sentry, staging, legal, AI integrations | Deferred by founder, see §7 |

**Gates, all re-run and green on 2026-09-05:**

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run lint` | clean |
| Unit | `npm test` | 211/211 (20 files) |
| RLS / authorization | `npm run test:rls` | 89/89 (5 files) |
| Route contracts | `npm run test:contract` | 252/252 (19 files) |
| Build | `npm run build` | passes, server bundle 184.9 KB |
| Bundle budget | `npm run check:bundle-size` | 200.7 KB gzip, budget 260 KB |
| API bundle | `npm run build:api && npm run check:api-bundle` | all 16 route mounts present |

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
  routes/     16 route modules, split by domain
  db.ts       direct pg Pool + withTransaction, for money and scheduling
supabase/     33 timestamped migrations, RLS on every table
shared/       Zod contracts + plans.ts, imported by both sides
tests/        unit/ · integration/ (RLS) · contract/ (supertest) · load/ (k6)
```

**Request path.** The client talks to Supabase directly for reads (RLS is the authorization boundary) and to the Express API for every privileged write. `authenticateToken` verifies the Supabase JWT per request (JWKS, HS256 fallback), then `requireOrg` does a fresh `organization_members` lookup. There are no custom claims and no token revocation dance: a role change takes effect on the next API call.

**Why two data paths.** PostgREST cannot hold a lock across a read-then-write, so anything touching money or scheduling conflicts uses a direct `pg` transaction (`withTransaction`) with `FOR UPDATE` row locks and an idempotency key. Everything else goes through supabase-js.

**The three-layer pattern, mandatory for new work.** Pure logic in a tested `src/lib/*.ts` core, data access in a `src/hooks/use*.ts` hook built on `useRealtimeList`, and a thin page that renders. Every workspace follows it.

## 4. Environment and commands

**Live:** `https://tuition-saas-two.vercel.app` (Vercel project `tuition-saas`) against Supabase Cloud `cwugpiernnwrhcximjwh` (ap-south-1). Repo `Sankaranakshar/Tuition-SaaS`, branch `main`, push auto-deploys.

**There is no staging.** Local dev points at the production Supabase project. Be deliberate about test data and clean up after walkthroughs. **Confirmed founder decision 2026-09-05: hold on B-10 for R1** (EXECUTION_PLAN.md Step 11) — R1 ships its migrations straight to production. To be revisited before R2, whose identity migration (B-06) runs against live data.

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
5. **Server-only tables stay server-only:** `google_tokens`, `audit_events`, `payment_gateways`, `refunds`, `invoice_counters`, `parent_invites`, `student_invites`, `platform_admins` writes, `platform_admin_actions`, `consent_records` writes (it has a *select* policy — own rows or org staff — but no insert/update/delete: every row is written by the parent/student redeem routes on `service_role`). RLS is enabled on every table, and these simply have no write policy, which means default-deny for everything except `service_role`.
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

**Extended 2026-08-02 to AI integrations specifically:** the Claude-API-backed AI morning brief (DEV_PLAN §3.2) is deferred by the same logic — do not start it or scope it further until asked.

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

**The rate limiter was IP-only for every authenticated request, silently (MASTER_PLAN.md B-02, fixed 2026-08-06).** `apiLimiter`'s `keyGenerator` reads `req.user?.id`, but `authenticateToken` — the thing that populates it — is mounted per-route, inside each route file, which runs *after* `app.use("/api/", apiLimiter)` in `server/app.ts`. So `req.user` was always undefined at limiter time and every request fell back to IP, meaning a coaching center behind one NAT shared a single 120 req/min bucket regardless of how many staff were logged in. Fixed with `identifyUser` (`server/middleware/auth.ts`), a soft, non-enforcing JWT decode that runs ahead of the limiter to populate `req.user.id` for valid tokens without doing the membership lookup or rejecting bad/missing ones — real auth enforcement still happens in each route's `authenticateToken` downstream. Covered by `tests/contract/rateLimiter.test.ts`, which asserts two different signed tokens from the same test process (same IP) get independent buckets.

**`user.role` and `user.organizationRole` are different fields, and one bug already came from confusing them (B-09, fixed 2026-09-05).** `AuthContext.tsx`'s `User` type carries both: `role` (aka `role_type` — a person-type: tutor/parent/student/admin, set once at signup and never about a specific org) and `organizationRole` (the real authorization tier for the current org: owner/admin/tutor/frontdesk/accountant/parent/student, from `organization_members.role`). A solo tutor who owns their own org has `role: "tutor"` and `organizationRole: "owner"` at the same time — these are not synonyms. `src/hooks/usePeople.ts`'s `useStudentsList()` checks `user.role === "tutor"` to decide whether to scope the list to that person's own assigned students, when it should check `organizationRole`; the bulk-import route independently checked `req.user.role === "tutor"` (there, correctly the *org* role, since server-side `req.user.role` is populated from `organization_members`, not from the client's person-type field — the same identifier name means something different on each side of the wire) to decide whether to stamp `tutor_id`. The result: an owner-run import created real, correctly-saved students with `tutor_id: null`, which then silently vanished from that owner's own People list — confirmed by direct DB query (rows present, correct data) against the rendered page (only the pre-existing rows showed). Fixed by making the import always stamp `tutor_id` to the actor, matching `People.tsx`'s own manual add-student path, which already does this unconditionally.

**Follow-up audit, 2026-09-05: the same conflation was in three more hooks, all now fixed.** `useStudentsList()`'s own client-side filter (not just the server-side symptom above), `useMessageableContacts()` (`src/hooks/useInbox.ts`), `useMoneyInvoices()` (`src/hooks/useMoney.ts`), and `useScheduleSessions()` (`src/hooks/useSchedule.ts`) all checked `user.role === "tutor"` to decide whether to narrow a query to `tutor_id = own id`; all four now check `user.organizationRole` instead. `useMoney.ts`'s version is the oldest instance of this exact bug in the codebase — `docs/BUILD_LOG_ARCHIVE.md` §20.7 found and partially fixed it before `organizationRole` existed as a field, landing the `tutor_id.is.null` OR-fallback as the best available fix at the time (logged as **DEV_PLAN Tech Debt #25**) rather than the real one; that fallback is kept (a genuine tutor-role viewer should still see staff-created invoices with no tutor assigned) but the field it's gated behind is now correct. Verified against real production data for the `useScheduleSessions()` case (the demo account's own `role:"tutor"`/`organizationRole:"owner"` split): a throwaway `tutor_id: null` session was invisible under the old role-based query and visible under the new organizationRole-based one, then deleted. **No automated test layer in this repo can exercise this bug class** — these are client-side Supabase queries (bypassing the Express API entirely, so no contract-test coverage) whose logic lives in hooks (deliberately never unit-tested, per the three-layer pattern), and the actual symptom only shows up in a multi-tutor org, which nothing in RLS or route-contract tests would catch either. This is the same gap MASTER_PLAN.md §7 already names — no Playwright — just a second bug class it applies to.

**Two more occurrences noted, not fixed:** `src/pages/Settings.tsx` gates 11 of its 12 settings tabs on `user?.role === "admin" || user?.role === "tutor"` (person-type) — sitting right next to its own Team tab, which correctly gates on `user?.organizationRole === "owner" || "admin"`. Since `role_type` can only ever be `tutor`/`parent`/`student` in practice (the `admin` role_type is unreachable through any real signup path, per Tech Debt #25 — `role === "admin"` in these conditions is dead), this currently works by coincidence: virtually every staff account today has `role_type: "tutor"`, so the check happens to admit the same people `organizationRole`-based staff gating would. It will stop working the moment R2 (person-centric identity, one login/many memberships) lands, or for anyone whose person-type is `parent`/`student` but who also holds real staff membership in another org. `src/pages/Schedule.tsx` (4 occurrences) uses `role === "tutor"` to decide whether to apply the *viewer's own* availability constraints to the calendar — plausibly correct as a person-type check (does this person personally teach at all) rather than the org-authorization bug pattern, but genuinely ambiguous without a product decision; not touched.

**A running `tsx server.ts` dev process does not pick up server-side edits.** Unlike Vite's client-side HMR, `npm run dev`/`dev:preview` has no `--watch` flag, so editing anything under `server/` (a route, a util) changes nothing in an already-running dev server — it keeps serving the old code with no error, no warning. Found while verifying B-09: a server-side fix looked like it hadn't worked at all until the dev server was manually restarted. Restart the preview server after any server-side edit, before re-testing.

**Two more from the 2026-07-26 optimization audit (docs/OPTIMIZATION_AUDIT.md), both fixed:**

- **CI validating a build artifact nobody deploys is worse than not validating one.** `npm run build` bundles `server.ts` to `dist/server.js`; Vercel's `buildCommand` bundles the different entry point `server/vercelHandler.ts` to `api/index.js`. For 15 days the committed `api/index.js` was stale and silently missing 7 of 14 route groups, and every other gate was green the whole time. CI now runs `npm run build:api` (the exact esbuild command Vercel runs) and `npm run check:api-bundle`, which fails if any `server/app.ts` route mount is missing from the built artifact.
- **A Realtime subscription can refetch through a stale closure.** `useRealtimeList`'s subscribing effect ran once and its callback permanently captured the mount-time `load` closure, so (for example) a `class_sessions` change event while viewing Schedule week 3 could silently overwrite the grid with week 1's data. Fixed via `src/hooks/realtimeMerge.ts`. This class of bug is invisible to typecheck/unit/RLS/contract tests, since none of them mount the hook — only a real interactive walkthrough (or, here, a careful code read) surfaces it.

## 9. What is verified, and what is not

**Verified live in a browser:** signup, onboarding (solo and center, CSV import, invite redeem), course and class creation, drag-reschedule with conflict rejection, attendance, invoice accrual and PDF download, manual payment, Money's Outstanding and insights, Inbox class channels and DM and archive, student-sees-own-session, Plan and Billing with the real student-cap trigger, the super-admin console including impersonation link generation, org export, and the audit log. **Also 2026-08-02:** generating a parent/student invite link from a student's row in People.tsx, and generating a staff invite link (with a role picker) from Settings → Team — both previously nonexistent UI (see DEV_PLAN's Tech Debt #1 closure note) — were clicked live against production and produced real tokens/rows. **Also 2026-08-02, Tech Debt #7's token-styling pass (including its two follow-on components closed the same day):** Courses, Documents (including the upload modal), Profile (view and edit mode), Preferences, all five originally-changed Settings tabs (General, Organization, Billing & Invoices, Availability, Tutor Profile), and Team/Plan & Billing/Data & Offboarding were all clicked live against the demo tutor account and render on the shared `var(--cs-*)` palette with no visual regressions.

**Also 2026-08-06:** B-01's `POST /api/v1/billing/attendance/reverse` was verified end to end against production — a throwaway PER_SESSION session was marked present via the real Today-page roster popover (confirmed billed: a ₹500 unpaid invoice appeared in Money → Outstanding), reversed via the app's own authenticated `api()` client called from the browser console (no dedicated UI exists yet — that's Step 3), and Money → Outstanding and the Audit Log (`attendance.mark` → `attendance.reverse`) both confirmed the reversal in the running app before the throwaway data was deleted.

**Also 2026-08-06:** the cancellation-policy disclosure (EXECUTION_PLAN.md Step 3) was verified live against the demo tutor account in the staff `SessionPopover` (`Schedule.tsx`), the only surface reachable without a throwaway account that carries the same disclosure `ParentPortal.tsx` renders: a same-day throwaway session showed "Free cancellation until 5 Aug 2026, 04:00 pm. After that, a 50% fee applies." (cutoff already elapsed) before being cancelled to clean up, and an existing Aug 12 recurring session showed the same string with a still-upcoming cutoff. `ParentPortal.tsx`'s own render is unexercised in a browser — see below.

**Also 2026-09-05:** B-05's self-serve parent top-up (EXECUTION_PLAN.md Step 7, `POST /api/v1/billing/wallets/topup-link`) is code-reviewed and contract-tested only, not browser-verified — it's blocked on the same two things every parent-facing surface in this codebase is blocked on: no live Razorpay creds locally (so the outbound link-creation call can't run for real) and no demo parent account exists (`scripts/seed.ts` seeds no `parent_links` row). The *inbound* half — the webhook crediting a wallet once a payment is captured — needs no live gateway account at all and IS fully contract-tested against a real signed HMAC payload, same technique `webhooks.test.ts` already used for the invoice path.

**Also 2026-09-05:** B-09's bulk import (EXECUTION_PLAN.md Step 6, `POST /api/v1/students/import{,/inspect}`) was verified end to end against production — a real 5-row CSV with non-exact header names (`Mobile`, `Parent`, `Parent Mobile`) auto-mapped correctly, dry-run showed the right 3-ready/1-duplicate/1-error split, and commit produced exactly that outcome. A real bug surfaced during this walkthrough and is now fixed: see §8's new "role vs organizationRole" entry below.

**Also 2026-09-05:** B-04's credit expiry (EXECUTION_PLAN.md Step 9, `POST /api/cron/expire-credits`) is throwaway-contract-tested against PGlite (a real Postgres engine, every migration applied) — FIFO remainder expiry, the `credit_expiry` ledger row + idempotency key, wallet decrement, the B-03 `balance == ledger sum` invariant, an audit row, an idempotent re-run, the 7-day warning firing once to parent + student, and cross-org isolation — plus the pure FIFO walk unit-tested in `tests/unit/creditExpiry.test.ts` (14 cases). The route itself was invoked live against production (`npm run dev:preview` + `curl`): 404 without / with a wrong `x-cron-secret`, `200 {"ok":true,"orgsProcessed":0,"walletsChecked":0}` with the configured one. **Not** browser- or live-data-verified: production has 0 wallets and 0 opted-in orgs, no browser surface mints wallet credit (`/wallets/topup` is staff-only, Razorpay deferred), and a direct production DB seed is blocked in this session — same standing gap as `/reconcile-wallets`. The Settings "7. Credit Expiry" section is code-reviewed + build-verified only (needs the demo owner login).

**Also 2026-09-05:** B-11's per-student erasure (EXECUTION_PLAN.md Step 10, `POST /api/v1/students/:studentId/erase`) was walked end to end against production on the demo owner account — a throwaway student created through the app's own Add-Student modal, erased via the new owner/admin-only "Erase student data" row action and type-to-confirm modal, then confirmed gone from the People list with a real `student.erased` audit-log entry. The `consent_records` migration was pushed to production (`supabase db push`). **Not** directly asserted against the live DB — this session's tooling blocks direct production DB reads/writes (same standing gap as `/reconcile-wallets` and `/expire-credits`) — so the table-by-table anonymize/hard-delete behaviour, the B-03 `balance == ledger sum` invariant after a wallet write-off, and the consent-record inserts on redeem are covered instead by `tests/contract/studentErasure.test.ts` (+10) and the redeem-test assertions in `parents.test.ts`/`students.test.ts` against PGlite (a real Postgres engine, every migration applied). The "8. Data Erasure (DPDP)" Settings section is browser-rendered but its save path is code-reviewed only (needs the demo owner login, same as Steps 6/9). The erased anonymized stub row is left in the demo org — that is the correct end state of an erasure, not test residue.

**Also 2026-08-02:** `POST /api/cron/reporting-daily` (DEV_PLAN §3.3) was verified against the PGlite contract-test harness — correct aggregation values, idempotent rerun, 404 without the cron secret — via a throwaway test file written and then deleted (this endpoint isn't part of the permanent contract suite, same as `/materialize-sessions`). Never exercised in a real browser, since it has no UI; not run against production either, since Cloud Scheduler isn't wired up yet (see below).

**Built and covered by tests, but never clicked in a browser.** Not known-broken, just unexercised: Student Story's Record Payment composer and the parent-facing view, Money's wallet top-up and bulk reminder links and invoice void, Inbox's anchor cards and snooze, the staff-invite redeem screen (new 2026-08-02; parent/student redeem screens were separately verified live pre-existing), and Supabase Storage upload/download through the app (no file has ever been uploaded against the live project). Also unexercised as of 2026-08-02: StudentDashboard's newly token-styled markup and RoleSelection — both role-gated (student session, or a multi-role account) and unreachable from the single-role demo tutor account without creating a throwaway account against production. Also unexercised as of 2026-08-06: `ParentPortal.tsx`'s render of the new cancellation-policy disclosure (Step 3) — same role-gating problem, no demo parent account exists — code-reviewed only; the staff `SessionPopover`'s copy of the same disclosure, and (as of the same walkthrough) Schedule's cancel-session popover and month-view day-click, **are** now exercised. (Admin verify/revoke on another tutor **is** now exercised — Tech Debt #1's client-side gating bug was fixed 2026-08-01 and browser-verified against the real org owner; see DEV_PLAN §4 item 1.)

**Blocked on the founder's deferral, not on engineering:** parent portal at 375px, Google OAuth, phone OTP, and any real Razorpay flow.
