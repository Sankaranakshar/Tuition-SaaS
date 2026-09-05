# ClassStackr Development Plan

**What this is:** the tech-debt backlog and a condensed build log. For current state, architecture, and the runbook, read [HANDOFF.md](HANDOFF.md) first; for the release plan and open founder decisions, [MASTER_PLAN.md](MASTER_PLAN.md); for step-by-step execution, [EXECUTION_PLAN.md](EXECUTION_PLAN.md).

**Superseded for planning.** [MASTER_PLAN.md](MASTER_PLAN.md) replaced this doc's Stage 0–4 numbering with releases R1–R4. This file stays authoritative only for the **Tech Debt #N** backlog (§4) and the testing-layer description (§5). Do not use its stage numbers to judge what's left.

> **Note on old code comments.** Source comments that cite `DEV_PLAN §2`, `§5`, `old E16.x`, etc. point at a *pre-2026-07-25* version of this file whose section layout is gone. Treat them as loose "see the dev plan" pointers, not exact anchors. The **Tech Debt #N** numbers in §4 *are* stable and still cited accurately.

_Last refreshed 2026-09-05 (post-R1 doc consolidation). Gate counts below match HANDOFF.md §2 as of R1 close: 211 unit / 89 RLS / 252 contract, seven gates._

---

## 1. Where the build stands

Stages 0–3 complete (security foundation, server-authoritative money, payments, the six rebuilt workspaces, three-beat onboarding, subscription billing, super-admin console, org export/offboarding, audit log — all 14 legacy pages deleted). **R1 ("Money is correct") complete and merged to `main` 2026-09-05** — attendance reversal, wallet reconciliation, booking-request approval, bulk import, self-serve parent top-up, credit expiry, DPDP consent + per-student erasure. See EXECUTION_PLAN.md's R1 tracker and [docs/EXECUTION_PLAN_R1_ARCHIVE.md](docs/EXECUTION_PLAN_R1_ARCHIVE.md).

The 2026-07-25/26 optimization audit ([docs/OPTIMIZATION_AUDIT.md](docs/OPTIMIZATION_AUDIT.md)) is applied (commit `b15f691`) — see HANDOFF.md §8 for its two most consequential findings (stale Vercel API bundle; `useRealtimeList` stale-closure).

**What remains:** R2 (org-independent identity), then R3/R4, then the go-to-market checklist ([MASTER_PLAN.md](MASTER_PLAN.md) §8). R2 is blocked on staging (B-10) and founder decisions D-02/D-03/D-05/D-06.

## 2. Standing hardening items

### 2.1 k6 load test at real scale — done 2026-08-01

`attendance_burst` against the live production API with founder sign-off, 15 VUs / ~90s against the seeded demo org. **p95 79–101 ms across three runs, well under the 400 ms / 5×-pilot target.** No duplicate invoice despite 15 concurrent VUs on the same session/student — the `FOR UPDATE` wallet lock and the `billed`-flag idempotency guard held under real concurrent write pressure. Caveat if re-run: the script's single shared auth token means it tests "one token under concurrent connections," not "N distinct tutors at once" — a faithful multi-tutor burst needs the script extended to authenticate as several accounts.

### 2.2 External pentest + leaked-password protection

Both **deferred to pre-GTM procurement** (founder, 2026-09-05). The pentest needs a real third-party engagement — an automated scanner is not a substitute; if asked to "do the pentest," say so rather than self-certifying. Vendor shortlist in [docs/EXECUTION_PLAN_R1_ARCHIVE.md](docs/EXECUTION_PLAN_R1_ARCHIVE.md) Step 12. Leaked-password protection is one Supabase dashboard toggle (Auth → Password → HaveIBeenPwned check) — rides the MASTER_PLAN.md §8 "Auth" checklist, not a blocker today.

Standing security posture in the meantime: the RLS suite (89 tests) is the constitution, route contracts (252 tests) cover the auth matrix, the Supabase DB linter is clean, and `npm audit` + the route-contract suite both run in CI.

## 3. Stage 4 work (mobile, growth loop, reporting)

- **Mobile polish — done 2026-08-01.** Bottom tab bar (role-branched), swipe attendance on Today, mobile payment bottom sheet on Money — zero new dependencies, hand-rolled pointer-event swipe + a `BottomSheet` kit primitive. Parent portal at 375px verified clean.
- **Growth-loop payment-link footer — done 2026-08-01.** Every WhatsApp/clipboard payment message appends a branded footer via the `money.paymentLinkFooter` i18n key. Not live-verified end to end (no Razorpay creds locally).
- **Reporting (`POST /api/cron/reporting-daily`) — done 2026-08-02.** One `org_stats_daily` row per active org per UTC date, idempotent upsert. Deliberately **not** wired into Money's insights tab (no requested consumer; swapping the live query for a daily aggregate would be a stale-intraday regression). Cloud Scheduler still needs configuring to call it — same outstanding ops step as `/materialize-sessions`.
- **AI morning brief — deferred by founder** (2026-08-02, with the rest of the AI surface).

