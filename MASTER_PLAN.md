# ClassStackr Master Plan

**Rewritten 2026-09-12** against the working tree at commit `86ca0e4` plus the uncommitted B-19 referral work. Every claim below was re-derived by reading the code, running the gates, and tracing UI → API → business logic → database → authorization. Where the previous plan and the code disagreed, the code won and the plan changed. What this replaces, and why, is recorded in §13.

**Companion docs.** [HANDOFF.md](HANDOFF.md) owns current state, architecture, the runbook, security invariants and the trap list. [EXECUTION_PLAN.md](EXECUTION_PLAN.md) is the step-by-step execution order derived from this document; start there for day-to-day work. [REDESIGN.md](REDESIGN.md) owns product experience, IA and visual language. Archives under `docs/` are frozen history, not live plans.

**Section anchors moved in this rewrite.** 31 live source comments cite the old numbering (`MASTER_PLAN.md §3` and so on). They were not edited, because this was a planning pass and not a code change. Translate them with this table:

| Old anchor | Cited by | Now |
|---|---|---|
| §3, the four releases | 12 sites | **§7**, release strategy. R1 and R2 are history; R3 and R4 are new; the old R3/R4 became §7's R6 and are scattered through §8. |
| §4, ranked backlog | 7 sites | **§8**, ranked backlog. B-xx ids are unchanged; C-xx ids are new. |
| §5, founder decisions | 9 sites | **§13**, founder decisions. D-01 through D-08 keep their ids and meaning; D-09 through D-13 are new and open. |
| §8, go-to-market checklist | 3 sites | **§12**, GTM implications, and §10's release gates. |
| §11.2, Tech Debt #N | source + this file | **§6.7** and **§9**. The `#N` numbering stays frozen; #3 is the only open item. |

---

## 1. Product thesis

> **ClassStackr turns a tuition class into collected money.** A tutor marks attendance; the platform raises the invoice, delivers it to the parent on WhatsApp, takes the payment, reconciles it, and keeps a ledger the centre can trust.

One sentence, and it is a promise about money moving, not about feature coverage. Every item in this plan either makes that loop work, makes it trustworthy, or gets a customer onto it.

The previous plan's one-line definition ("a platform connecting parents, students and tutors, where a tutor may be independent or part of an organisation") described an ambition, not a product. It is retired as the headline. The multi-org identity work it justified is built and valuable; the marketplace it pointed at was deferred behind a hard commercial gate (§7, R6) — **D-09 reversed this 2026-09-14 (§13): the gate is lifted, and §7/§8's marketplace sections were re-scoped the same day; EXECUTION_PLAN.md Steps 37-39 carry the concrete work.**

## 2. Target customers

**Primary ICP.** Tuition centres with 1 to 8 tutors and 30 to 300 students in Indian metros and tier-2 cities, currently running on WhatsApp groups, paper attendance registers and GPay screenshots. The buyer is the owner; the daily user is the owner plus one or two tutors; the payer is the parent.

**Secondary ICP.** Solo premium tutors with 15 to 40 students. D-01 already makes these an "org of one" in the same schema, so they need no separate product, only a cheaper plan and a shorter onboarding.

**Explicitly not the customer yet.** Schools, franchises, chains, coaching institutes above ~500 students, non-India markets, and parents searching for a tutor they have no relationship with.

## 3. The problem

A centre owner's real problem is not scheduling. It is that **money leaks between the class and the bank account**: attendance lives on paper, fees are chased by hand over WhatsApp, part-payments are remembered rather than recorded, and nobody can answer "who owes us what" without an hour of reconstruction. Second-order: the owner cannot see which students are drifting away until they have already left.

Competitors (Teachmint, Classplus, Proctur, MyClassCampus) sell feature breadth into this. Nobody in the segment is loved for product quality, and none of them close the attendance-to-cash loop without human copy-paste.

## 4. The strategic wedge

Attendance automatically becomes an invoice; the invoice automatically reaches the parent where the parent already is; the money automatically reconciles into a ledger that balances.

This is defensible for four reasons, in order of strength:
1. **The ledger is the moat.** Once six months of invoices, payments, wallet lots and reversals live here, switching cost is real. That asset is built and correct today.
2. **It is measurable in rupees**, which makes it an easy sale and an easy renewal.
3. **Every payment link is marketing** to a parent who is a prospective customer's customer.
4. **Correctness as a feature.** Server-authoritative paise, row locks, idempotency keys, reversal, reconciliation and an audit trail are unusual in this segment and are exactly what an owner handling other people's money needs.

**The honest problem with the wedge today: the middle third of it does not exist.** There is no outbound message channel in the codebase at all. See §6.

## 5. Current product state

Verified by reading the code and re-running every gate on 2026-09-12 (typecheck clean, **249 unit**, **106 RLS**, **353 contract**, all passing locally in this session). The documentation in HANDOFF.md is unusually honest and matched reality everywhere I checked it.

**Genuinely shipped, tested, and exercised against live production:**

