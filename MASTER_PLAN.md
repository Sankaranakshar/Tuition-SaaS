# ClassStackr Master Plan

**What this is:** one plan, merged from DEV_PLAN.md, HANDOFF.md, REDESIGN.md, GO_TO_MARKET_BLUEPRINT.md, README.md and `ClassStackr_Product_Spec_v2.xlsx`. It supersedes the release planning in each of those individually. Where they disagreed, the disagreement is resolved here and recorded in §9.

_Written 2026-08-02 against commit `f44f085` plus the uncommitted reporting-job and token-styling passes. Code claims re-checked directly, not inherited. Amended 2026-08-06: B-02 and B-20 shipped (commit `64db1e7` plus an uncommitted pass), D-08 and D-01 decided by the founder — see §3, §4, §5, §10. [EXECUTION_PLAN.md](EXECUTION_PLAN.md) is the step-by-step, checkbox-trackable execution order derived from this plan's R1; start there for day-to-day work._

---

## 1. Source map: which document still governs what

| Document | Still authoritative for | Stale, do not trust for |
|---|---|---|
| **HANDOFF.md** | Current state, architecture, runbook, security invariants, the trap list | Nothing. Keep it current. |
| **REDESIGN.md** | Product experience, IA, motion, visual language, interaction vocabulary | §17 (dual-store), §23 phasing (delivered) |
| **DEV_PLAN.md** | Tech-debt detail, testing strategy, what shipped when | Its stage numbering, replaced by R1 to R4 below |
| **Spec v2 (xlsx)** | Role matrix, per-screen IA, marketplace spec, backlog scoring, open decisions | Nothing. It is the newest artifact. |
| **GO_TO_MARKET_BLUEPRINT.md** | Market position, ICP, the wedge, monetization logic, launch-gate checklist | §2, §7, §8, §9, §10 entirely. Firestore-era history, the stack is now Supabase/Postgres. |
| **README.md** | Setup, architecture summary, deployment, security invariants (rewritten 2026-08-06, B-20) | Nothing currently known |
| **EXECUTION_PLAN.md** | Day-to-day execution order within R1 and progress tracking (checkboxes) | Anything beyond R1 — it does not yet cover R2-R4, which depend on undecided founder calls and staging |

**The one-line product definition, updated by spec v2:** a platform connecting parents, students and tutors, where a tutor may be independent or part of an organisation, and the same person may be both. This is a widening from the blueprint's "the tuition center OS that collects your fees," and it is what makes R2 and R3 structural rather than optional.

---

## 2. Where the build actually stands

**Shipped and verified live:** the whole management product. Six workspaces (Today, People, Student Story, Money, Inbox, Schedule), three-beat onboarding, server-authoritative money with `FOR UPDATE` locks and idempotency keys, invoices with GST snapshot and PDF and Razorpay links and webhook reconciliation, refunds against invoices, subscription billing with a DB-enforced student cap, super-admin console, org export and offboarding, audit log, staff/parent/student invite flows, mobile polish, the nightly `org_stats_daily` job.

**Gates, all green:** tsc, 182 unit, 81 RLS, 197 contract, build, bundle 199.2KB against a 260KB budget, API-bundle route verification. All seven run in CI. None need Docker, Java or a live database.

**Load:** k6 `attendance_burst` against live production, p95 79 to 101ms against a 400ms target, no duplicate invoice under 15 concurrent VUs.

**The honest gap, and it is bigger than DEV_PLAN implied.** DEV_PLAN described the remaining work as "pentest, then Stage 4 leftovers, then go-to-market." Spec v2 found three classes of gap that were not on that list at all:

