# ClassStackr Development Plan (Supabase era)

_Rewritten from scratch on 2026-07-10, after the Firebase → self-hosted Supabase/Postgres migration (HANDOFF.md §11). The previous DEV_PLAN.md was Firestore-era and is superseded by this document; its product intent survives in REDESIGN.md and GO_TO_MARKET_BLUEPRINT.md. This plan treats the current repository as the baseline: completed work is listed as status, not as future tasks._

**Stack (current, verified):** React 19 + Vite + Tailwind 4 SPA, stateless Express API (`server/`), self-hosted Supabase (Postgres + RLS, GoTrue auth, Realtime, Storage), direct `pg` transactions for money/scheduling, Razorpay per-org payment links.

**Audit basis:** every claim in "Current Status" was re-verified against the code on 2026-07-10: `tsc --noEmit` clean, 51/51 unit tests, 41/41 RLS integration tests (PGlite), production build passing. The app has run against the real Supabase project and production Vercel deploy this same day (HANDOFF §13–§15), but the specific flows below marked "not yet browser-verified" have not been exercised in a browser; that gap defines the blocker list.

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
- **Security test suite:** `npm run test:rls` (41 assertions, PGlite, no Docker/Java) is the constitution. It has caught two real shipped bugs (profiles org immutability, class_sessions id-space). CI runs typecheck → unit → RLS → build.
- **Hygiene:** Sentry (both sides, DSN-gated), pino with redaction, helmet, per-user rate limiting, JSON 404s, central error handler with Zod → 422, graceful shutdown, error boundaries per route, bounded + org-scoped queries throughout, INR formatting everywhere.

### Deferred by design (external blockers, not engineering)

- **Epic 7, outbound comms** (WhatsApp Business API, SMS DLT, email domain verification): blocked on provider onboarding. Manual UPI-link sharing covers the gap.
- **Epic 8, Google Calendar/Meet:** blocked on OAuth consent-screen verification. Sessions degrade to "link pending".

### Built but not yet fully runtime-verified (the single biggest remaining risk)

**Update 2026-07-10:** the app is live on Vercel against the real Supabase project, and **signup → email/password auth → org bootstrap → tutor onboarding now works end to end for the first time** (HANDOFF.md §14). Getting there required fixing two infrastructure bugs that had nothing to do with application logic — Vercel silently never registered the API as a function (gitignored build artifact invisible to its pre-build scan), and the server was verifying tokens against an entirely different Supabase project than the one actually in use (a Vercel↔Supabase integration mis-wiring, not a code bug). Both are fixed and documented in HANDOFF §14 as a general lesson for this stack. Still genuinely unverified: booking a session, student-sees-own-session (the §11.4 regression), attendance, invoicing, Realtime subscriptions (all 63 `postgres_changes` call sites), Storage upload/download, Google/phone auth providers, and any Razorpay flow. Treat those as "expected working, not confirmed" until Blocker 3's remaining steps are run.