- **The money core.** Attendance marking is one real transaction covering the attendance record, the wallet debit and the invoice accrual, under `FOR UPDATE` row locks with idempotency keys through a direct `pg` connection. Reversal credits back correctly per the org's cancellation policy, voids or partially refunds, and writes linked ledger and audit rows. Refunds, manual payments, invoice void/finalize, GST-snapshot invoice PDFs, FIFO credit expiry, and a wallet-versus-ledger reconciliation job all exist and are tested. Money is integer paise end to end.
- **Scheduling.** Templates, 8-week materialization with advisory locks, conflict-checked creation and drag-reschedule, recurring-edit scopes, availability gaps, cancellation with policy, substitute reassignment and tutor leave.
- **People and students.** Bulk CSV/XLSX import with column sniffing, a real dedup-resolution wizard, student story, notes, documents with private Storage and signed URLs, per-student DPDP erasure with an anonymized financial-retention stub.
- **Identity.** One login, many org memberships, with an org switcher and a genuine cross-org tutor double-booking bug found and fixed. This was R2's structural bet and it landed.
- **Tutor economics.** Compensation rates, an earnings ledger accruing off attendance, payout runs with TDS, statement PDFs, and a tutor-facing earnings view. Live-verified end to end.
- **Platform surfaces.** Subscription plans with a DB-enforced student cap, super-admin console with impersonation, org export (JSON and XLSX), org offboarding, an append-only audit log, DPDP consent records.
- **Engineering discipline.** Four local test layers with no Docker, Java or live DB; seven CI gates including a rebuild-and-verify of the actual deployed Vercel bundle; RLS as the authorization constitution.

**The product does this well:** it is fast, calm, coherent, mobile-workable, and the money is correct. That last one is rarer than it sounds and it is the thing worth protecting.

## 6. Strategic gaps

Ranked by how badly each one blocks a paying customer. These are the findings that changed the plan.

### 6.1 There is no way to reach a parent (blocks the wedge)

`grep` across the entire repository for any mail, SMS or WhatsApp transport returns **nothing**. No nodemailer, no provider SDK, no SMTP, no template service. The only `notifications` writer in the codebase is the credit-expiry cron, and `notifications` is an in-app table read by the Inbox.

Concretely, today:
- An invoice is raised and the parent is never told. They find out if and only if they open the app.
- The payment-link "share" action opens a `wa.me` URL for a human to send by hand.
- Bulk reminders produce a clipboard string: *"Copied N reminder messages, paste into WhatsApp threads."*
- Every invite (parent, student, staff) is a link someone copies and pastes.

The product as shipped is an excellent *record* of the loop and a manual *executor* of it. B-17 (WhatsApp router) sat last in the plan, in R4, behind a marketplace. That ordering was wrong. It is now the first thing after correctness.

### 6.2 ClassStackr cannot be paid (blocks revenue)

`POST /api/v1/subscription/checkout` degrades to *"Upgrading isn't self-serve yet. Email us and we'll switch your plan by hand"* whenever `PLATFORM_RAZORPAY_KEY_ID` / `PLATFORM_RAZORPAY_PLAN_IDS` are unset. They are unset, and they are **not even listed in `.env.example`**. The code path is complete and needs no rewrite; the account, the plan objects and the env wiring do not exist.

Separately: per-org collection is bring-your-own-Razorpay (keys encrypted per org in `payment_gateways`). That is the right architecture, since fees land in the centre's own bank and ClassStackr never becomes a payment aggregator. It also means (a) every customer must complete Razorpay KYC themselves and paste keys into Settings, which is real onboarding friction to design around, and (b) **the "0.2 to 0.5% transaction margin as a second revenue line" in the old §12 is not achievable under this architecture and is contradicted by D-03.** It is deleted, not deferred.

No Razorpay flow has ever run for real, in either direction.

### 6.3 Recurring classes are materialized in the server's timezone (correctness, high severity)

`server/routes/scheduling.ts`'s `materializeTemplate()` reconstructs each session's wall-clock time with `new Date()` and `setHours(template.start_hour, ...)`, and `localDateKey()` formats dates with `getFullYear/getMonth/getDate`. Both read the **server process's local timezone**. The client writes `start_hour` from the **browser's** `getHours()`. There is no timezone column anywhere in the 51-table schema and no `TZ` is set in `vercel.json`, the Dockerfile or any env file.

Vercel's Node functions run in UTC. A centre creating a 6:30pm class in IST therefore stores 18:30 UTC, which is midnight IST. One-off sessions are unaffected (the client sends absolute timestamps); only materialized recurring sessions are, which is most sessions in a real centre.

*Status: confirmed by code reading, not yet confirmed against live production.* It is cheap to confirm and it must be confirmed before any pilot, because it silently corrupts the schedule feature that everything else hangs off.

### 6.4 No scheduler is wired, so four production jobs never run

`vercel.json` has no `crons` block; `.github/workflows/ci.yml` has no `schedule` trigger; there is no other scheduler config in the repository. `/api/cron/materialize-sessions`, `/reporting-daily`, `/reconcile-wallets` and `/expire-credits` are built, tested, secret-gated and **never fire in production**. Recurring sessions only appear when a human clicks Materialize in Schedule; reconciliation never checks; configured credit expiry never expires; `org_stats_daily` never fills.

This is roughly five lines of config and it has been open since the jobs were written.

### 6.5 Decided minor-safety policy is not implemented, and the exposure is live

D-06 was decided: every tutor-student message is visible to that student's parent, unconditionally. The code does not do this. `conversations.participant_ids` is a two-element array for a DM, and `conversations_select` is participant-scoped, so a parent is structurally unable to see a tutor-student thread. `useMessageableContacts()` lets staff start a DM with any student in the org today, in production. This is not an R3 marketplace concern; it is a present-tense adult-to-minor messaging surface with no guardian visibility.