1. **The money loop is one-directional.** Attendance debits a wallet and accrues an invoice. Nothing reverses it. There is no un-mark path in `server/routes/billing.ts`, no credit-back, no ledger-versus-balance reconciliation check, and prepaid credits never expire. Mis-marking is the single most common daily operator event and the product has no remedy for it.
2. **Identity is org-locked.** `tutor_profiles`, `parent_profiles` and `student_profiles` are keyed on `user_id` with a NOT NULL `organization_id`. A person belongs to exactly one org, forever. That contradicts the product's own one-line definition and blocks the entire marketplace.
3. **The "connects" half of the product does not exist.** Discovery, verification, trials, reviews, escrow, payouts. ClassStackr currently manages a relationship that already exists. It cannot create one.

DEV_PLAN's remaining items (external pentest, tech debt #3, activation analytics, the GTM checklist, the two deferred epics) are all still open and are folded into the releases below rather than tracked separately.

---

## 3. The plan: four releases

Each release has a single thesis, a gate, and an effort total. Effort is in engineer-days (ed), founder-supplied estimates, not measured.

### R1 — Money is correct (22.5 ed + carried items)

**Thesis:** nothing else matters if a wallet balance can be wrong. Every item here either closes a correctness hole or removes a human from a loop that should be self-serve.

| ID | Item | ed | Notes |
|---|---|---|---|
| ~~B-01~~ | ~~Attendance reversal and wallet credit-back~~ | ~~3~~ | **Done 2026-08-06.** `POST /api/v1/billing/attendance/reverse` (`server/routes/billing.ts`), reading D-08's per-org policy via `getCancellationPolicy()`. Un-marks a billed attendance record, credits back the wallet (whole credit for a credit-charged session, policy-computed percentage for a currency-charged one), voids an unpaid accrued invoice or writes a partial `refunds` row for a paid one, and writes a linked `wallet_ledger` row plus an `attendance.reverse` audit event. Kept as a separate explicit per-student action from `/sessions/cancel`, as the item's own design note recommended. See EXECUTION_PLAN.md Step 2 for the full design log and browser-verification detail. |
| ~~B-02~~ | ~~Fix per-user rate limiting~~ | ~~1~~ | **Done 2026-08-06.** `identifyUser` (`server/middleware/auth.ts`) now runs ahead of `apiLimiter` to populate `req.user.id` for the keyGenerator without doing the full membership lookup; real auth still enforced downstream by each route's `authenticateToken`. See HANDOFF.md §8. The k6 caveat in DEV_PLAN §2.1 was about the limiter's *effect*, not its config, and stands independent of this fix. |
| B-03 | Wallet-to-ledger reconciliation job | 2 | Scheduled check that `balance_currency` equals the sum of `wallet_ledger`. Same `CRON_SECRET` pattern as `/api/cron/reporting-daily`. This is the check that finds the next B-01. |
| B-04 | Credit expiry policy | 3 | Per-org window with warning notices before lapse. Needs D-07. Today credits are immortal, an unbounded liability with no revenue-recognition point. |
| B-05 | Self-serve parent top-up | 4 | Top-up is staff-only today. Biggest labour saving for a centre and the fastest path to parent-side engagement. Degrades behind `gateway_not_connected` until Razorpay is live. |
| B-09 | Bulk import (CSV/Excel, column mapping, dry run) | 3 | Every prospect runs on a spreadsheet. Manual entry of 200 students is the switching cost that loses the deal. |
| B-10 | Staging environment | 2 | Recurring-cost decision, not an engineering one. It is the blocker on D-04 and the reason a dozen things in DEV_PLAN say "verified against production" or "never clicked in a browser." |
| B-11 | DPDP consent centre and per-student erasure | 4 | Statutory. Org-level export exists, per-student erasure does not, and consent is currently implicit despite the portal stamping a `consentVersion`. The document that version points at must also exist (GTM legal). |
| ~~B-20~~ | ~~Rewrite README~~ | ~~0.5~~ | **Done 2026-08-06.** Rewritten for the actual stack (Supabase/Postgres RLS, stateless Express, Vercel), correct commands, and a pointer to this document. |
| — | Booking-request approval UI | ~1 | Carried from spec v2 Tutor tab. `session_requests` exists, the staff accept/decline/propose UI is thin. |
| — | Cancellation-policy surface (parent-facing) | ~1 | Shows cutoff, late-cancellation cost, refund. Pairs with B-01. The clearest source of fee disputes. |

