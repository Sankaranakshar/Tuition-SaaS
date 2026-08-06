# ClassStackr Development Plan

**What this is:** what is left to build, in priority order. For current state, architecture, and the runbook, read [HANDOFF.md](HANDOFF.md) first.

**Superseded for planning purposes.** [MASTER_PLAN.md](MASTER_PLAN.md) found three structural gaps (money-loop reversal, org-locked identity, no marketplace) this plan's Stage 0-4 numbering never tracked, and replaced it with releases R1-R4. This document remains authoritative for tech-debt detail and the shipped-when build log below; do not use its stage numbering to judge what's left. [EXECUTION_PLAN.md](EXECUTION_PLAN.md) is the actual step-by-step, checkbox-trackable execution order for R1 going forward.

_Rewritten 2026-07-25, updated 2026-08-02 against commit `fc18383` plus an uncommitted Tech Debt #7 token-styling pass, and again 2026-08-06 (gate counts only, see MASTER_PLAN.md for what changed that day: B-02/B-20 shipped, D-08/D-01 decided). Every status below was verified by re-running all gates and checking the claims in code, not inherited from the previous plan._

---

## 1. Where the build stands

Stages 0 through 3 are complete: security foundation, server-authoritative money, payments, six rebuilt workspaces (Today, People, Student Story, Money, Inbox, Schedule), three-beat onboarding, subscription billing, super-admin console, org export and offboarding, and the audit log viewer. All 14 legacy pages slated for deletion are gone. All six gates are green (HANDOFF §2).