### 6.6 Nobody can tell whether the product is working

There is no product analytics of any kind. `@vercel/analytics` gives anonymous pageviews and nothing else: no event instrumentation, no signup attribution, no activation funnel, no retention cohort, no feature usage. Sentry is wired on both sides but both DSNs are deliberately unset. An owner could stop using ClassStackr for six weeks and no one would know.

### 6.7 Smaller but real

| Gap | Evidence |
|---|---|
| **Homework can be assigned but never marked.** `StudentStory.tsx` inserts an `assessments` row with `status: "pending"`; no code anywhere writes a score, a grade, or a status transition. The progress-report PDF's academic section is therefore empty for every student who has ever existed. | `src/pages/StudentStory.tsx:212`, `server/utils/progressReportPdf.ts:145` |
| **Parents cannot see attendance or payment history**, despite RLS already allowing both. `attendance_records_select` and (since `20260709020900_rls_fixes.sql`) `payments_select` both permit `is_parent_of(student_id)`. The parent portal renders neither: it has Overview / Invoices / Wallet / Settings and no attendance tab, and its payments loader carries a **stale comment** claiming "payments_select RLS is staff-only today", which has been false since that migration. This is a UI-only gap sitting on top of working authorization. | `src/pages/ParentPortal.tsx:206`, `supabase/migrations/20260709020900_rls_fixes.sql:39` |
| **Phone OTP is the default login tab and no SMS provider is configured.** A parent following an invite lands on a login screen whose default method cannot work. | `src/pages/Login.tsx:15` |
| **No Playwright, no browser-level regression gate.** Every bug class this codebase has actually shipped (role-versus-organizationRole, wrong column name, invisible hover state, disabled button) is exactly the class only a browser catches. Four such bugs have been found and fixed by hand-walking, which does not scale and does not survive a session ending. | `tests/` has no e2e layer |
| **Backups are a manual shell script.** `scripts/backup.sh` exists and was rehearsed once. Nothing runs it. No offsite sync, no storage-bucket backup, no rehearsed restore-from-bad-migration procedure, and R3+ ships migrations. | `scripts/backup.sh` |
| **Tech Debt #3 (dual money columns).** D-04 decided: drop `invoices.total_amount`/`subtotal`, make `wallets.balance_currency` paise-native. Conversion is already centralized in `shared/money.ts`. Unblocked, not done. | `shared/money.ts` |
| **17 dependency advisories** needing breaking major upgrades, `npm audit` deliberately non-blocking in CI. Fine for now, a decision to schedule. | `.github/workflows/ci.yml` |

## 7. Release strategy

Four releases. R1 (money is correct) and R2 (one person, many orgs) are **complete and merged**; their detail is in git history and `docs/`. What follows replaces the old R3 and R4 entirely.

The organizing judgement: **the product is feature-rich and customer-poor.** It has never had a paying user, cannot take money, and cannot send a message. The next two releases buy the right to have a customer. The two after that buy retention and then, only on a commercial trigger, expansion.

---

### R3: Close the loop

**Thesis.** Make the wedge literally true. Attendance to invoice already works; make the invoice reach the parent and make ClassStackr chargeable, and fix the correctness defects that would embarrass a pilot.

**Customer outcome.** A centre owner marks Thursday's attendance, and without touching WhatsApp themselves, every parent who owes money receives a payment link, pays it, and the owner watches Outstanding fall to zero. The owner pays ClassStackr by card.

**Scope**
| ID | Item | ed |
|---|---|---|
| C-01 | Timezone model: an org timezone, TZ-correct materialization and date-keying, a backfill for existing recurring sessions | 3 |
| C-02 | Wire a scheduler (Vercel Cron) to all four cron routes, with failure alerting | 1 |
| B-17 | Outbound comms router: provider abstraction, templates, delivery + read state, retry and dead-letter; WhatsApp first, SMS fallback. Consumers: invoice raised, fee due, payment received, absence, session reminder, and every invite link | 8 |
| C-03 | Platform billing switch-on: platform Razorpay account, plan objects, env documented in `.env.example`, webhook, real upgrade and downgrade walked end to end | 2 |
| C-04 | Razorpay live rehearsal on one real org: connect keys, one real rupee collected, webhook reconciled, one refund rehearsed, CA review of the GST invoice format | 2 |

**Non-goals.** Any marketplace surface. Escrow. Reviews. Email as a channel (WhatsApp is where Indian parents are; email is a later fallback, not a first channel). Google Calendar. AI. Shipping B-19 (see §8).

**Dependencies.** B-17 and C-04 are gated on external procurement with multi-week lead times: WhatsApp Business API onboarding and template approval, SMS DLT registration, Razorpay live KYC (both platform and pilot org). **Start all four on day one of R3, in parallel with C-01 and C-02, which need nothing external.**

**Engineering estimate.** 16 ed, plus external wait time that will dominate.

**Launch gate.** A real invoice, raised by attendance, arrives on a real parent's real phone without a human sending it, is paid with real money, and reconciles automatically. A real org upgrades its own plan and is charged. No session in the database sits at the wrong wall-clock time.

**Success metrics.** Message delivery rate above 95%. Median time from invoice raised to parent notified under 60 seconds. At least one rupee collected end to end through each of the two money-in paths.

---

### R4: Earn the pilot