**Also folded into R1 from DEV_PLAN, no new estimate:** external pentest (a procurement task, not engineering; do not self-certify with a scanner), enabling leaked-password protection in Supabase Auth, and wiring Cloud Scheduler to `/api/cron/materialize-sessions` and `/api/cron/reporting-daily`, which are both built and both currently never fire in production.

**R1 gate:** a mis-marked attendance can be fully reversed by an owner, with the wallet, the invoice and the ledger all agreeing afterwards; the reconciliation job runs clean against production; a parent tops up their own wallet without a staff member; a 200-student centre imports in one sitting; staging exists and the R1 migrations were rehearsed on it first.

### R2 — One person, many orgs (26 ed)

**Thesis:** make identity org-independent. This is the structural prerequisite for R3, and it is a real migration against live data. Do not start it before staging (B-10) exists.

| ID | Item | ed |
|---|---|---|
| B-06 | Person-centric identity: one login, many memberships. Independent tutor modelled as a single-member org so the schema never forks (D-01) | 8 |
| B-07 | Org switcher plus cross-org conflict checking | 5 |
| B-08 | Tutor payouts and earnings: hours or sessions taught, earnings ledger, payout run, statement, TDS. Built once, serves org payroll and marketplace payouts alike | 6 |
| B-12 | Monthly progress-report PDF | 3 |
| B-13 | Substitute and leave management | 4 |

**Also in R2, from the IA tabs:** the assignment marking loop back into the gradebook (currently upload works, marking does not, on both the staff and student side), guardian records moving from student-owned to parent-owned, cross-org family view for parents, and student session-requests routed to a parent for approval below the age threshold set in D-05.

**R2 gate:** one human account teaches independently on Tuesdays and at a centre on Thursdays, switches context without logging out, and neither org can book over the other; a parent with children at two different centres sees one home screen; a centre runs a payout cycle inside the product.

**R2 also unblocks D-04.** Once staging exists and the identity migration has proven the team can run a real migration against production data, the legacy rupee-mirror columns (`invoices.total_amount`, `invoices.subtotal`, `wallets.balance_currency`) can finally be resolved. Conversion logic is already centralized in `shared/money.ts`; only the schema question is open.

### R3 — The marketplace (30 ed)

**Thesis:** turn a management tool into a two-sided platform, and open the second revenue line. Sequenced in six stages, each depending on the one before.

| Stage | Contents | Release notes |
|---|---|---|
| 1. Supply | Public tutor profile (bio, subjects, boards, grades, mode, rate, languages, photo, intro video); verification tiers (email/phone → government ID → qualification docs → background check) with a visible badge; org storefront | B-14, 8 ed. Verification is non-negotiable: adults are being introduced to minors. It is also the genuine moat against listing sites. |
| 2. Discovery | Search and filter (subject, board CBSE/ICSE/State, grade, mode, price band, rating, distance, availability); matching ranked on fit, proximity, availability, response rate and outcomes, never on who paid most | Part of B-15. Get the board/grade taxonomy right once, retrofitting it is painful. |
| 3. Conversion | Structured enquiry with an SLA clock landing in the tutor's Inbox; trial lesson booked in-app with a structured follow-up decision; enrolment that hands off to the management product with wallet funded and invoice raised | B-15, 12 ed total. The trial is the highest-leverage primitive in this category. The enrolment handoff is the actual differentiation. |
| 4. Trust | Reviews gated on verified completed attendance, tutor may reply once, moderation queue; dispute resolution with evidence, decision and wallet remedy | B-16. Dispute resolution depends entirely on R1's reversal engine. Attendance gating is what makes ratings credible. |
| 5. Money | Escrow (held until the session is marked attended, then released); take rate tapering as the relationship matures; leakage strategy competing on value rather than blocking contact details | B-16, 10 ed with trust. Needs D-02 and D-03 decided. |
| 6. Compliance | Minor-safety policy for adult-minor 1:1 chat, session recording, parental thread visibility (D-06); DPDP consent extended to marketplace, no behavioural tracking of children | Builds on R1's consent centre. Also a sales objection from every institutional buyer. |