**Found but not fixed — needs a content/product decision, not engineering:**
- `src/pages/public/Home.tsx` (the `/` marketing page) is written as a tutor-*marketplace* ("Find 1-on-1 Tutors", "1,200+ Tutors", "Browse Group Batches") — mismatched with the actual product (B2B fee-collection SaaS; `Pricing.tsx` has the correct framing). Unfinished template content. A rewrite, not a technical fix.
- **Activation-funnel analytics** not scoped or started — no analytics infrastructure at all (no PostHog/GA/Segment, no distinct signup route, no anonymous-visitor attribution). Needs a build-vs-buy decision and a definition of "activation" first.

## 4. Technical debt backlog

Only open items are listed. Resolved items are removed rather than kept as struck-through rows — the closed-item history through 2026-08-02 (Tech Debt #1/#2/#4/#5/#6/#7/#8/#9 and the three verified-false entries) lives in git history and [docs/BUILD_LOG_ARCHIVE.md](docs/BUILD_LOG_ARCHIVE.md). **The #N numbering is frozen as a citation anchor — do not renumber; retire a closed item by deleting its row.**

| # | Item | Priority | Effort |
|---|---|---|---|
| 3 | **Dual money columns — conversion logic centralized (2026-08-01), schema question still open.** All `Math.round(x*100)` / `x/100` call sites are now one pair of functions (`shared/money.ts`'s `rupeesToPaise`/`paiseToRupees`). **Still open — needs a founder/product decision, not engineering:** whether to drop the legacy rupee-mirror columns (`invoices.total_amount`/`subtotal`) and make `wallets.balance_currency` paise-native integer, versus maintaining both. That is a real schema migration against live production data with no staging to rehearse it, and it is unconfirmed whether any historical invoice predates the paise columns or whether anything external reads the rupee mirrors. Tracked as **D-04** in MASTER_PLAN.md §5. | High | Decision, then ~1 ed migration + read-path cleanup |

**Structural note, do not regress:** `profiles.organization_id` is **not** vestigial and must not be dropped — `Today.tsx`'s admin lanes query and subscribe to it. It is not authorization-bearing (RLS never trusts it) but it is load-bearing for a live feature.

## 5. Testing strategy

Four layers, all runnable locally with no Docker, Java, or live database.

| Layer | Command | Count | What it owns |
|---|---|---|---|
| Unit | `npm test` | 211 | Money math, invoice status machine, invoice numbering, webhook signatures, PDF composer, the realtime merge reducer, debounce + rupee/paise conversion, credit-expiry FIFO, one pure-core suite per workspace. |
| RLS / authorization | `npm run test:rls` | 89 | The constitution. Policies tested directly against PGlite with raw SQL. |
| Route contracts | `npm run test:contract` | 252 | The real Express app through supertest against PGlite. The auth matrix (401/403/200/409/422) the RLS layer structurally can't see, plus webhook HMAC verification, plus per-user (not per-IP) rate limiting. Runs in CI. |
| Load | `npm run test:load:smoke` | k6 | Read-only smoke. See §2.1 for the write scenario. |

**Rules.** New money/queue logic lands with unit tests in the same PR. Any migration or privileged-route change runs the RLS suite. Route contracts deliberately skip `cron.ts` (service-token auth), `webhooks.ts` (raw-body HMAC middleware), and `settings.ts`'s Google OAuth endpoints (deferred integration).

**Not built yet:**
- **Playwright E2E** for the golden journeys (signup → first class; book → attendance → invoice; invoice → payment link → webhook → paid; parent invite → OTP → consent → portal → pay; template edit reshapes future sessions). Journeys 3 and 4 stay blocked on Razorpay and OTP. This is the only layer that catches the "never ran in a browser" and "role vs organizationRole" bug classes in HANDOFF.md §8.
- **Axe in CI.** The accessibility pass ran once (2026-07-25, fixed five WCAG AA violations) but is not automated — re-run it as new pages ship.

## 6. Go-to-market checklist

Not engineering, and per the founder's deferral (HANDOFF.md §7) not a blocker today. **The authoritative list is [MASTER_PLAN.md](MASTER_PLAN.md) §8** — payments (Razorpay live KYC, per-org keys, webhook registration, reconcile crons, CA review of the GST format, platform-level keys), auth (Google OAuth verification, SMS OTP provider, leaked-password toggle), comms (WhatsApp templates, SMS DLT, email domain), infrastructure (staging, Sentry DSNs, uptime probe, offsite backups), legal (privacy policy, ToS, DPDP consent document, refund policy, 8-year retention), launch readiness (demo-org wipe, stranger onboarding test, support channel, release smoke script, migration rollback procedure). Every seam is already built and degrades cleanly.

## 7. Deferred epics

Both specced, deliberately never built, blocked externally not technically:
- **Outbound comms router** — templates, channel fallback, quiet hours, bulk reminders. Blocked on provider onboarding. ~5 ed once unblocked.
- **Google Calendar / Meet integration** — token storage already migrated. Blocked on OAuth verification. Sessions degrade to "link pending". ~3 ed.