**Thesis.** Nothing here is a feature. This is the set of things that must be true before a stranger's money and a minor's data are on this system.

**Customer outcome.** The owner trusts it, and we can see whether they are actually using it.

**Scope**
| ID | Item | ed |
|---|---|---|
| C-05 | D-06: parent-visible tutor-student threads. Guardian is a participant, or a guardian-read policy, plus a visible in-thread disclosure to both sides | 3 |
| C-06 | Playwright on the five golden journeys, running in CI against staging | 5 |
| C-07 | Activation analytics: a defined activation event, instrumented signup-to-first-collected-rupee funnel, weekly per-org usage rollup. Build-versus-buy is a founder call (§10) | 4 |
| C-08 | Operational floor: Sentry DSNs live, uptime probe and 5xx alerting, automated offsite backups including the storage bucket, one rehearsed restore, one rehearsed bad-migration rollback | 3 |
| C-09 | Onboarding friction pass: fix the phone-OTP default-tab dead end, and make Razorpay key connection a guided step rather than a Settings field | 2 |
| TD-3 | D-04's paise-native migration, rehearsed on staging first | 1 |
| — | External pentest (procurement, not engineering) and Supabase leaked-password protection | 0 |

**Non-goals.** New customer-facing capability of any kind.

**Dependencies.** C-06 needs staging (done). C-08 needs Sentry and an uptime vendor. The pentest needs a vendor and lead time; book it during R3.

**Engineering estimate.** 18 ed.

**Launch gate.** Every golden journey passes in CI against staging. A tutor cannot message a student without that student's guardian seeing it. A restore from backup has actually been performed. The activation funnel reports a real number for at least one real org. The DPDP consent document exists, is published, and `CONSENT_VERSION` no longer ends in `.draft`.

**Success metrics.** 3 to 5 paying pilot centres onboarded. Week-4 retention above 80% of activated orgs. Zero P1 money incidents.

---

### R5: Make them stay

**Thesis.** Retention in this category is a parent-side phenomenon. A parent who sees attendance, progress and money in one place stops asking the owner for them, and the owner stops being able to leave.

**Customer outcome.** The parent opens ClassStackr instead of messaging the owner. The owner sees a student drifting before the parent cancels.

**Scope**
| ID | Item | ed |
|---|---|---|
| C-10 | Parent visibility: attendance history and payment history in the parent portal. Both already pass RLS; this is UI plus removing a stale comment | 2 |
| C-11 | The gradebook marking loop: a score/status write path for `assessments`, staff and student side, feeding the existing progress-report PDF | 4 |
| C-12 | Cross-org family view: one home screen for a parent with children at two centres. The children query is already cross-org; the money and session loaders are not | 4 |
| B-18 | Leading-indicator dashboard: attendance drop-off, credit burn-down, tutor utilisation, at-risk students. First real consumer of `org_stats_daily` | 4 |
| C-13 | Guardian records move from student-owned free-text to parent-owned | 3 |

**Non-goals.** Marketplace. AI scoring of fee risk, which needs six months of payment history that will not exist yet.

**Dependencies.** B-18 requires C-02, since `org_stats_daily` is empty until the cron runs. C-11 unblocks the progress report's academic section, which is currently empty for every student.

**Engineering estimate.** 17 ed.

**Launch gate.** A parent can answer "did my child attend, how are they doing, what do I owe" without messaging anyone. An owner is shown a student at risk before that student leaves.

**Success metrics.** Parent portal weekly-active above 40% of linked parents. Progress reports that contain actual academic content.

---

### R6: The marketplace — re-scoped 2026-09-14, steps written

**Thesis.** Turn a management tool into a two-sided platform. Originally framed as the right long-term expansion but the wrong immediate focus, behind a commercial gate; D-09 (§13) reversed that — the founder has made it an immediate focus, and this section reflects the completed re-scoping pass (EXECUTION_PLAN.md Steps 37-39).

**Entry gate — lifted (D-09, 2026-09-14).** The original gate (10 or more paying orgs, week-4 retention above 80%, ₹10L or more per month collected) is preserved here for the record, not because it still governs. The founder accepted the risk of building supply and demand simultaneously with no distribution and no validated demand.