**Growth's Leads pipeline is retired here,** replaced by the marketplace enquiry funnel. Do not invest further in the leads table before then.

**R3 gate:** a parent who has never heard of a specific tutor finds one, books a trial, has a good first hour, enrols, funds a wallet, and the platform takes its cut, all without anyone leaving the product.

### R4 — Scale and growth (12 ed)

| ID | Item | ed | Notes |
|---|---|---|---|
| B-17 | WhatsApp comms router: session reminders, fee due, absence alerts, broadcast with delivery and read counts | 5 | Blocked on provider onboarding, which has multi-week lead times. Start DLT registration and template approval early. Parents will not migrate off WhatsApp, so meet them there. Absorbs the blueprint's "outbound comms router" deferred epic. |
| B-18 | Leading-indicator dashboard: attendance drop-off, credit burn-down, tutor utilisation, at-risk students | 4 | Current metrics are lagging. These flag a churning centre weeks earlier. This is the first real consumer for `org_stats_daily`, which was deliberately built without one. |
| B-19 | Referral loop: parent refers a family, both get wallet credit | 3 | Cheapest acquisition channel here, and the wallet makes the payout mechanically trivial. Complements the payment-link footer already shipped. |
| — | Google Calendar and Meet | (~3) | Deferred epic. Token storage is migrated, blocked on OAuth verification. Sessions degrade to "link pending" until then. |
| — | Auto-recharge, WhatsApp weekly digest, batch channels with moderation, streaks and goals, notification-preference consumption | — | Ideas from the IA tabs, not committed. Notification preferences already have a UI that nothing reads. |
| — | Activation-funnel analytics | — | Not scoped. No analytics infrastructure exists at all, no distinct signup route, no attribution capture. Needs a product decision on build versus buy and on what "activation" means before any engineering. |

**AI stays deferred by founder decision (2026-08-02).** When it resumes, it ships through the two honest surfaces REDESIGN §15 defines, the Today attention queue and the palette, never a bolted-on chatbot. Sequence: deterministic rules first (already shipped as the queue), then the morning brief, then reply drafting, then anything predictive. Do not fake fee-risk scoring before six months of payment history exists.

---

## 4. Ranked backlog

Score = Impact × Confidence ÷ Effort, effort floored at 0.5 ed. Highest score first.