A full optimization audit (docs/OPTIMIZATION_AUDIT.md) ran 2026-07-25/26 and its fixes are applied as of commit `b15f691`: a Critical finding (the deployed Vercel API bundle was stale, silently missing 7 of 14 route groups — CI now rebuilds and verifies it), a High finding (a stale-closure bug in `useRealtimeList` that could render the wrong week's data into Schedule after a Realtime event), four dead dependencies removed, and route-contract tests plus `npm audit` wired into CI. See HANDOFF §8 for the two most consequential findings.

What remains is: one hardening item that needs something from outside engineering, then Stage 4, then the go-to-market checklist.

## 2. Active work: the last hardening item

### 2.1 k6 load test at real scale — done, 2026-08-01

Ran `attendance_burst` against the live production API (`tuition-saas-two.vercel.app`) with founder sign-off, 15 VUs for ~90s, against the seeded demo org (`Demo Tuition Center`). Result: **p95 79–101ms across three runs, comfortably under the 400ms/5x-pilot-volume target.** One real invoice was created (₹500, `source: {kind: "attendance", sessionId: ...}`) and the attendance row shows `billed: true`, with no duplicate invoice despite 15 concurrent VUs hammering the same session/student for the full run — the `FOR UPDATE` wallet lock and the `billed`-flag idempotency guard both held under real concurrent write pressure.

Two caveats surfaced while verifying the run was real and not just check-shaped, worth keeping in mind if this test is rerun:
- **The script's single shared auth token self-limits it.** `setup()` logs in once and reuses that token across all VUs, so the per-user rate limiter (120 req/min, `server/app.ts`) caps sustained throughput after ~10-15s of a 15-VU run. This is the limiter working as designed, not a capacity problem, but it means this scenario tests "one token under concurrent connections," not "N distinct tutors marking attendance at once." A truly faithful multi-tutor burst would need the script extended to authenticate as several demo accounts. **Correction, 2026-08-06:** at the time this caveat was written, the limiter was not actually per-user in effect — it silently fell back to IP for every request (MASTER_PLAN.md B-02, fixed 2026-08-06). This run still self-limited (single shared token means the effective key, whether IP or user, was identical across all 15 VUs either way), so the load-test conclusion above is unaffected; only the mechanism description was wrong.
- **Session eligibility is narrow.** The billing endpoint only accepts sessions with `start_time` in the past 7 days, and only bills if the session's template is priced `PER_SESSION`. The seeded demo org needed a fresh session created (via the real `POST /api/v1/scheduling/sessions` endpoint, not a DB script) tied to the existing `PER_SESSION` "Grade 10 Mathematics" template before the money-write path could be exercised at all.

The demo org now carries one extra unpaid ₹500 test invoice from this run — harmless, and expected for a disposable seeded org.

### 2.2 External pentest

Needs a real third-party security engagement. This is not an engineering task, and running an automated scanner does not substitute for it. If asked to "do the pentest," say so rather than self-certifying.

The standing security posture in the meantime: the RLS suite (80 tests) is the constitution, route contracts (179 tests) cover the auth matrix, and the Supabase DB linter is clean. `npm audit` and the route-contract suite are now both wired into CI (fixed 2026-07-26, see §4's closed items). One gap remains: **leaked-password protection is not enabled** in the Supabase Auth dashboard — part of the go-to-market auth checklist (§6), not a blocker today.

## 3. Stage 4: the next real engineering work

If neither item above is actionable, this is what to pick up. Spec is in REDESIGN.md §7 onward.

### 3.1 Mobile polish — done, 2026-08-01

Bottom tab bar (Today/Schedule/Inbox/More, role-branched), swipe attendance on Today (right marks all present, left opens the roster in a bottom sheet), and a mobile payment bottom sheet on Money all shipped with zero new dependencies (hand-rolled pointer-event swipe + a `BottomSheet` kit primitive over the existing `Modal`, to stay inside the 260KB gzip bundle budget — landed at 197.6KB). The parent portal at 375px was verified clean; `StudentDashboard.tsx`'s upcoming-classes row had a real overflow bug (the "In-Person" pill and time range both wrapped awkwardly) which was fixed. Verification used a temporary, fully-reverted role grant on the demo account (no staging environment exists) — see git history on `src/components/Layout.tsx`, `src/pages/Today.tsx`, `src/pages/Money.tsx` for the change.

### 3.2 Growth loop — payment-link footer done, activation analytics not scoped (2026-08-01)

The payment-link referral footer shipped: every WhatsApp/clipboard payment message (`Money.tsx`'s `remind()`, invoice-detail `share()`, `bulkRemind()`; `ParentPortal.tsx`'s `handleShare()`) now appends a branded footer line via the `money.paymentLinkFooter` i18n key. Not fully live-verified — this demo org has no Razorpay credentials connected (`gateway_not_connected`, a deliberate 422, one of the externals deferred by founder decision), so the `wa.me` send itself couldn't be exercised end-to-end; verified by code inspection and the same `{{var}}` interpolation pattern already proven elsewhere in `en.json`. Also fixed in passing: Home.tsx's four "Get Started"-style CTAs linked to `/contact`, a route that doesn't exist (404) — retargeted to `/login`, matching Pricing.tsx's working pattern.

**Found but not fixed, worth a decision:** `src/pages/public/Home.tsx` (the `/` marketing page) is written as a tutor-marketplace ("Search", "Find 1-on-1 Tutors", "1,200+ Tutors", "Browse Group Batches") — mismatched with the actual product (B2B fee-collection SaaS; `Pricing.tsx` has the correct framing, "Transparent Pricing for Tutors"). Looks like unfinished template content never adapted to ClassStackr. A content rewrite, not a technical fix.

**Activation funnel analytics** was not scoped or started — there's no analytics infrastructure at all (no PostHog/GA/Segment, no distinct signup route, no attribution capture for anonymous visitors). Needs a product decision (build vs. buy, what "activation" means here) before any engineering.

| Item | Scope |
|---|---|
| **AI morning brief** | Deferred by founder decision (2026-08-02, along with the rest of the AI-integration surface) — not scoped further for now. |
| **Reporting** | Done, 2026-08-02 — see below. |

### 3.3 Reporting — the nightly org_stats_daily job, done 2026-08-02

`POST /api/cron/reporting-daily` (`server/routes/cron.ts`, same `CRON_SECRET`-gated pattern as `/materialize-sessions`) computes one row per active org into `org_stats_daily` (`organization_id, date, stats jsonb`) for a given UTC date, defaulting to yesterday so the day being aggregated is always closed. `stats` carries `revenueCollectedPaise`, `paymentCount`, `invoicesCreated`, `outstandingPaise` (running total, not day-scoped), `activeStudentCount`, `attendanceMarked`, `attendancePresent` — one set-based SQL query (CTEs over `payments`/`invoices`/`attendance_records`/`students`, left-joined against `organizations where status = 'active'`), upserted on `(organization_id, date)` so a rerun is idempotent; pass `{"date": "YYYY-MM-DD"}` in the body to backfill a specific day.

**Deliberately not done: wiring Money's insights tab to read from this table.** Money's `InsightsSegment` (`src/pages/Money.tsx`) still computes its trend/collection-rate live from `payments`/`invoices` client-side (`src/lib/money.ts`), same as before. There's no requested consumer for the daily snapshot yet — the AI morning brief that would have used it is deferred, and no admin history view exists. Swapping Money's live query for a once-a-day aggregate would be a real behavior regression (stale intraday numbers) for no asked-for benefit. Revisit when a real consumer needs it.

**Verified:** a throwaway contract test (written against the PGlite harness the existing contract suite uses, then deleted — this table isn't part of the permanent contract suite, matching the existing convention that route contracts skip `cron.ts`) confirmed the aggregation values are correct against seeded payments/invoices/attendance rows, reran idempotently for the same date, and 404s without the cron secret. Never exercised in a browser — there's no UI, same as `/materialize-sessions`. **Cloud Scheduler still needs to be configured to call this** (daily cadence, `x-cron-secret` header) — same outstanding ops step already noted for `/materialize-sessions`, not done here.

## 4. Technical debt backlog

Renumbered 2026-07-25. Only open items are listed; resolved ones were removed rather than kept as struck-through rows.

| # | Item | Priority | Why it matters | Effort |
|---|---|---|---|---|
| 3 | *(tracked as D-04 in MASTER_PLAN.md §5)* **Dual money columns — conversion logic centralized 2026-08-01, schema question still open.** The duplicated `Math.round(x*100)`/`x/100` call sites (the actual "two sources of truth" drift risk — the `numeric(10,2)` column itself is exact-decimal, JS float arithmetic at the boundary wasn't the real hazard, unreviewed duplication was) are now one pair of functions, `shared/money.ts`'s `rupeesToPaise`/`paiseToRupees`, applied everywhere `wallets.balance_currency` or the legacy `invoices.total_amount`/`subtotal` mirrors get converted to/from paise (`server/routes/billing.ts`, `server/utils/invoicePdf.ts`, `src/hooks/useMoney.ts`, `src/lib/today.ts`, `src/pages/Money.tsx`, `src/pages/ParentPortal.tsx`). **What's still open — needs a founder/product decision, not more engineering**: whether to actually drop the legacy rupee-mirror columns (`invoices.total_amount`/`subtotal`) and convert `wallets.balance_currency` to a paise-native integer column, versus continuing to maintain both. That's a real schema migration against live production data with no staging environment to rehearse it, and it's unconfirmed whether any historical invoice predates the paise columns (nobody has queried the live DB for this) or whether anything external reads the rupee mirrors. Deliberately not attempted without that decision — this class of change is exactly the kind of hard-to-reverse, shared-infra action that needs a human call first. | High | Duplicated conversion logic (the concrete drift risk) is resolved. The schema-level "two sources of truth" question remains until someone decides. | Decision needed, then ~1 ed for a migration + read-path cleanup |

**Three previously-tracked items were closed:**
- *"`class_sessions.updated_at` exists live but no migration adds it."* Verified false. The column is in `20260709020100_schema.sql`. The RLS and contract suites boot a fresh database from these exact migrations and pass, which independently proves no drift.
- *"`exceljs` is a dead dependency."* No longer true. `server/routes/orgExport.ts` is a real consumer.
- *"CI does not run the route-contract suite or `npm audit`."* Fixed 2026-07-26 (commit `b15f691`): both now run on every CI push, alongside a new step that rebuilds and verifies the Vercel API bundle (see HANDOFF §8).

**Six more were closed 2026-08-01, in a tech-debt sweep (all gates re-run green after each: tsc, 177 unit incl. 10 new, 80 RLS, 179 contract, build, bundle, API-bundle):**
- *(was #2)* **`profiles.name` never saved for self-registered accounts.** Fixed: `AuthContext.loadUser()` now reads the Full Name back from GoTrue `user_metadata` (set at signup via `signUp`'s `options.data`) instead of always inserting `name: ""`.
- *(was #4)* **Realtime refetches everything on any change, for the remaining legacy sites.** `CommandPalette`, `useStudentStory`, `useMoney`'s self-view, and the legacy pages (`Courses`, `Documents`, `ParentPortal`, `People`, `Settings`, `StudentDashboard`, `Today`) now debounce their Realtime handlers via a new `src/lib/debounce.ts` (collapses a burst into one trailing reload, same pattern `useRealtimeList` already used inline). Also fixed a real correctness bug found along the way: `StudentDashboard.tsx`'s `assessments`/`invoices`/`wallets` subscriptions had no filter at all despite each table having a plain `student_id` column — every student's dashboard was reloading on every *other* student's row changes. Now filtered to `student_id=eq.<self>`; only `class_sessions` stays unfiltered (array-contains membership genuinely can't be expressed in `postgres_changes`' single-column filter grammar).
- *(was #5)* **Membership lookup assumes one org per user.** `organization_members`' primary key is genuinely `(organization_id, user_id)` — a user can hold more than one row — but the `limit 1` picks in `server/middleware/auth.ts`'s `loadMembership`, `AuthContext.tsx`, and `server/routes/settings.ts`'s Google OAuth callback had no `order by`, so an unordered `limit 1` could return a *different* org per request/site for the same multi-org user. All three now `order by created_at asc`, so every read path deterministically agrees on the earliest-joined org as "home" until an org-switcher UI exists (still not built — a multi-branch tutor still can't switch between orgs, just no longer randomly).
- *(was #6)* **Dead code removed.** `ClassManager.bookOneOnOneSession()` and its unused `Wallet`/`TutorAvailability`/`Enrollment` interfaces are gone (the live `enrollStudent`/`createSession` methods are untouched). `BillingInvoiceSettings.tsx`'s Excel-export-fields picker (wrote a setting nothing ever read) is gone along with its now-empty "Document & Export Settings" section.
- *(was #8)* **Six route files migrated off inline Zod.** `students`, `parents`, `members`, `gateway`, `documents` now import their request schemas from new `shared/schemas/{students,parents,members,gateway,documents}.ts` files, matching the existing `billing`/`scheduling` convention. `settings.ts` needed no migration — its two endpoints take `code`/`state` query params (JWT-verified) and never had a request body to validate.

**Tech Debt #1 (invite/team-management UI) closed 2026-08-01, later the same day.** The founder picked "build it next" when asked to choose between the open items above. Shipped: a new `staff_invites` table (migration `20260802070000_staff_invites.sql`, mirrors `parent_invites`/`student_invites` exactly — RLS-enabled, zero client read/write path); `POST/GET/POST /api/v1/members/invites[/:token/preview|/redeem]` (owner/admin can invite tutor/frontdesk/accountant, only the owner can invite admin); a new Settings → Team tab (`src/components/TeamSettings.tsx`) listing current members (direct RLS-gated Supabase read) plus a role-picker invite generator; and the `?staffInvite=TOKEN` redeem flow in `Onboarding.tsx`/`App.tsx`, mirroring the parent/student pattern. **A bigger, previously-undiscovered gap surfaced and was fixed in the same pass**: `createParentInvite`/`createStudentInvite` (`src/lib/api.ts`) and the full redeem flow already existed and were fully tested, but no page anywhere ever called the create side — staff had no way to generate a parent or student invite link, ever, since these features shipped. Fixed by adding an "Invite" action per student row in `People.tsx` (`InviteModal`/`InviteLinkGenerator`) that generates both link types. Verified live against production: both the parent/student invite generator (People.tsx) and the new staff invite generator (Settings → Team) were exercised in a real browser and produced real tokens/rows. The redeem side is covered by 16 new contract tests (create/preview/redeem, mirroring `parents.test.ts`'s structure) plus 1 new RLS test, all passing against a real Postgres engine — not separately walked through in a browser, since doing so would have required creating a throwaway account against the production database. Two harmless unredeemed test invites (one parent, one staff) were left in the demo org from live verification; they expire in 7 days on their own.
- *(was #9)* **`Today.tsx`'s two `/app/calendar` links retargeted to `/app/schedule` directly** (confirmed `/app/calendar` is only a `<Navigate>` redirect shim in `App.tsx`).

**Tech Debt #7 closed 2026-08-02** (founder picked this over the Stage 4 remainder when asked which no-decision item to pick up next): all eight legacy pages are now token-styled against the same `var(--cs-*)` palette (`src/index.css`) as the six rebuilt workspaces — Settings.tsx plus its four sub-components (`BillingInvoiceSettings`, `OrganizationSettings`, `TutorAvailabilitySettings`, `TutorProfileSettings`), Profile, Preferences, StudentDashboard, Documents, Courses, and RoleSelection. Two findings along the way: `Courses.tsx` and `ParentPortal.tsx` were already fully tokenized (no `gray-*`/`indigo-*` left) — the tech-debt list was stale on those two, likely from being touched incidentally during Tech Debt #1 and the growth-loop pass. Flagged at closure, not fixed in that pass: `TeamSettings.tsx`, `SubscriptionSettings.tsx`, and `OrgExportSettings.tsx` — never on the Tech Debt #7 list, built alongside the six rebuilt workspaces — still used raw `gray-*`/`indigo-*` classes themselves. All gates re-verified green: tsc, 177 unit, build, bundle 199.2KB/260KB. Browser-verified live against the demo tutor account: Courses, Documents (including the upload modal), Profile (view and edit mode), Preferences, and all five changed Settings tabs (General, Organization, Billing & Invoices, Availability, Tutor Profile). StudentDashboard and ParentPortal are role-gated to student/parent sessions and RoleSelection only renders for multi-role accounts — none reachable from the single-role demo tutor account without creating a throwaway account against production (no staging environment), so those three are code-reviewed against the same token patterns only, not browser-clicked.

**The three flagged components closed 2026-08-02, same day:** `TeamSettings.tsx`, `SubscriptionSettings.tsx`, and `OrgExportSettings.tsx` converted to the same `var(--cs-*)` palette, following the exact conventions already established (`bg-[var(--cs-surface)]`, `rounded-[6px]`/`rounded-[10px]` for `-md/-lg`/`-xl`, status colors via `text-[var(--cs-danger/ok/warn)]` with the semantic background surfaces like `bg-red-50`/`bg-green-100` kept literal since there's no soft-danger/soft-ok token). The token system is now 100% pure across every Settings tab, not just the eight legacy pages. Gates re-verified green (tsc, build). Browser-verified live against the demo tutor account (owner role): Team, Plan & Billing, and Data & Offboarding tabs all render cleanly with no visual regressions.

Also worth recording: `profiles.organization_id` is **not** vestigial and must not be dropped. `Today.tsx`'s admin lanes query and subscribe to it. It is not authorization-bearing, since RLS never trusts it, but it is load-bearing for a live feature.

## 5. Testing strategy

Four layers, all runnable locally with no Docker, Java, or live database.

| Layer | Command | Count | What it owns |
|---|---|---|---|
| Unit | `npm test` | 177 | Money math, invoice status machine, invoice numbering, webhook signatures, PDF composer, the realtime merge reducer, the debounce and rupee/paise conversion utilities, and one pure-core suite per workspace. |
| RLS / authorization | `npm run test:rls` | 81 | The constitution. Policies tested directly against PGlite with raw SQL. |
| Route contracts | `npm run test:contract` | 197 | The real Express app through supertest against PGlite-backed shims. Covers the auth matrix (401/403/200/409/422) that the RLS layer structurally cannot see, plus webhook HMAC verification, plus (new 2026-08-06) that `apiLimiter` keys per-user, not per-IP. Runs in CI now (was local-only). |
| Load | `npm run test:load:smoke` | k6 | Read-only smoke today. See §2.1 for the write scenario. |

**Rules.** New money math or queue logic lands with unit tests in the same PR. Any migration or privileged-route change runs the RLS suite. Route contracts deliberately skip `cron.ts` (service-token auth, not user JWT), `webhooks.ts` (raw-body HMAC middleware, mounted differently), and `settings.ts`'s Google OAuth endpoints (deferred integration).

**Not built yet:**
- **Playwright E2E** for the five golden journeys: signup to first class; book to attendance to invoice; invoice to payment link to webhook to paid; parent invite to OTP to consent to portal to pay; template edit reshapes future sessions. Journeys 3 and 4 stay blocked on Razorpay and OTP. This is the only layer that catches the "never ran in a browser" bug class described in HANDOFF §8.
- **Axe in CI.** The accessibility pass ran once on 2026-07-25 and fixed five WCAG AA violations across Today, People, Schedule, Settings, and Documents. It is not yet automated, so re-run it as new pages ship.

## 6. Go-to-market checklist

None of this is engineering work, and per the founder's deferral (HANDOFF §7) none of it is a blocker today. This is the list to execute when go-to-market begins. Every seam below is already built and degrading cleanly.

**Payments:** Razorpay live KYC. Per-org key connection and webhook secret. Register the webhook URL for `payment_link.paid` and `payment.captured`. One real rupee payment reconciled. Hourly reconcile cron plus session-materialization cron. Rehearse a refund. CA review of the GST invoice format. Separately, the platform's own billing needs `PLATFORM_RAZORPAY_KEY_ID`, `PLATFORM_RAZORPAY_PLAN_IDS`, and `PLATFORM_RAZORPAY_WEBHOOK_SECRET`, at which point checkout activates with no code change.

**Auth:** Google OAuth redirect URI and consent-screen verification. An SMS provider for phone OTP, which the parent portal hard-depends on. Enable leaked-password protection.

**Comms:** WhatsApp Business API template approval, SMS DLT registration, email domain verification. Until then, manual UPI-link sharing covers the gap.

**Infrastructure:** A staging environment, which is a recurring-cost decision rather than an engineering task. Sentry DSNs on both sides. An uptime probe on `/api/health` plus 5xx alerting. Automated offsite backups (the script exists and a restore was rehearsed once; storage-bucket sync is not included).

**Legal:** Privacy policy, ToS, DPDP parental-consent document (the portal already stamps `consentVersion`, so the document it references must exist), refund policy, and documented 8-year financial-data retention.

**Launch readiness:** A demo org with a wipe. Onboarding tested with a stranger. A staffed support channel. A written release smoke script and a rollback procedure (Vercel covers the app side; there is no rehearsed procedure for a bad migration).

## 7. Deferred epics

Two epics were specced and deliberately never built, both blocked externally rather than technically.

- **Outbound comms router:** templates, channel fallback, quiet hours, bulk reminders. Blocked on provider onboarding above. Roughly 5 ed once unblocked.
- **Google Calendar and Meet integration:** token storage is already migrated. Blocked on OAuth verification. Sessions currently degrade to "link pending". Roughly 3 ed.