**Scope and sequencing, grounded in the real schema, not guessed:**
- **B-14 (Step 37), public tutor profiles plus verification labeling, 8 ed.** No dependency on Steps 27-36 — can start any time. Reuses the existing per-`(tutor, organization)` `is_verified` column on `tutor_profiles` (RLS-gated to owner/admin since `20260710140000_tutor_verify_fix.sql`); adds a public-safe read path, since today's client reads are RLS'd to org members only, and an honest "not yet verified" label for everyone else. Replaces `Home.tsx`'s entirely fabricated marketplace copy (stock photos, invented captions, hardcoded "1,200+ Tutors", every CTA linking to `/login`) with a real listing — this also closes §8's previously-deferred "marketing-site copy" item as a side effect, not a separate task.
- **B-15 (Step 38), discovery/search plus structured enquiry with an SLA clock plus trial-to-enrolment handoff, 12 ed.** Depends on Step 37. The enquiry does **not** need a new messaging system or B-17's comms router: it lands as a `leads` row (extending the existing staff-CRM `leads` table with `source='marketplace'` and a `tutor_id`) through one new public-write endpoint — the first anonymous-write path into this schema, so it needs its own rate limiting and abuse checks rather than RLS exposure of the table. The SLA clock reuses this codebase's two existing expiry patterns (a cron sweep like `creditExpiry.ts`, or an `expires_at` column like `parent_invites`) and alerts through the existing in-app `notifications`/Inbox surface; WhatsApp/SMS delivery is a Step 27 follow-on enhancement, not a prerequisite. The trial-to-enrolment handoff is deliberately **not new infrastructure**: it chains the existing lead "convert to student" action (`People.tsx`'s Leads lens), the existing parent/student invite flow, and the existing booking-request/Add-Class flow. Recommended, not required, to land after Step 30 (C-05, D-06 guardian-visible threads), since marketplace-sourced enrolments are a new, less-vetted intake channel.
- **B-16 (Step 39), escrow plus reviews plus moderation/disputes, 10 ed.** Depends on Step 38. Escrow is built as a variant of the existing `tutor_earnings_ledger` → `tutor_payouts` (`issued`→`paid`) hold-then-release machinery from Step 21 (B-08, already shipped) rather than a new subsystem, reusing `billing.ts`'s `FOR UPDATE`/idempotency-key conventions. Reviews (no such table exists today) are gated on verified attendance — a review requires a real completed, attended session.

**D-02 is satisfied structurally, not by a new mechanism.** "The centre keeps the customer relationship" falls out of the existing `organization_id` scoping once enquiries are modeled as leads: a centre (a more-than-one-member org) makes the enquiry staff-visible org-wide, not the individual tutor's private contact; an independent tutor (a one-member org, per D-01) is the org's own staff, so it lands with them directly. Discovery and the "reveal contact" action are parent-initiated by construction — a visitor searches and requests, nothing pushes a tutor's contact at anyone.

**Pricing.** D-03 already ruled out a take rate in favour of tiered subscriptions for the management product. B-16's original "take rate tapering" mechanism is dead; escrow survives on its own merits as a trust primitive, not a revenue source. The founder's floated pay-per-contact fee (about ₹10) ships **unbuilt in v1** — the reveal action is free, with the data shape (a `contact_reveal_events` row) built so gating can be added later without a rework, mirroring how D-03 kept placeholder pricing deliberately ungated.

**Minor safety.** Discovery and browsing expose no new adult-minor contact vector — it is public profile browsing, and the "reveal contact" step is parent-initiated and happens off-platform, the same as a referral does today. Real in-platform tutor-student contact only starts after enrolment, where the existing C-05/D-06 control applies — no separate marketplace-specific safety mechanism is needed there. What must ship on day one is the honest "unverified" label above; real background-check tiers, if wanted, are a founder call (below), not built by Steps 37-39.

**Still open, needs a founder call, not decided by this pass:** whether background checks are required before "reveal contact" (and if so, vendor and cost); the real pay-per-contact price and whether or when to turn gating on; whether trial bookings need escrow from day one (this plan recommends no — a free trial session avoids holding money at all — but that is a recommendation, not a decision).

---

## 8. Ranked backlog

Score = Impact × Confidence ÷ Effort. Release order beats score; score breaks ties inside a release.

| ID | Item | Rel | Impact | Conf | ed | Score |
|---|---|---|---|---|---|---|
| C-02 | Wire the scheduler | R3 | 4 | 1.0 | 1 | 4.00 |
| C-10 | Parent attendance + payment history | R5 | 3 | 1.0 | 2 | 1.50 |
| C-03 | Platform billing switch-on | R3 | 5 | 0.9 | 2 | 2.25 |
| C-01 | Timezone model | R3 | 5 | 0.9 | 3 | 1.50 |
| C-04 | Razorpay live rehearsal | R3 | 5 | 0.8 | 2 | 2.00 |
| C-09 | Onboarding friction pass | R4 | 3 | 0.9 | 2 | 1.35 |
| C-05 | D-06 parent-visible threads | R4 | 4 | 0.9 | 3 | 1.20 |
| B-17 | Outbound comms router | R3 | 5 | 0.8 | 8 | 0.50 |
| C-07 | Activation analytics | R4 | 4 | 0.8 | 4 | 0.80 |
| C-11 | Gradebook marking loop | R5 | 3 | 0.9 | 4 | 0.68 |
| C-08 | Operational floor | R4 | 4 | 0.9 | 3 | 1.20 |
| C-06 | Playwright golden journeys | R4 | 4 | 0.8 | 5 | 0.64 |
| B-18 | Leading indicators | R5 | 3 | 0.7 | 4 | 0.53 |
| C-12 | Cross-org family view | R5 | 3 | 0.7 | 4 | 0.53 |
| C-13 | Guardian records re-owned | R5 | 2 | 0.8 | 3 | 0.53 |
| TD-3 | Paise-native migration | R4 | 2 | 0.9 | 1 | 1.80 |
| B-14 | Public profiles + verification | R6 | 5 | 0.5 | 8 | 0.31 |
| B-15 | Search, enquiry, trial | R6 | 5 | 0.4 | 12 | 0.17 |
| B-16 | Escrow, reviews, disputes | R6 | 4 | 0.4 | 10 | 0.16 |

**B-14/B-15/B-16 are no longer gated behind R6's commercial threshold (D-09, 2026-09-14).** They have concrete execution steps now — EXECUTION_PLAN.md Steps 37, 38 and 39 — with a sequencing rationale grounded in the actual schema, in §7's R6 section above. The Impact/Confidence/Score columns above were scored for a gated, later R6 and are not re-scored here; treat the step definitions as authoritative over these scores for sequencing.

**Explicitly do not build yet, with the reason:**

- **B-19, the referral loop.** Coded, and moved onto branch `parked/b-19-referral` (commit `1eedd13`) — `main` no longer carries it. Unpushed, and its migration never applied anywhere. It pays out wallet credit, and wallet credit requires a working Razorpay that no org has. It is a growth loop bolted to a product with no users and no channel to refer through. **Do not push `parked/b-19-referral`, do not apply the migration, revisit in R5** (EXECUTION_PLAN.md's "Start here" has the exact handling). Building it before B-17 was the clearest ordering error in the previous plan.
- **Google Calendar and Meet.** Blocked on OAuth verification, and the customer pain it solves is small next to §6.
- **AI of any kind.** The founder's 2026-08-02 deferral stands and is correct. The sequencing when it resumes is unchanged: deterministic rules first (shipped, as the Today attention queue), then a morning brief, then reply drafting, then anything predictive. Do not fake fee-risk scoring before six months of payment history exists.
- **Auto-recharge, streaks and goals, batch channels with moderation, notification-preference consumption.** Idea-stage. The notification-preference UI already exists and nothing reads it; it should read something only once B-17 gives it something to read.
- **The Leads pipeline.** Not retired by a marketplace any more, since the marketplace moved behind a gate. Leave it as-is: it costs nothing and nothing depends on it.
- **Marketing-site copy.** `Home.tsx` still sells a tutor marketplace ("Find 1-on-1 Tutors", "1,200+ Tutors", "Browse Group Batches") with entirely fabricated content — stock photos, invented captions, hardcoded counts, every CTA linking to `/login`. With D-09 lifting the marketplace gate, this is **no longer a launch-prep copy fix — it is Step 37's (B-14) job to replace this with the real listing**, since the product will actually have real tutor profiles to show. Do not fix the copy separately from Step 37; fixing it in isolation before Step 37 ships would just be a different set of unbacked claims.

## 9. Architecture and technical priorities

Only the technical work that materially changes the roadmap. Everything else about the architecture is good and should not be touched.

**Preserve, do not refactor.** The two-data-path design (direct-to-Supabase reads under RLS, Express for every privileged write) is correct and well-enforced. RLS as the authorization constitution with a 106-case test suite is the single best asset in the repository. Server-authoritative paise with `FOR UPDATE` and idempotency keys is correct. The three-layer client pattern is consistent. The CI gate that rebuilds and verifies the actual deployed Vercel bundle exists because a stale `api/index.js` once silently dropped half the routes; keep it.

**Must change, and why it affects the roadmap:**

1. **Timezone becomes a first-class concept** (C-01). An `organizations.timezone` column, materialization that computes in the org's zone, and `localDateKey` that stops depending on `process.env.TZ`. Without this, every scheduling-adjacent feature inherits the defect.
2. **A message-transport abstraction** (B-17), not a WhatsApp client. The provider will change, DLT and template approval constrain what can be said, and delivery state has to be queryable. Design it as a queue with retry and a dead-letter path, with the provider behind an interface, because the alternative is a second rewrite when SMS fallback is added.
3. **A scheduler exists** (C-02). Vercel Cron in `vercel.json` is the lowest-friction option and matches the existing `CRON_SECRET` pattern exactly.
4. **A browser-level gate** (C-06). Four real shipped bugs were caught only by a human clicking. That is the only layer with no automation, and it guards the layers that handle money.
5. **Paise-native** (TD-3). The `#N` tech-debt numbering stays frozen as a citation anchor. Tech Debt #3 is the only open item.

**Structural note, do not regress.** `profiles.organization_id` is not vestigial. `Today.tsx` queries and subscribes to it. It is not authorization-bearing (RLS never trusts it) but it is load-bearing for a live feature.

## 10. Quality, security and operational gates

Carried from HANDOFF §5 and §6, unchanged and non-negotiable: roles only via `/api/v1/members`; money only via `/api/v1/billing`, idempotency-keyed, every mutation writing an audit row; attendance as one real transaction; integer paise; server-only tables with no policy at all; webhooks HMAC-verified before the body is trusted with the raw-body mount ahead of JSON parsing and rate limiting; `class_sessions`'s three id spaces populated via `resolveUserIds()`; any migration or privileged-route change re-runs the RLS suite.

**Per-release gates, additive:**

| Before | Must be true |
|---|---|
| **R3 ships** | All seven CI gates green. Every recurring session in production sits at the correct wall-clock time, verified against live data. All four cron jobs observably fired. One real rupee collected and reconciled. One real message delivered to a real phone. |
| **R4 ships / first paying pilot** | Playwright green in CI against staging. Parent-visible threads enforced at the policy layer, with an RLS test. External pentest complete with findings closed or accepted in writing. Leaked-password protection on. Automated offsite backups running, one restore rehearsed, one bad-migration rollback rehearsed. Sentry live, uptime probe live, 5xx alerting live. Privacy policy, ToS, refund policy, 8-year retention statement and the DPDP parental-consent document all published, with `CONSENT_VERSION` bumped off `.draft`. |
| **R5 ships** | No regression in the R4 set. Progress reports contain real academic data. |
| **R6 starts** | The commercial gate in §7 is met, and a minor-safety policy is published. |

**Testing layers,** all local, no Docker or Java: unit (`npm test`, 249), RLS (`npm run test:rls`, 106), route contracts (`npm run test:contract`, 353), load (k6). Contract tests deliberately skip `cron.ts` (service-token auth), `webhooks.ts` (raw-body HMAC middleware) and `settings.ts`'s Google OAuth endpoints. Axe ran once on 2026-07-25 and is not automated; automate it alongside C-06.

**Load, for reference.** k6 `attendance_burst` against live production, p95 79 to 101ms against a 400ms target, no duplicate invoice at 15 concurrent VUs. Caveat if re-run: the script uses one shared auth token, so it tests one token under concurrent connections, not N distinct tutors.

## 11. Product analytics

Today: nothing. This is a strategic gap, not a nice-to-have, because the next 12 months are a search for product-market fit and the search is currently unobservable.

**The one metric that matters:** rupees collected through the platform per org per month. It is the wedge, the renewal argument and the leading indicator of retention, all at once.

**Activation, defined:** an org that has marked attendance on 10 or more sessions **and** collected at least one rupee through ClassStackr, within 14 days of signup. Everything before that is setup, not usage.

**Instrument, in this order (C-07):**
1. Signup to activation funnel, with drop-off at each onboarding beat.
2. The weekly loop per org: sessions scheduled, attendance marked, invoices raised, messages delivered, rupees collected.
3. Retention cohorts by signup week, measured on the weekly loop rather than on login.
4. Parent-side engagement: portal opens, links clicked, self-serve payments.
5. Feature usage, last, and only to decide what to delete.

## 12. GTM implications for product decisions

Only where they change what gets built.

**Pricing.** D-03 binds: subscription-only, tiered, for both centres and solo tutors. No take rate, no commission. The current catalog (`shared/plans.ts`: free to 15 students, ₹1,499/mo to 60, ₹3,999/mo unlimited) is a placeholder tied to a per-active-student model and nothing else in the codebase hardcodes those numbers. **Revisit before R3's C-03, since switching on billing makes the numbers real.** The old "0.2 to 0.5% transaction margin" second revenue line is deleted: bring-your-own-Razorpay means ClassStackr never touches the money, and becoming a payment aggregator is a licensing decision, not a pricing one.

**Onboarding friction is a product constraint.** BYO-Razorpay means a customer cannot collect a rupee until they have completed Razorpay KYC and pasted two keys and a webhook secret into Settings. That is the single largest gap between "signed up" and "activated", so it gets designed as a guided step (C-09), not left as a Settings field.

**Long-lead procurement to start on day one of R3,** because none of it is engineering and all of it gates engineering: WhatsApp Business API onboarding and template approval, SMS DLT registration, Razorpay live KYC for the platform account and for the pilot org, Google OAuth consent-screen verification (deferred but slow), and the external pentest vendor.

**Legal, still open and now gating R4:** privacy policy, ToS, refund policy, a documented 8-year financial-retention statement, the D-06 minor-safety policy, and the DPDP parental-consent document that `CONSENT_VERSION` ("dpdp-2026-09.draft") already points at from every consent row written since 2026-09-05.

**Launch success criteria,** unchanged and still the right ones: 25 paying orgs, week-4 retention above 80% of activated orgs, ₹10L+ monthly fee volume collected through the platform. That last number is the one that proves the wedge, and it is also R6's entry gate.

**Market position.** Competitors are feature-broad and product-poor: Teachmint and Classplus (app-first, sales-heavy), Proctur and MyClassCampus (legacy ERP feel), TutorBird, Teachworks and TutorCruncher (Western, weak on India payments and WhatsApp). Do not compete on feature count. Compete on the loop closing and on speed and calm.

## 13. Founder decisions

**Still binding, decided, no action needed.** D-01 (independent tutor is a single-member org), D-02 (the centre keeps the customer relationship, and discovery must be parent-initiated, never pushed), D-04 (drop the legacy rupee columns), D-05 (per-student parent-controlled payment permissions, no age threshold), D-06 (tutor-student messages always parent-visible), D-07 (credit expiry per-org, from each top-up date, no platform default or bounds), D-08 (cancellation and no-show percentages per-org configurable). Full rationale for each is in git history at commit `86ca0e4`'s version of this file, §5.

**D-03 decided 2026-09-14 (narrower than a full decision — a deliberate placeholder, not a final number).** Founder chose to keep the current placeholder tiers (`shared/plans.ts`: free to 15 students, ₹1,499/mo to 60, ₹3,999/mo unlimited) rather than set real numbers now. **These become the live, real-money prices the moment Step 28 (C-03) switches billing on** — this was decided knowing that, not a deferral. Revisit before Step 28 ships if that's not still the intent.

**D-09 decided 2026-09-14 — reversed from this plan's recommendation.** The marketplace does **not** stay behind the §7 commercial gate. Founder wants tutor discovery/search built now, not after 10+ paying orgs/80% retention/₹10L collected. Stated product direction: discovery (browsing/searching for a tutor) should be free to any visitor; a future monetization idea floated is a small pay-per-contact fee (e.g. ~₹10) to reveal a tutor's contact details, rather than (or alongside) the subscription/take-rate model D-03 already ruled out for the *management* product. **Re-scoping pass complete, same day.** §7's R6 section and §8's backlog notes were rewritten against the real schema (not guessed), and EXECUTION_PLAN.md Steps 37 (B-14), 38 (B-15) and 39 (B-16) are written. Resolution of the three open dependency questions: B-15's enquiry-SLA clock does not need B-17's comms router first (it alerts in-app via the existing `notifications` table, gaining WhatsApp/SMS as a Step 27 follow-on); discovery/enquiry introduces no new adult-minor contact vector and does not need to wait for minor-safety verification, but ships with an honest "unverified" label on day one, and Step 30 (D-06) is recommended, not required, before the trial-to-enrolment handoff goes live; D-02's "centre keeps the customer relationship" is satisfied structurally by the existing `organization_id` scoping once enquiries are modeled as `leads` rows, with no new routing mechanism needed. Per the founder's direction, the new steps are appended continuing the existing numbering (37-39) without reordering or renumbering Steps 27-36, and are treated as an independent track startable whenever ripe rather than under a strict parallel-track rule. Still open, genuine founder calls not resolved by this pass: whether background checks are required before "reveal contact" (vendor, cost), the real pay-per-contact price and whether/when to gate it, and whether trial bookings need escrow from day one (recommended: no).

**D-10 decided 2026-09-14.** WhatsApp-first with SMS fallback, confirmed. Provider: an aggregator (Gupshup/Interakt/AiSensy/Twilio), not Meta direct — bundled template management, SMS fallback and India-specific support are worth more than direct-integration control at this team's size. The specific vendor is still open; Step 27's own design builds a provider-agnostic transport abstraction first (provider behind an interface), so the vendor pick doesn't block starting that work — it only gates the concrete adapter and the WhatsApp Business API onboarding/template-approval procurement.

**D-11 decided 2026-09-14.** A hand-rolled events table on the existing Postgres — not self-hosted PostHog, not a paid SaaS tier. Reasoning: pre-pilot scale (9 real orgs) doesn't yet justify a dedicated analytics platform, and DPDP posture (minors' data) makes shipping behavioral data to a third-party vendor before any legal review a real, avoidable risk for no near-term benefit. Revisit once there's real pilot volume and a legal/DPDP review has happened.

**D-12 decided 2026-09-14.** Free pilot, not paid design partners.

**D-06 reply decision, 2026-09-26 (EXECUTION_PLAN.md Step 30): a parent can read a tutor-student thread but not reply in it.** D-06 itself (every tutor-student message is visible to the student's parent, unconditionally) was already binding; Step 30 had to settle whether that visibility includes posting. Read-only, because: (1) it is exactly what D-06 requires and nothing more, and it is the easy direction to change later (allowing replies is one policy clause; taking replies away after parents rely on them is a product regression); (2) a parent posting into a tutor's conversation with a child turns a one-to-one thread into a three-way group chat nobody opted into, and the child loses the ability to talk to their tutor without a parent interjecting in the same thread; (3) the thread's two-person shape (`participant_ids`, `receiver_id`, unread state) stays true. It is enforced in the database, not just hidden in the UI: `messages_insert` now requires the sender to be a real participant of the conversation. **Known consequence, worth a founder look:** today a parent cannot *start* a DM with a tutor from the Inbox picker at all (the picker lists only their own child and themselves; staff can start a DM with a parent, not the reverse). So a parent who reads something they want to respond to has no in-app way to do it until staff messages them. That gap predates Step 30; letting parents start a DM with their child's tutor is a small follow-up if wanted. Revisit this decision if pilot parents ask to reply in-thread.

**D-13 decided 2026-09-14.** Patch the safe advisories now (20 of 21 fix with `npm audit fix`, zero breaking changes), hold the one breaking upgrade (`uuid`→`exceljs` major bump, risks the org-export feature) until closer to the pilot or the external pentest, so it gets deliberate testing rather than a rushed side effect.

---

## 14. What changed in this rewrite

Recorded so the diff is auditable and so nothing is quietly dropped.

**Structurally reordered.** B-17 (outbound comms) moved from last in R4 to first in R3, because the wedge is undeliverable without it. The marketplace (B-14, B-15, B-16) moved from R3 to R6 behind a commercial gate. Correctness and operations work that had no IDs at all (now C-01 through C-09) moved ahead of every feature.

**Newly introduced, none of it previously tracked.** The timezone defect (C-01), the absent scheduler (C-02), platform billing being unreachable (C-03), the unimplemented D-06 policy (C-05), the absence of any analytics as a named initiative (C-07), the operational floor (C-08), onboarding friction from BYO-Razorpay (C-09), and parent attendance and payment visibility (C-10).

**Removed.** B-16's take-rate mechanism, dead by D-03. The "0.2 to 0.5% transaction margin" second revenue line, impossible under BYO-Razorpay. The four-release framing that had R1 through R4 as the whole plan. The merge-conflict log, the R1 and R2 step-by-step narratives, and the "what to do next: R2's opening moves" section, all now history rather than plan. The claim that `Home.tsx`'s marketplace copy is "early, not wrong".

**Demoted.** B-19, the referral loop: coded but parked, because it depends on payments that do not work and users who do not exist.

**Assumptions that changed.** That the product was nearly ready for market and only needed a pentest and a marketplace. It is not: it cannot send a message, cannot be paid, and stores recurring classes at the wrong time of day. And the reverse assumption also changed, in the product's favour: the money core and the authorization model are genuinely strong, better than the plan gave them credit for, and they should be protected rather than extended.