| ID | Item | Rel | Impact | Conf | ed | Score |
|---|---|---|---|---|---|---|
| ~~B-02~~ | ~~Fix per-user rate limiting~~ | R1 | 4 | 1.0 | 1 | **Done 2026-08-06** |
| ~~B-20~~ | ~~Rewrite README~~ | R1 | 2 | 1.0 | 0.5 | **Done 2026-08-06** |
| B-03 | Wallet-ledger reconciliation | R1 | 5 | 0.9 | 2 | 2.25 |
| B-10 | Staging environment | R1 | 4 | 1.0 | 2 | 2.00 |
| ~~B-01~~ | ~~Attendance reversal~~ | R1 | 5 | 1.0 | 3 | **Done 2026-08-06** |
| B-09 | Bulk import | R1 | 5 | 0.9 | 3 | 1.50 |
| B-05 | Self-serve parent top-up | R1 | 5 | 0.9 | 4 | 1.13 |
| B-04 | Credit expiry | R1 | 4 | 0.8 | 3 | 1.07 |
| B-11 | DPDP consent + erasure | R1 | 4 | 0.8 | 4 | 0.80 |
| B-12 | Monthly progress PDF | R2 | 3 | 0.8 | 3 | 0.80 |
| B-17 | WhatsApp comms router | R4 | 5 | 0.7 | 5 | 0.70 |
| B-08 | Tutor payouts | R2 | 5 | 0.8 | 6 | 0.67 |
| B-19 | Referral loop | R4 | 3 | 0.6 | 3 | 0.60 |
| B-06 | Person-centric identity | R2 | 5 | 0.9 | 8 | 0.56 |
| B-13 | Substitute and leave | R2 | 3 | 0.7 | 4 | 0.53 |
| B-18 | Leading indicators | R4 | 3 | 0.7 | 4 | 0.53 |
| B-14 | Public profiles + verification | R3 | 5 | 0.7 | 8 | 0.44 |
| B-15 | Search, enquiry, trial | R3 | 5 | 0.6 | 12 | 0.25 |
| B-16 | Escrow, take rate, reviews | R3 | 4 | 0.6 | 10 | 0.24 |
| B-07 | Org switcher + cross-org conflicts | R2 | 4 | 0.9 | 5 | 0.72 |

**Total: 90.5 ed at plan-time** (R1 22.5, R2 26, R3 30, R4 12); **86 ed remaining** after B-02, B-20 (1.5 ed) and B-01 (3 ed) shipped as of 2026-08-06. At one engineer that is roughly 18 calendar weeks of pure build; budget 24 to 28 with review, migrations and the browser walkthroughs this stack demonstrably needs.

Note the score ranking and the release ranking disagree on purpose. B-06 scores 0.56 but gates all of R3, and B-14/B-15/B-16 score low only because they are large. Score breaks ties inside a release; it does not reorder releases.

---

## 5. Decisions only the founder can make

Two have been answered (2026-08-06); the rest still gate the work in their Blocks column.

| ID | Decision | Status | Blocks |
|---|---|---|---|
| D-08 | Cancellation and no-show policy | **Decided 2026-08-06 — per-org configurable, not fixed.** Three settings per org: `cancellation_free_hours` (default 24), `cancellation_late_fee_percent` (default 50, applies inside the free window), `no_show_forfeit_percent` (default 100). All three are founder-set defaults any org can override, including no-show — narrower than the original recommendation, which would have fixed no-show at a flat 100% platform-wide. B-01's design must read these three fields per org rather than hardcoding the 24h/50%/100% split. | **B-01**, done 2026-08-06 |
| D-07 | Credit expiry period | Open. Recommendation: per-org configurable within a platform cap | **B-04** |
| D-05 | Can a student transact without a parent? | Open. Recommendation: age threshold with parent approval below it | Student booking, consent, R2 approval routing |
| D-06 | Adult-minor 1:1 messaging policy | Open. Recommendation: parent-visible by default | Inbox today, marketplace trust in R3 |
| D-01 | Independent tutor: own org or org-less? | **Decided 2026-08-06 — single-member org, no schema fork.** Every tutor has an `organization_id`; an independent tutor is an org of one, no parallel org-less path. This decides only *how* an independent tutor's own membership looks — it does not by itself let one person hold multiple org memberships. That capability is B-06 (person-centric identity, R2, 8 ed) plus B-07 (org switcher, 5 ed); D-01 just makes that later migration land as "one shape, N memberships" instead of forking into an org and an org-less code path. | **B-06 and all of R3**, now unblocked |
| D-02 | Who is the customer in a marketplace booking? | Open. Decides who holds the wallet, who is invoiced, who can refund, who owns the student record when a tutor leaves a centre | Escrow, take rate, disputes |
| D-03 | Marketplace pricing model | Open. Recommendation: subscription for orgs, take rate for individuals | B-16, GTM |
| D-04 | Drop the legacy rupee columns? | Open. Recommendation: migrate to paise-native after staging exists | Tech Debt #3 |