**Update 2026-07-10 (later same day, HANDOFF §15):** the three UI/flow gaps that were blocking that remaining walkthrough are now built — a courses-management screen (Tech Debt #19), Add Class pricing/fee controls defaulting to Per Session (Tech Debt #20), and a student self-onboarding invite flow mirroring the parent one (Tech Debt #16, new `student_invites` table + `server/routes/students.ts`). None of the three have been exercised in a browser yet — they're built and statically/RLS-verified only, same "expected working, not confirmed" caveat as the rest of this section.

**Update 2026-07-10 (same day, third pass, HANDOFF §16) — the wedge demo is now live-verified.** Ran the actual walkthrough: tutor signup → onboarding → course → student → `PER_SESSION` class booking → attendance → invoice accrual (₹500, exact) → PDF download, all confirmed live against production Supabase. Two more real, previously-undetected bugs were found and fixed in the process: `dotenv` was never actually invoked anywhere in the server (every server-side env var read silently `undefined` in local dev), and Realtime was never enabled at the database level (no migration had ever added any table to the `supabase_realtime` publication, so all ~63 `postgres_changes` subscriptions across the app were silent no-ops — confirmed live, then fixed and re-verified). **Still genuinely unverified at that point:** student-sees-own-session, the parent portal at 375px, Google/phone auth providers, and any real Razorpay flow.

**Update 2026-07-10 (fourth pass, HANDOFF §18.1) — student-sees-own-session is now live-verified too.** Ran the invite/redeem walkthrough as a second login; found and fixed two real bugs along the way (a navigation bug hiding the "Student Portal Access" card behind a blank page, and the actual §11.4-class regression — invite redeem never backfilled `class_sessions`' id-space arrays for sessions materialized before the redeem). Full account in HANDOFF §18.1. **Still genuinely unverified:** the parent portal at 375px, Google/phone auth providers, and any real Razorpay flow (webhook, reconcile, live payment) — all blocked on the founder's external-integrations deferral (§2 note), not on engineering.

### Not started

- Stage 2 workspaces (Student Story, People, Money, Inbox, Onboarding rebuild): Epics 11 to 14.
- Stage 3 (Schedule rebuild, SaaS subscription billing, super-admin, hardening gauntlet): Epics 15 to 17.
- Stage 4 (mobile polish, growth loop, AI brief): Epics 18 to 20.
- Legacy pages still live inside the new shell, functional but not token-styled: StudentProfile (1,308 lines), Calendar, Students, Invoices, Bookings, Timetable, Wallet, Transactions, Messaging, Notifications, Settings/Profile/Preferences.

---

## 2. Immediate Blockers (ranked)

1. ~~Apply the migrations to the hosted project~~ **DONE (2026-07-10).** `supabase db push` applied all 13 migrations to the Cloud project (`cwugpiernnwrhcximjwh`); schema confirmed live in the Table Editor.
2. ~~Production hosting decision~~ **DONE — live on Vercel (2026-07-10).** App deployed to Vercel (serverless, `api/index.ts` + `server/app.ts` + `vercel.json`), Supabase Cloud as backend. Frontend confirmed rendering after fixing a real env-var gap: **the Vercel-Supabase integration auto-injects `SUPABASE_*`/`NEXT_PUBLIC_SUPABASE_*` names, not the `VITE_*`-prefixed names Vite requires** — `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` had to be added manually, and `DATABASE_URL` (which the integration never adds) had to be set explicitly to the transaction-pooler URI (port 6543). Full account in HANDOFF.md §13.3 — read it before touching Vercel env vars again on this or a similar project.
3. ~~First end-to-end walkthrough~~ **DONE (2026-07-10, HANDOFF §16).** The full wedge-demo money loop ran live for the first time: tutor signup → onboarding → course creation → student added → `PER_SESSION` class booked via Calendar → attendance marked from Today → invoice auto-accrued (₹500, matched the fee exactly) → invoice PDF downloaded via the canonical server route. Getting there surfaced and fixed **two more real bugs**, on top of the three in §14: (d) `dotenv` was a listed dependency never actually invoked anywhere in the server, so every server-side `process.env.*` read was silently undefined in local dev (this is why org bootstrap 401'd the moment real credentials were in `.env` — client-side Supabase calls worked fine since Vite loads `.env` independently); (e) Realtime was never enabled at the database level — no migration ever added any table to the `supabase_realtime` publication, so every `postgres_changes` subscription across the entire app (~63 call sites) was a silent no-op. Both fixed; see HANDOFF §16 for the full account. **Not yet done:** student-sees-own-session (the exact §11.4 regression) — the student invite/redeem flow itself (Tech Debt #16) still needs its own browser walkthrough as a second login. Manual payment recording and the reconcile/ledger step are also still unexercised live.
4. **GoTrue configuration:** Google OAuth redirect URI; SMS provider (Twilio or MSG91) for phone OTP, which the parent portal hard-depends on. **DEFERRED BY FOUNDER DECISION (2026-07-10)** — see the note below this list.
5. **Payment loop wiring:** Razorpay live KYC, per-org key connection, webhook URL registration, real ₹ test payment, hourly reconcile + session-materialization cron jobs. **DEFERRED BY FOUNDER DECISION (2026-07-10).**
6. **Legal:** privacy policy, ToS, DPDP parental-consent language (the portal already captures consent; the document it references must exist), refund policy. **DEFERRED BY FOUNDER DECISION (2026-07-10).**

> **Founder decision (2026-07-10): all external integrations and third-party accounts are postponed until every build stage (2–4) is complete and go-to-market begins.** This covers blockers 4–6 above plus Sentry, staging-environment spend, Epic 7 (WhatsApp/SMS/email providers), Epic 8 (Google OAuth verification), and any live Razorpay flow. Consequences for engineering: (a) do NOT stop to ask about or attempt any of these — they are not blockers anymore, they are the go-to-market checklist; (b) every feature that touches an external service must be built to completion behind the existing degradation paths (error toast / "link pending" / manual share) and its seam noted in HANDOFF §17.4's go-live checklist; (c) the next engineering work is Stage 2 — see §2a below and HANDOFF §17.

---

## 2a. Stage 2 Execution Plan (the active work — start here in a new session)

_Added 2026-07-10 after the wedge demo went live (HANDOFF §16) and the founder deferred all external integrations to post-Stage-4 (see §2 note). This section is the concrete entry path into Stage 2. A fresh session should read HANDOFF §17 first, then execute this top to bottom._

### Step 0 — close Stage 1 (do this before any Stage 2 code)

1. ~~**Student invite second-login walkthrough**~~ **DONE and live-verified (2026-07-10, HANDOFF §18.1).** Ran the real walkthrough against local dev (same Supabase Cloud project as production — still no staging, see §3 Critical). Found and fixed two real bugs: (f) People → student profile links/navigates were missing the `/app` prefix (`Students.tsx`'s `Link to={`/students/${id}`}` and three `navigate("/students"|"/messaging")` calls in `StudentProfile.tsx`), which rendered a blank page and blocked reaching "Student Portal Access" from the UI entirely; (g) the actual §11.4-class regression — `students.ts` and `parents.ts`'s `/redeem` endpoints claimed the roster row / created the parent link but never backfilled `class_sessions.student_user_ids`/`parent_user_ids` for sessions materialized before the invite was redeemed, so a newly-redeemed student saw no sessions at all. Fixed with an `array_append` backfill in the same transaction as the claim, for both routes. Verified by resetting the DB to the pre-redeem state and re-running the full signup → redeem cycle against the patched server: `psql` confirmed the array was backfilled, and the browser confirmed Today/Timetable now show the session. This is Tech Debt #16's first true end-to-end verification.
2. ~~**`shared/` Zod schema package**~~ **DONE (2026-07-10, HANDOFF §18.2).** `shared/schemas/billing.ts` and `shared/schemas/scheduling.ts` cover all billing and scheduling request/response shapes; `server/routes/billing.ts` and `scheduling.ts` import the request schemas (replacing inline duplicates), `src/lib/api.ts`/`ClassManager.ts`/`Calendar.tsx` use the inferred types. Live-verified (not just typechecked): recorded a real manual payment through the shared-schema-typed `recordManualPayment()` and confirmed the invoice flipped to PAID. `tsc --noEmit`/51 unit/41 RLS/build/bundle-size all green.
3. _(Optional but cheap, not done this session)_ Playwright E2E for journeys 1–2 (signup → first class; book → attendance → invoice) against local dev + `npm run seed`. Journeys 3–4 stay blocked on Razorpay/OTP (deferred).

**Step 0 is closed.**

### Stage 2 build order (Epics 11–14, rebuilt workspaces — spec: REDESIGN.md §6)

Build in this order (dependency-driven, differs from epic numbering). **Non-negotiable rules for every workspace:** delete the legacy page(s) in the same PR as the replacement; pure logic goes in a tested `src/lib/*.ts` core module (the `today.ts` pattern); data access via new per-entity query hooks (`useStudents`, `useInvoices`, …) that own the Realtime subscription + bounding + error handling; all strings through `t()`; all money via `formatINR`/`formatPaise`; every new table/policy lands with RLS tests; every new `class_sessions` write path uses `resolveUserIds()`.

| Order | Epic | Workspace | Spec | Replaces (delete on ship) | Est. |
|---|---|---|---|---|---|
| 1 | E12 | ~~**People**~~ **DONE (2026-07-10, HANDOFF §19)** — one directory, four lenses (Students/Leads/Parents/Tutors), needs-attention sort, funnel strip for leads, bulk actions (Message/Invoice/Export), convert-lead-to-student. `src/lib/people.ts` (8 unit tests) + `src/hooks/usePeople.ts` + `src/pages/People.tsx` at `/app/people`. Found and fixed a real pre-existing RLS bug along the way: `tutor_profiles`'s policy could never actually let an admin verify another tutor (3 new RLS tests, 44/44). Static/RLS/build all green; money/lead-conversion/invoice-prefill flows live-verified in a browser this session, admin-verifies-tutor path only RLS-test-verified (no browser click yet) — see HANDOFF §19.4 for the exact list. | REDESIGN 6.2 | Students.tsx, Leads.tsx, Admin.tsx (all deleted) | ~1.5 wk |
| 2 | E11 | **Student Story** — reverse-chron timeline (sessions/homework/files/money/messages/notes), pinned facts header, filter chips, inline composer; parent view = same component permission-filtered | REDESIGN 6.3 | StudentProfile.tsx (1,308 lines), AcademicProgress.tsx, StudyMaterial.tsx | ~2.5 wk |
| 3 | E13 | **Money** — one ledger, four segments (Outstanding/Wallets/Invoice detail/Insights), aging buckets, inline payment popover, batch remind (manual-share fallback until Razorpay) | REDESIGN 6.4 | Invoices.tsx, Wallet.tsx, Transactions.tsx, BillingInvoiceSettings sprawl | ~2 wk |
| 4 | E14 | **Inbox + homework loop** — contextual threads (anchor cards), class channels, notifications as actionable inbox items, triage (archive/snooze/waiting) | REDESIGN 6.5 | Messaging.tsx, Notifications.tsx | ~2 wk |
| 5 | E14.5 | **Onboarding rebuild** — three-beat conversational setup (solo/center → first class from template gallery → add 2 students / CSV) | REDESIGN 6.7 | Onboarding.tsx form sequence (keep the invite-redeem branches — they are current, not legacy) | ~1 wk |

**Exit gate for Stage 2:** all five shipped, zero legacy pages from the table remaining, suites green, and one full manual walkthrough of the wedge demo re-run live (it must still work after all the deletions). Before starting item 2, run a real browser walkthrough of item 1's not-yet-live-verified paths (HANDOFF §19.4) — Student Story will build on top of the student-detail nav path People now owns.

Then Stage 3 (§5 below): Schedule rebuild → SaaS subscription billing **built gateway-agnostic behind the existing abstraction, live wiring deferred** → super-admin → org export → hardening.

---

## 3. MVP Launch Tasks (before the first paying customer)

Effort in engineer-days (ed).

### Critical

| Task | Effort | Notes |
|---|---|---|
| ~~Blockers 1 and 2 (infra up + e2e walkthrough + fixes)~~ **DONE (2026-07-10)** — see Blocker 3, HANDOFF §16 | — | Full attendance→invoice loop confirmed live; Realtime now genuinely working (was silently broken, see §16) |
| Browser QA: Today, Calendar booking, invoice lifecycle | 1 ed | **Partially done (2026-07-10)** — all three confirmed live in this session's walkthrough. Parent portal (375px) still unverified — needs phone OTP / Google OAuth, still blocked |
| Real-device parent flow: OTP → invite redeem → Pay Now → webhook reconcile | 1 ed | Needs GoTrue config (Blocker 4) and Razorpay (Blocker 5) — still blocked |
| ~~Fix: Students.tsx legacy base64 document upload~~ **DONE (2026-07-10)** | — | Upload/download/delete now route through the server storage API (`uploadDocument`/`getDocumentUrl`/`deleteDocument`); no more base64-into-Postgres or direct client insert/delete. Typecheck clean |
| ~~Backup/restore: nightly `pg_dump` + storage sync, one rehearsed restore~~ **DONE (2026-07-10)** | — | `scripts/backup.sh` — `supabase db dump --linked` turned out to need Docker internally and fails without it; script uses a real standalone `pg_dump` (Homebrew `libpq`) against the direct/pooler connection instead. Restore actually rehearsed this session: dumped the live project, restored into a scratch local Postgres, verified row counts matched, tore the scratch DB down. Storage-bucket sync not included — no files have been uploaded through the app yet to back up |
| Staging vs prod environments (two Supabase stacks or two projects) | 1 ed | Still not done — this is a real recurring-cost decision (a second Supabase project), not a pure-engineering task; needs a product/budget call before building |

### High

| Task | Effort | Notes |
|---|---|---|
| ~~Fix: client-side jsPDF invoice/report generation~~ **DONE (2026-07-10)** — see Tech Debt #2/#6 | — | `Invoices.tsx` now calls `downloadInvoicePdf`; `StudentProfile.tsx`/`AcademicProgress.tsx` progress reports (a different document, not an invoice) now dynamic-import jspdf instead of moving server-side — the task's own listed alternative. Live-verified this session: downloading a real invoice PDF returned 200 |
| ~~Seed script for demo/staging data~~ **DONE (2026-07-10)** | — | `scripts/seed.ts` (`npm run seed`) — idempotent, creates a demo tutor + org + 2 courses + 3 students + a completed/billed session + an upcoming one. Verified against the live project, including the idempotency guard (re-running skips cleanly) |
| Uptime monitoring + Sentry DSNs wired in prod, alert on 5xx | 0.5 ed | Still not done — confirmed via `vercel env ls production` that no `SENTRY_DSN`/`VITE_SENTRY_DSN` are set; needs a Sentry account, which is outside what an agent can create |
| ~~Onboarding walkthrough polish after first real signup attempt~~ **Superseded (2026-07-10)** — the walkthrough ran clean this session (tutor path); no polish issues found. Student/parent onboarding paths still need their own pass | — | |
| ~~Manual send of payment reminders (copy-link UX on Invoices page)~~ **DONE (2026-07-10)** | — | New "Share payment link via WhatsApp" button per unpaid invoice row in `Invoices.tsx`, reusing the same Razorpay payment-link endpoint the parent portal's Share button calls (`createInvoicePaymentLink`). Degrades to a clear error toast until a real Razorpay gateway is connected per org (Blocker 5) |

### Medium

| Task | Effort | Notes |
|---|---|---|
| ~~Bundle budget: add a bundle-size check to CI~~ **DONE (2026-07-10)** | — | `scripts/check-bundle-size.mjs` (`npm run check:bundle-size`), wired into `.github/workflows/ci.yml` after the build step. Gate set at ~260KB gzip on the main entry chunk (current: ~217KB) — a regression gate at today's real size, not the original unenforced 200KB target, which would fail on unrelated work. Verified it actually fails over-budget and passes under. CI run confirmed green with the new step |
| ~~Delete `/api/settings` alias once frontend confirmed on `/api/v1`~~ **DONE (2026-07-10)** — see Tech Debt #9 | — | |
| ~~Sweep stale Firestore-era comments (~20 files) and the `.env.example` AI-Studio header~~ **Partially done (2026-07-10)** — see Tech Debt #9 | — | `.env.example` was already clean, no fix needed. The comment sweep was deliberately **not** done — those ~30 files document real migration history per this repo's own commenting philosophy; a blanket removal would cost more (lost context) than the 0.5 ed estimate assumed it would save |
| Resume Epic 7 (comms router) when provider KYC clears | 5 ed | Was fully specced in the old plan; templates, fallback, quiet hours, bulk remind |
| Resume Epic 8 (Calendar/Meet) when OAuth verification clears | 3 ed | Token storage already migrated |

### Low

| Task | Effort |
|---|---|
| ~~Drop vestigial `profiles.organization_id` column~~ **CORRECTED (2026-07-10), do not do this** — see Tech Debt #8. `Today.tsx`'s admin per-tutor lanes actively query and subscribe to this column; it's not vestigial, dropping it breaks a live feature. |
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
| 2 | ~~Client-side jsPDF invoices diverge from server GST invoice~~ **DONE (2026-07-10)** — `Invoices.tsx`'s `downloadPDF` now calls the server's canonical `GET /api/v1/billing/invoices/:id/pdf` (`downloadInvoicePdf` in `src/lib/api.ts`) instead of rendering its own jsPDF invoice. Removed the now-dead `pdfTemplate` (logo/footer/address) settings from `BillingInvoiceSettings.tsx` — those fields fed only the deleted client-side renderer and the server PDF never read them, so keeping the settings UI would have silently done nothing. Note: `StudentProfile.tsx`/`AcademicProgress.tsx`'s jsPDF usage is a genuinely different document (a student progress report, not an invoice) — out of scope for this item, addressed for bundle size in #6 instead. | — | — | — | Resolved | — |
| 3 | Legacy pages awaiting Stage 2 rebuild (StudentProfile et al.) | High | 1,300-line files, direct client writes, not token-styled | Stage 2 | Velocity, consistency | Stage 2 schedule |
| 4 | Dual money columns: `wallets.balance_currency` numeric rupees + `Math.round(x*100)` conversions in billing, legacy `total_amount`/`subtotal` mirrors on invoices | High | Rounding drift between ledger paise and wallet rupees | 2 ed | Invariant #4 becomes true instead of aspirational | e2e verified first |
| 5 | Realtime refetch-on-any-change (63 call sites) | Medium | Thundering refetch on busy orgs | 3 ed | Perf at scale | live Realtime observed |
| 6 | ~~`recharts` dead dependency; jspdf/html2canvas static chunks~~ **DONE (2026-07-10)** — `recharts` removed from `package.json` (confirmed zero imports anywhere in `src/`). `StudentProfile.tsx`/`AcademicProgress.tsx`'s progress-report generators now dynamically `import("jspdf")`/`import("jspdf-autotable")` inside the click handler instead of a static top-level import, matching the existing `exceljs` lazy-load convention — confirmed in the build output that `jspdf.es.min`/`jspdf.plugin.autotable`/`html2canvas.esm` are now their own chunks, not baked into each page's eager bundle. | — | — | — | Resolved | — |
| 7 | Membership lookup per API request, single-membership assumption (`limit(1)`) | Medium | Multi-org users silently get one org | 1 ed | Correctness for multi-branch future | product decision |
| 8 | ~~`profiles.organization_id` vestigial column~~ **CORRECTED (2026-07-10), NOT dropped.** Audited before touching it: `src/pages/Today.tsx`'s admin per-tutor lanes (`loadTutors`) actively queries `profiles.organization_id` (`.eq("organization_id", orgId).eq("role_type", "tutor")`) and subscribes to it via a `postgres_changes` filter — this is how the Today workspace resolves tutor display names for the org. It is not authorization-bearing (RLS still never trusts it), but it **is** a real, in-use data column. Dropping it as originally scoped would have broken the Today admin view. Leaving it in place; if a future pass wants it gone, `loadTutors` needs to resolve tutor names via `organization_members` + `profiles.id` instead first. | — | — | — | Not applicable — column is load-bearing | — |
| 9 | ~~Firestore-era comments, stale `.env.example` header, `/api/settings` alias~~ **DONE (2026-07-10)** — `.env.example` was already Supabase-era, no stale header found. Removed the `/api/settings` alias from `server/app.ts`; the only client code still calling it (`Settings.tsx`'s Google OAuth connect/disconnect fetches) now calls `/api/v1/settings/...`. Also fixed a real, separate bug found in the process: the Google OAuth setup instructions in `Settings.tsx` displayed `/api/settings/google/callback` as the redirect URI to register in Google Cloud Console, but the server actually sends `/api/v1/settings/google/callback` (`server/routes/settings.ts`) — anyone who followed the displayed instructions literally would have hit `redirect_uri_mismatch`. Left the large body of historical Firestore-era *comments* (30+ files) alone — those are intentional documentation of migration history per HANDOFF's own stated philosophy, not stale cruft, and a blanket sweep would remove real context for a fraction of the estimated 0.5 ed. | — | — | — | Resolved (Firestore comments intentionally not touched — see note) | — |
| 10 | ~~`metadata.json` and other AI-Studio scaffolding remnants~~ **DONE (2026-07-10)** — removed `metadata.json` (unreferenced anywhere). `vite.config.ts` cleaned up: dropped the `GEMINI_API_KEY` define (confirmed unused anywhere in `src`/`server`) and the AI-Studio-specific `DISABLE_HMR` comment/logic, which doesn't apply to this Vercel+local-dev setup. | — | — | — | Resolved | — |
| 11 | ~~Hosted vs self-hosted direction unresolved~~ **DONE (2026-07-10)** — hosted Cloud chosen; `.env.example`/`README` updated, self-hosted kept as Option B | — | — | — | Resolved | — |
| 12 | ~~Migration filenames incompatible with `supabase db push`~~ **DONE (2026-07-10)** — renamed to `<timestamp>_name.sql`, added `supabase/config.toml`; RLS suite still 40/40. CLI linked and `db push` run successfully. | — | — | — | Resolved | — |
| 13 | Vercel-Supabase integration doesn't set Vite-prefixed env vars or `DATABASE_URL` | Low (documented, one-time) | Blank-page failure on first deploy of any Vite app using this integration | done, doc only | Runbook exists for next redeploy/rotation | HANDOFF §13.3 |
| 14 | ~~Vercel serverless function 500 (`ERR_MODULE_NOT_FOUND`)~~ **DONE (2026-07-10)** — Vercel's per-file TS builder doesn't bundle cross-directory imports; fixed by esbuild-bundling `server/vercelHandler.ts` into a self-contained `api/index.js` at build time. See HANDOFF §13 for the full account. | — | — | — | Resolved | — |
| 15 | ~~Onboarding wrote role profiles using a possibly-stale `user.organizationId`~~ **DONE (2026-07-10)** — race between bootstrap completing and the onboarding write, caused a real NOT NULL violation in production. `checkAuth()`/`loadUser()` now return the resolved user so callers can re-resolve `organizationId` instead of trusting a stale closure; a clear error now shows if it still can't be resolved instead of a raw Postgres error. | — | — | — | Resolved | — |
| 16 | ~~Student self-onboarding has no way to join an organization at all~~ **DONE and now fully live-verified (2026-07-10, HANDOFF §18.1)** — new `student_invites` table mirrors `parent_invites` exactly (migration applied to the live Supabase project); `server/routes/students.ts` mints/previews/redeems invites tied to an existing unclaimed `students` roster row, redeeming sets `student_user_id` and grants the `student` org role. Replaced `Onboarding.tsx`'s dead code path (it upserted into `student_profiles` columns — `full_name`/`grade`/etc. — that don't exist in that table's actual schema, so it would have crashed the moment a student ever got past the missing-org gap) with an invite-code UI matching the parent flow. New "Student Portal Access" invite card in `StudentProfile.tsx`; `?studentInvite=TOKEN` deep-link capture in `App.tsx`. RLS suite gained a matching deny-all test for `student_invites` (41/41 green). Ran the full second-login walkthrough this session; found it was blocked by two more bugs (#21, #22 below), fixed both, re-verified live end to end. | — | — | — | Resolved | — |
| 21 | ~~People → student profile links missing the `/app` prefix~~ **DONE (2026-07-10, HANDOFF §18.1)** — `Students.tsx`'s student-name `Link` and three `navigate()` calls in `StudentProfile.tsx` targeted `/students...`/`/messaging` instead of `/app/students...`/`/app/messaging`; since those routes only exist nested under `/app`, the absolute-path `Link`/`navigate` targets resolved outside the router's match and rendered a blank page — silently blocking every path to "Student Portal Access" from the UI, not just this walkthrough. Fixed all four call sites. | — | — | — | Resolved | — |
| 22 | ~~`class_sessions` id-space arrays never backfilled on invite redeem~~ **DONE (2026-07-10, HANDOFF §18.1)** — the actual §11.4-class regression: `students.ts`/`parents.ts` `/redeem` claimed the roster row / created the parent link but never added the newly-linked user id into `student_user_ids`/`parent_user_ids` on sessions materialized before the redeem (those arrays are only populated by `resolveUserIds()` at insert/materialize time). A student who redeemed an invite for an already-scheduled class saw no sessions at all. Fixed with an `array_append` backfill in the same transaction as the claim, both routes. Verified by resetting the DB to the pre-redeem state and re-running the full cycle against the patched server. | — | — | — | Resolved | — |
| 23 | ~~No shared type package between `server/` and `src/`~~ **DONE (2026-07-10, HANDOFF §18.2)** — see Architecture Improvements below; billing + scheduling contracts migrated to `shared/schemas/*.ts` this session. | — | — | — | Resolved | — |
| 24 | ~~`tutor_profiles` RLS never let an admin actually verify another tutor~~ **DONE (2026-07-10, HANDOFF §19.2)** — the policy's `with check` was `user_id = auth.uid()` only; an admin's UPDATE of a different tutor's row always satisfied `using` (staff can see it) but always failed `with check` (the row still belongs to someone else), so Postgres rejected the write outright. This means Admin.tsx's Verify/Revoke buttons never worked for their actual purpose since the table was created — found while porting that logic into the new People workspace's Tutors lens. Fixed in migration `20260710140000_tutor_verify_fix.sql` (`with check` now also allows `is_org_admin`, deliberately not the broader `is_staff` — verification isn't peer-service); 3 new RLS tests added (44/44 total). Applied to the live Supabase Cloud project. | — | — | — | Resolved | — |
| 25 | The "admin" role tier is unreachable by any real signup flow | High | Tutor verification (old Admin.tsx, new People Tutors lens) and Today.tsx's admin-tier per-tutor lanes have never been usable by any account created through this app's actual onboarding — distinct from and deeper than #24's RLS fix (#24 fixed the query; this is that nothing can ever produce an admin account to run it). Zero `profiles` rows anywhere have `role_type = 'admin'` (confirmed via direct query, no PII). `RoleSelection.tsx`/`Onboarding.tsx` have full UI support for an `'admin'` role (icon, description, a whole `renderAdminSteps()`) but no path ever sets it — onboarding only offers Tutor/Parent/Student. `Today.tsx`'s `isAdminTier` also checks `currentRole === "owner"`, which is equally unreachable (`currentRole` only ever derives from the same `role_type`-sourced array). Meanwhile `organization_members.role = 'owner'` **is** set correctly for whoever bootstraps an org — it's just never surfaced to the client as an admin-tier signal. Reported, deliberately not fixed this session (explicit instruction) — needs a real decision: does onboarding get an admin option, does the org owner get to promote a member, or does `organization_members.role` become the client-side signal instead of `profiles.role_type`? Whatever's decided, re-verify it against #24's RLS fix and its 3 tests. | 1-2 ed once decided | Decision, not pure engineering | HANDOFF §19.7 |
| 17 | ~~Vercel never registered `api/index.js` as a function~~ **DONE (2026-07-10)** — was gitignored/build-time-only, invisible to Vercel's pre-build git scan; every `/api/*` request silently served the static SPA shell. Fixed by committing a real `api/index.js` so Vercel's scan finds it; `buildCommand` still regenerates it fresh each deploy. See HANDOFF §14.1. | — | — | — | Resolved | — |
| 18 | ~~Server-side `SUPABASE_URL` pointed at the wrong Supabase project~~ **DONE (2026-07-10)** — the Vercel↔Supabase integration populated `SUPABASE_URL`/`SUPABASE_SERVICE_ROLE_KEY` from a different project than the one actually migrated and logged into; every JWT verification 401'd against the wrong project's JWKS. Fixed by correcting the env vars to the right project. **Re-check this whenever the Supabase integration is reconnected or a new env var is auto-populated by it** — see HANDOFF §14.2 for the exact symptom (Vercel's Function Invocation → External APIs panel showing the JWKS fetch URL was the giveaway). | — | — | — | Resolved | — |
| 19 | ~~No UI anywhere creates a `courses` row~~ **DONE (2026-07-10)** — new `Courses.tsx` page (`/app/courses`, reachable via the command palette): list, create, delete, direct client writes matching the existing `courses_write` (org-admin) RLS policy. | — | — | — | Resolved | — |
| 20 | ~~Add Class modal has no UI control for pricing model or fee amount at all~~ **DONE (2026-07-10)** — `Calendar.tsx`'s Add Class modal now has real Pricing Model (Per Session / Monthly) and Fee Amount form controls wired to the `pricingModel`/`feeAmount` state that was already there but never rendered; default changed from `MONTHLY` to `PER_SESSION` so a class created without touching the field is still billable. | — | — | — | Resolved | — |

---

## 7. Architecture Improvements

- **Module boundaries are healthy; keep them.** Pure logic in `src/lib/today.ts` and `server/utils/*` (unit-tested, IO-free) is the pattern to extend: every new workspace gets a pure core module + a thin page.
- **Shared types:** ~~there is no shared type package between `server/` and `src/`~~ **DONE (2026-07-10, HANDOFF §18.2).** `shared/schemas/billing.ts` and `shared/schemas/scheduling.ts` now cover those two domains' request/response shapes; server routes validate with them, client infers types from them. New Stage 2 endpoints must define their schema in `shared/schemas/` from day one — extend this pattern (e.g. `shared/schemas/people.ts`) rather than reintroducing inline duplicates.
- **API organization:** routes are cleanly split by domain. When Epic 7 lands, put the channel router in `server/jobs/` rather than routes, and formalize the cron surface (`/api/cron/*`) with a job registry.
- **Data access on the client:** pages talk to `supabase-js` directly with ad-hoc queries. Extract per-entity query hooks (`useSessions`, `useInvoices`) so Realtime subscription, bounding, and error handling live in one place each; adopt during Stage 2 rebuilds, not as a big-bang refactor.
- **Testing strategy:** keep the three-layer pyramid (unit for money math and today-derivations, PGlite RLS suite for authorization, supertest for route contracts). Add Playwright E2E for the five golden journeys once a seeded staging exists; E2E is the only layer that can catch the "never ran in a browser" class of bug.
- **CI/CD:** CI is solid (typecheck, unit, RLS, build, no external deps). Add: bundle-size check, `npm audit` gate, deploy-to-staging on merge once hosting exists, migration-ordering lint (applying 0001..N to a fresh PGlite already happens in the RLS suite, which is an excellent migration test; keep it mandatory).
- **Deployment:** now live (Vercel + Supabase Cloud, HANDOFF §13). Still needed: a written smoke script (`/api/health`, login, one read per table group) to run after every deploy, and a documented rollback procedure (Vercel's instant-rollback-to-previous-deployment covers the app side; there's no equivalent rehearsed procedure for a bad migration on the Supabase side yet).

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
