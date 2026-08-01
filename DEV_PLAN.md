# ClassStackr Development Plan

**What this is:** what is left to build, in priority order. For current state, architecture, and the runbook, read [HANDOFF.md](HANDOFF.md) first.

_Rewritten 2026-07-25, updated 2026-08-01 against commit `b15f691`. Every status below was verified by re-running all gates and checking the claims in code, not inherited from the previous plan._

---

## 1. Where the build stands

Stages 0 through 3 are complete: security foundation, server-authoritative money, payments, six rebuilt workspaces (Today, People, Student Story, Money, Inbox, Schedule), three-beat onboarding, subscription billing, super-admin console, org export and offboarding, and the audit log viewer. All 14 legacy pages slated for deletion are gone. All six gates are green (HANDOFF §2).

A full optimization audit (docs/OPTIMIZATION_AUDIT.md) ran 2026-07-25/26 and its fixes are applied as of commit `b15f691`: a Critical finding (the deployed Vercel API bundle was stale, silently missing 7 of 14 route groups — CI now rebuilds and verifies it), a High finding (a stale-closure bug in `useRealtimeList` that could render the wrong week's data into Schedule after a Realtime event), four dead dependencies removed, and route-contract tests plus `npm audit` wired into CI. See HANDOFF §8 for the two most consequential findings.

What remains is: two hardening items that need something from outside engineering, then Stage 4, then the go-to-market checklist.

## 2. Active work: the last two hardening items

Neither is a "keep coding" task. Both need a decision or a resource first. **Do not infer a go-ahead for either from a general "keep going."**

### 2.1 k6 load test at real scale

`tests/load/attendance-burst.js` is built and smoke-validated. Its `smoke` scenario is read-only and safe anywhere (last run: p95 357ms, threshold 400ms). That result proves the script works. It is not a load-test result, since 2 VUs is negligible traffic.

The `attendance_burst` scenario is the one that would actually validate the p95 under 400ms target at 5x pilot volume. It drives real `POST /api/v1/billing/attendance` calls through the real money-transaction path, creating real invoices and wallet-ledger rows. It deliberately refuses to run without explicit `SESSION_ID` and `STUDENT_ID` env vars, so it can never default into someone's real data.

**Blocked on two things, both the founder's call:**
1. A disposable or seeded test org whose invoice and ledger rows are fine to throw away.
2. Explicit sign-off before pointing write load at a shared environment. There is currently no environment other than the live hosted Supabase project.

**Ask before creating that test org or running the scenario.**

### 2.2 External pentest

Needs a real third-party security engagement. This is not an engineering task, and running an automated scanner does not substitute for it. If asked to "do the pentest," say so rather than self-certifying.

The standing security posture in the meantime: the RLS suite (80 tests) is the constitution, route contracts (179 tests) cover the auth matrix, and the Supabase DB linter is clean. `npm audit` and the route-contract suite are now both wired into CI (fixed 2026-07-26, see §4's closed items). One gap remains: **leaked-password protection is not enabled** in the Supabase Auth dashboard — part of the go-to-market auth checklist (§6), not a blocker today.

## 3. Stage 4: the next real engineering work

If neither item above is actionable, this is what to pick up. Spec is in REDESIGN.md §7 onward.

| Item | Scope |
|---|---|
| **Mobile polish** | Bottom tab bar, swipe attendance, payment bottom sheet. The parent portal at 375px has never been verified on a real device. |
| **Growth loop** | Payment-link referral footer, activation funnel analytics. |
| **AI morning brief** | Claude API narrative layer over the existing rules-based attention queue, per-org toggle, evidence links. The queue itself is already live, so this is narration only. |
| **Reporting** | The nightly `org_stats_daily` aggregation job. The table exists and nothing populates it; Money's insights currently read `payments` directly client-side. |

## 4. Technical debt backlog

Renumbered 2026-07-25. Only open items are listed; resolved ones were removed rather than kept as struck-through rows.

| # | Item | Priority | Why it matters | Effort |
|---|---|---|---|---|
| 1 | **The `admin` role tier is unreachable by any signup flow.** No `profiles` row can ever get `role_type = 'admin'`: onboarding only offers Tutor, Parent, and Student, though `RoleSelection.tsx` still carries full admin UI. `Today.tsx`'s `isAdminTier` also checks `currentRole === "owner"`, equally unreachable. Meanwhile `organization_members.role = 'owner'` **is** set correctly for whoever bootstraps an org, just never surfaced to the client. | High | Tutor verification and Today's per-tutor admin lanes have never been usable by a real account. | 1 to 2 ed once decided |
| 2 | **`profiles.name` is never saved for self-registered accounts.** Signup puts Full Name into GoTrue `user_metadata`, but `AuthContext.loadUser()` inserts the profile with `name: ""` and never reads it back (`src/context/AuthContext.tsx:115`). | Medium | Names render blank across People, Inbox, and invoices. | 0.25 ed |
| 3 | **Dual money columns.** `wallets.balance_currency` is numeric rupees while the ledger is integer paise, with `Math.round(x*100)` conversions between them. Legacy `total_amount` and `subtotal` mirrors persist on invoices. | High | Rounding drift between two sources of truth. Makes invariant #4 aspirational rather than true. | 2 ed |
| 4 | **Realtime refetches everything on any change — partially resolved.** `useRealtimeList` (and its consumers `useInbox`, `useMoney`, `usePeople`, `useSchedule`) now merge INSERT/UPDATE/DELETE payloads locally via `src/hooks/realtimeMerge.ts`, falling back to a full refetch only when a payload can't be safely merged (see that file's own comments). The remaining direct `.channel()` sites in `CommandPalette`, `useStudentStory`, and the legacy pages (`Courses`, `Documents`, `ParentPortal`, `People`, `Settings`, `StudentDashboard`, `Today`) still refetch everything on any change. | Low | Thundering refetch is now contained to legacy/unmigrated surfaces; overlaps Tech Debt #7. | 2 ed to finish |
| 5 | **Membership lookup assumes one org per user** (`limit(1)`, re-run per API request). | Medium | A multi-branch user silently gets one arbitrary org. Also a per-request DB round trip. | 1 ed |
| 6 | **Dead code.** `ClassManager.bookOneOnOneSession()` is defined and never called; its `Wallet`, `TutorAvailability`, and `Enrollment` interfaces are unused. `BillingInvoiceSettings.tsx`'s Excel-export-fields picker writes settings nothing reads. | Low | Misleading surface for a new developer. | 0.5 ed |
| 7 | **Eight legacy pages are functional but not token-styled:** Settings (plus `BillingInvoiceSettings`, `OrganizationSettings`, `TutorAvailabilitySettings`, `TutorProfileSettings`), Profile, Preferences, StudentDashboard, ParentPortal, Documents, Courses, RoleSelection. | Medium | Visual inconsistency against the six rebuilt workspaces. | Rolls into Stage 4 |
| 8 | **Six route files still use inline Zod** instead of `shared/schemas/`: `students`, `parents`, `members`, `gateway`, `documents`, `settings`. | Low | Contract drift risk. Migrate each when its contract is next touched, not as a big-bang pass. | Incremental |
| 9 | **`Today.tsx` links to `/app/calendar` twice** (lines 903, 925). Works via a redirect; should point at `/app/schedule`. | Cosmetic | Retarget whenever Today is next touched. | Trivial |

**Three previously-tracked items were closed:**
- *"`class_sessions.updated_at` exists live but no migration adds it."* Verified false. The column is in `20260709020100_schema.sql`. The RLS and contract suites boot a fresh database from these exact migrations and pass, which independently proves no drift.
- *"`exceljs` is a dead dependency."* No longer true. `server/routes/orgExport.ts` is a real consumer.
- *"CI does not run the route-contract suite or `npm audit`."* Fixed 2026-07-26 (commit `b15f691`): both now run on every CI push, alongside a new step that rebuilds and verifies the Vercel API bundle (see HANDOFF §8).

Also worth recording: `profiles.organization_id` is **not** vestigial and must not be dropped. `Today.tsx`'s admin lanes query and subscribe to it. It is not authorization-bearing, since RLS never trusts it, but it is load-bearing for a live feature.

## 5. Testing strategy

Four layers, all runnable locally with no Docker, Java, or live database.

| Layer | Command | Count | What it owns |
|---|---|---|---|
| Unit | `npm test` | 167 | Money math, invoice status machine, invoice numbering, webhook signatures, PDF composer, the realtime merge reducer, and one pure-core suite per workspace. |
| RLS / authorization | `npm run test:rls` | 80 | The constitution. Policies tested directly against PGlite with raw SQL. |
| Route contracts | `npm run test:contract` | 179 | The real Express app through supertest against PGlite-backed shims. Covers the auth matrix (401/403/200/409/422) that the RLS layer structurally cannot see, plus webhook HMAC verification. Runs in CI now (was local-only). |
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