---

## 6. Permission model

Spec v2's Roles and Permissions tab is now the canonical RBAC spec, replacing the blueprint's §9.3 matrix (which was written for Firestore rules). Seven roles: owner, admin, tutor, frontdesk, accountant, parent, student, plus platform admin. Tutors split into in-org and independent, which is the distinction R2 makes real.

Enforcement lives in three places and must stay consistent across all of them: RLS policies (the constitution, 81 tests), `requireRole` and the `CAN_MARK`/`CAN_MONEY` capability sets in the route layer (195 contract tests), and the client's own gating (untested, and the source of a real bug already fixed once).

**Rows in that matrix that nothing enforces yet, because the capability does not exist:** attendance reversal (B-01), own-earnings and payout visibility (B-08), publish public profile, search and browse tutors, book a trial, write a review (all R3), and switch organisations (R2). Every one of them lands with RLS tests in the same PR as the feature.

---

## 7. Cross-cutting engineering rules

These are not negotiable and they carry over unchanged from HANDOFF §5, §6 and §8.

**Security invariants.** Roles only via `/api/v1/members`. Money only via `/api/v1/billing`, idempotency-keyed, each writing an `audit_events` row. Attendance is one real transaction covering the record, the wallet debit and the invoice accrual, and B-01's reversal must be the same. Money is integer paise. Server-only tables have no policy at all, which is default-deny. Never fabricate meeting links, invoice numbers or payment confirmations client-side. Every webhook is HMAC-verified before its body is trusted, and the raw-body mount sits before JSON parsing and rate limiting, so do not reorder it. `class_sessions` has three id spaces and any code path creating one must populate all three via `resolveUserIds()`.

**Testing.** Four layers, all local, no Docker or Java: unit (`npm test`), RLS (`npm run test:rls`), route contracts (`npm run test:contract`), load (k6). New money or queue logic lands with unit tests in the same PR. Any migration or privileged-route change runs the RLS suite; for an uncertain policy change, deliberately re-break it and confirm the expected test fails.

**Two known test gaps, both material to this plan.** Playwright E2E for the five golden journeys does not exist, and it is the only layer that catches the "never ran in a browser" bug class that has already produced four real bugs in Schedule alone. Axe ran once on 2026-07-25 and is not automated. R1's reversal flow and R3's booking flow are both exactly the kind of interactive, multi-step, money-touching work that no current gate can see. **Budget a real browser walkthrough for every one of them, and consider standing up Playwright during R1 now that staging (B-10) makes it affordable.**

**The traps.** Realtime subscriptions need a `supabase_realtime` publication migration or they are a silent no-op. A green local RLS suite does not mean the hosted DB is migrated. `/api/health` returning 200 proves nothing about the database. Vercel only registers functions it can see in a git scan, so `api/index.js` stays committed. Absolute client routes must include the `/app` prefix. CI validating a build artifact nobody deploys is worse than not validating one.

---

## 8. Go-to-market checklist

Per the founder's 2026-07-10 deferral, still in force, none of this is engineering work and none of it blocks a build stage. Every seam is already built and degrading cleanly. Execute this in parallel with R1, because several items have lead times measured in weeks.

**Start now, long lead times:** WhatsApp Business API template approval, SMS DLT registration, Razorpay live KYC, Google OAuth consent-screen verification. These gate B-17, B-05's live path, and the Calendar epic respectively.

**Payments:** per-org key connection and webhook secret, register `payment_link.paid` and `payment.captured`, one real rupee reconciled, hourly reconcile cron, rehearse a refund, CA review of the GST invoice format. Platform-level billing needs `PLATFORM_RAZORPAY_KEY_ID`, `PLATFORM_RAZORPAY_PLAN_IDS` and `PLATFORM_RAZORPAY_WEBHOOK_SECRET`, at which point checkout activates with no code change.

**Auth:** SMS provider for phone OTP, which the parent portal hard-depends on. Enable leaked-password protection.

**Infrastructure:** staging (B-10, now a plan item rather than a checklist line), Sentry DSNs both sides, uptime probe on `/api/health` plus 5xx alerting, automated offsite backups including storage-bucket sync.

**Legal:** privacy policy, ToS, the DPDP parental-consent document the portal's `consentVersion` already references, refund policy, documented 8-year financial-data retention. Add the minor-safety policy from D-06 before R3.

**Launch readiness:** demo org with a wipe, onboarding tested with a stranger, staffed support channel, written release smoke script, rollback procedure (Vercel covers the app; there is no rehearsed procedure for a bad migration, and R1/R2 both ship migrations).

**Success criteria for launch, carried from the blueprint:** 25 paying orgs, week-4 retention above 80% of activated orgs, and over ₹10L monthly fee volume collected through the platform. That last number is the one that proves the wedge.

---

## 9. Conflicts found while merging, and how they were resolved

1. **DEV_PLAN's "only the pentest remains" versus spec v2's three structural gaps.** Spec v2 wins. DEV_PLAN was measuring completeness against its own Stage 0-to-4 plan, which never contained reversal, expiry, reconciliation, identity or the marketplace. The stage numbering is retired in favour of R1 to R4.
2. **README versus reality.** README described Firestore, Firebase Auth, custom claims, `npm run test:rules` and Cloud Run. None of that exists; the stack is Supabase, Postgres RLS, no custom claims, `npm run test:rls`, Vercel. Fixed by B-20 (2026-08-06) — README.md is now accurate.
3. **The blueprint's architecture and security sections.** Both are Firestore-era. Its C1 to C5 vulnerabilities were real then and are fixed now under a different architecture. Keep the strategy sections (§1 wedge, §3 role gaps, §4 market position, §14 launch gates); discard §2, §7, §8, §9, §10.
4. **DEV_PLAN §2.1's k6 caveat.** It attributed the throughput cap to "the per-user rate limiter (120 req/min)." The limiter is not per-user in effect, for the reason B-02 documents. The load-test conclusion (p95 well under target, no duplicate invoice) still stands; only the explanation of the cap was wrong.
5. **REDESIGN §17's scalability note** claims a Firestore-plus-SQLite dual store stays backend-internal. That store is gone. Its actual conclusion (optimistic UI everywhere) survives on its own merits.
6. **Home.tsx's marketing copy.** Still written as a tutor marketplace ("Search", "Find 1-on-1 Tutors", "1,200+ Tutors", "Browse Group Batches"), which DEV_PLAN flagged as a mismatch with a B2B fee-collection product. Spec v2 changes the verdict: that copy is no longer wrong, it is early. Leave it until R3 and then make it true, rather than rewriting it to B2B now and rewriting it back later.
7. **`org_stats_daily` has no consumer.** DEV_PLAN deliberately declined to wire Money's insights tab to it, correctly, since that would trade live intraday numbers for a stale daily aggregate. B-18 is the first real consumer. Until then the table accumulates rows nobody reads, which is fine and intended.

---

## 10. What to do next week

1. ~~Ship **B-02** and **B-20**.~~ **Done 2026-08-06**, both pure wins, no founder decision needed.
2. ~~Answer **D-08** and **D-01**.~~ **Done 2026-08-06** (§5) — both decided, both now unblock real work.
3. Stand up **B-10 staging**. It is a spend decision, and it unblocks the rest of R1 being verifiable at all.
4. Start the long-lead **GTM procurement** in parallel: WhatsApp templates, DLT, Razorpay KYC, Google OAuth verification.
5. Then **B-01**, with a real browser walkthrough and RLS tests in the same PR. D-08's per-org settings need a place to live — either a new migration adding the three columns to `organizations`, or (if B-10 staging isn't up yet) rehearsed carefully against production, same caution as every other R1 migration.
