# ClassStackr Master Plan

**What this is:** one plan, merged from DEV_PLAN.md, HANDOFF.md, REDESIGN.md, GO_TO_MARKET_BLUEPRINT.md, README.md and `ClassStackr_Product_Spec_v2.xlsx`. It supersedes the release planning in each of those individually. Where they disagreed, the disagreement is resolved here and recorded in §9.

_Written 2026-08-02 against commit `f44f085` plus the uncommitted reporting-job and token-styling passes. Code claims re-checked directly, not inherited. Amended 2026-08-06: B-02 and B-20 shipped (commit `64db1e7` plus an uncommitted pass), D-08 and D-01 decided by the founder — see §3, §4, §5, §10. [EXECUTION_PLAN.md](EXECUTION_PLAN.md) is the step-by-step, checkbox-trackable execution order derived from this plan's R1; start there for day-to-day work._

---

## 1. Source map: which document still governs what

| Document | Still authoritative for | Stale, do not trust for |
|---|---|---|
| **HANDOFF.md** | Current state, architecture, runbook, security invariants, the trap list | Nothing. Keep it current. |
| **REDESIGN.md** | Product experience, IA, motion, visual language, interaction vocabulary | §17 (dual-store), §23 phasing (delivered), §6.6's left-anchored Settings IA (never built — Settings shipped 2026-09 as a token-retoned version of the pre-existing horizontal tab strip; see REDESIGN §6.6 and HANDOFF §9) |
| **This document, §11** | The Tech Debt #N backlog (numbering frozen as a citation anchor), the testing-layer description. **Retired 2026-09-12: DEV_PLAN.md's unique content moved here; the file itself was deleted.** Old code comments citing `DEV_PLAN §2/§5/E16.x`/`Epic N`/`Stage N item M` point at a pre-2026-07-25 layout that no longer exists anywhere — treat them as loose pointers into [docs/BUILD_LOG_ARCHIVE.md](docs/BUILD_LOG_ARCHIVE.md)'s build history, never as live anchors. `DEV_PLAN Tech Debt #N` citations are still exact — see §11 below. | Nothing else to know; superseded content is gone, not stale |
| **Spec v2 (xlsx)** | Role matrix, per-screen IA, marketplace spec, backlog scoring, open decisions | Nothing. It is the newest artifact. |
| **This document, §12** | Market position, ICP, the wedge, monetization logic, launch-gate categories (distilled from GO_TO_MARKET_BLUEPRINT.md's surviving sections) | — |
| **[docs/GO_TO_MARKET_BLUEPRINT_ARCHIVE.md](docs/GO_TO_MARKET_BLUEPRINT_ARCHIVE.md)** | Nothing on its own — superseded by §12 above. Kept verbatim, same section numbers, only because `server/utils/erasure.ts`, two migration files, and `shared/plans.ts` cite it by exact section (§8.2 retention, §4.3 pricing) | §2, §7, §8 (except 8.2's retention figure, still accurate), §9, §10 entirely. Firestore-era history, the stack is now Supabase/Postgres. |
| **README.md** | Setup, architecture summary, deployment, security invariants (rewritten 2026-08-06, B-20) | Nothing currently known |
| **EXECUTION_PLAN.md** | The R1 summary tracker and the R2 scaffold (backlog + blockers, not yet executable steps). R1's per-step detail is frozen at [docs/EXECUTION_PLAN_R1_ARCHIVE.md](docs/EXECUTION_PLAN_R1_ARCHIVE.md) — code comments cite its "Step N" anchors | Executable R2-R4 detail — R2's numbered steps get written once staging exists and the R2-gating founder calls land; R3-R4 not started |

**The one-line product definition, updated by spec v2:** a platform connecting parents, students and tutors, where a tutor may be independent or part of an organisation, and the same person may be both. This is a widening from the blueprint's "the tuition center OS that collects your fees," and it is what makes R2 and R3 structural rather than optional.

---

## 2. Where the build actually stands

**Shipped and verified live:** the whole management product. Six workspaces (Today, People, Student Story, Money, Inbox, Schedule), three-beat onboarding, server-authoritative money with `FOR UPDATE` locks and idempotency keys, invoices with GST snapshot and PDF and Razorpay links and webhook reconciliation, refunds against invoices, subscription billing with a DB-enforced student cap, super-admin console, org export and offboarding, audit log, staff/parent/student invite flows, mobile polish, the nightly `org_stats_daily` job.

**Gates, all green:** tsc, 211 unit, 90 RLS, 252 contract, build, bundle 203.6KB against a 260KB budget, API-bundle route verification (16 mounts). All seven run in CI. None need Docker, Java or a live database. (Numbers as of 2026-09-12, post EXECUTION_PLAN.md Step 15's multi-membership migration; HANDOFF.md §2 is the live source.)

**Load:** k6 `attendance_burst` against live production, p95 79 to 101ms against a 400ms target, no duplicate invoice under 15 concurrent VUs.

**The honest gap, and it is bigger than DEV_PLAN implied.** DEV_PLAN described the remaining work as "pentest, then Stage 4 leftovers, then go-to-market." Spec v2 found three classes of gap that were not on that list at all:

1. **The money loop is one-directional.** Attendance debits a wallet and accrues an invoice. Nothing reverses it. There is no un-mark path in `server/routes/billing.ts`, no credit-back, no ledger-versus-balance reconciliation check, and prepaid credits never expire. Mis-marking is the single most common daily operator event and the product has no remedy for it.
2. **Identity is org-locked.** `tutor_profiles`, `parent_profiles` and `student_profiles` are keyed on `user_id` with a NOT NULL `organization_id`. A person belongs to exactly one org, forever. That contradicts the product's own one-line definition and blocks the entire marketplace.
3. **The "connects" half of the product does not exist.** Discovery, verification, trials, reviews, escrow, payouts. ClassStackr currently manages a relationship that already exists. It cannot create one.

DEV_PLAN's remaining items (external pentest, tech debt #3, activation analytics, the GTM checklist, the two deferred epics) are all still open and are folded into the releases below rather than tracked separately.

---

## 3. The plan: four releases

Each release has a single thesis, a gate, and an effort total. Effort is in engineer-days (ed), founder-supplied estimates, not measured.

### R1 — Money is correct (22.5 ed + carried items) — ✅ COMPLETE 2026-09-05

**Thesis:** nothing else matters if a wallet balance can be wrong. Every item here either closes a correctness hole or removes a human from a loop that should be self-serve.

**Status:** all R1 engineering shipped (B-01/B-02/B-03/B-04/B-05/B-09/B-11/B-20 + the two carried items). Step 13 (EXECUTION_PLAN.md), the R1 gate checkpoint, was completed 2026-09-05: seven gates re-run clean off the top of the branch stack (211 unit / 89 RLS / 252 contract / build / 200.7 KB bundle / 16 API mounts), and every money-touching flow re-walked live against production. The two founder-deferred items — **B-10 staging** (founder: hold) and **external pentest + leaked-password toggle** (deferred to pre-GTM) — are recorded as explicit non-failing deferrals; R1 is not treated as failing the gate on them. Staging is a hard prerequisite before R2/B-06. The R1 branch stack was merged to `main` 2026-09-05 (founder chose "preserve per-step commits"; PRs #2/#3 plus the Step 13 doc closure `e92aa63`); all seven gates re-run green on the merged `main`.

| ID | Item | ed | Notes |
|---|---|---|---|
| ~~B-01~~ | ~~Attendance reversal and wallet credit-back~~ | ~~3~~ | **Done 2026-08-06.** `POST /api/v1/billing/attendance/reverse` (`server/routes/billing.ts`), reading D-08's per-org policy via `getCancellationPolicy()`. Un-marks a billed attendance record, credits back the wallet (whole credit for a credit-charged session, policy-computed percentage for a currency-charged one), voids an unpaid accrued invoice or writes a partial `refunds` row for a paid one, and writes a linked `wallet_ledger` row plus an `attendance.reverse` audit event. Kept as a separate explicit per-student action from `/sessions/cancel`, as the item's own design note recommended. See EXECUTION_PLAN.md Step 2 for the full design log and browser-verification detail. |
| ~~B-02~~ | ~~Fix per-user rate limiting~~ | ~~1~~ | **Done 2026-08-06.** `identifyUser` (`server/middleware/auth.ts`) now runs ahead of `apiLimiter` to populate `req.user.id` for the keyGenerator without doing the full membership lookup; real auth still enforced downstream by each route's `authenticateToken`. See HANDOFF.md §8. The k6 caveat (§11.1 below) was about the limiter's *effect*, not its config, and stands independent of this fix. |
| ~~B-03~~ | ~~Wallet-to-ledger reconciliation job~~ | ~~2~~ | **Done 2026-09-05.** `POST /api/cron/reconcile-wallets` (`server/routes/cron.ts`), same `CRON_SECRET` pattern as `/api/cron/reporting-daily`. Sums `wallet_ledger.credits`/`paise` per `(organization_id, student_id)`, compares to `wallets.balance_credits`/`balance_currency`; on mismatch writes an `audit_events` row (`wallet.reconciliation_mismatch`) rather than auto-correcting. Manually invoked against local dev — production currently has 0 rows in `wallets`, so this confirmed the route end-to-end but not against real drift; re-run once an org has wallet activity. Cloud Scheduler wiring still open (same gap as `/materialize-sessions`/`/reporting-daily`). See EXECUTION_PLAN.md Step 4. |
| ~~B-04~~ | ~~Credit expiry policy~~ | ~~3~~ | **Done 2026-09-05.** `POST /api/cron/expire-credits` (`server/routes/cron.ts`), same `CRON_SECRET` gate as B-03's job. Per-org opt-in via a new `organizations.settings.creditExpiry` (`{ enabled, windowDays }`) jsonb key — **no migration** (same as D-08's `cancellation` key; `wallet_ledger.type` needs none for the new `credit_expiry` literal). No platform default: an org that never configures this keeps immortal credits and the job skips it. The FIFO per-lot walk (founder's "expiry runs from each top-up date") is computed **on the fly** from `wallet_ledger` each run — `shared/creditExpiry.ts`, no `wallet_credit_lots` table — matching B-03's re-derive-from-the-ledger instinct. A negative-delta `credit_expiry` ledger row is written per broken lot (idempotency-keyed on the source lot's id) and the wallet balance decremented to match, so B-03's `balance == ledger sum` still holds; nothing is deleted. 30/7-day warnings fire once per lot via the existing `notifications` surface. See EXECUTION_PLAN.md Step 9. Browser/live-data walkthrough deferred — same blocker as B-03 (0 wallets in prod, no browser surface mints wallet credit); throwaway-contract-tested against a real Postgres engine + unit-tested + route invoked live. |
| ~~B-05~~ | ~~Self-serve parent top-up~~ | ~~4~~ | **Done 2026-09-05.** New parent-only `POST /api/v1/billing/wallets/topup-link` (`server/routes/billing.ts`), authorized against `parent_links`, no manual/cash variant since a parent self-reporting their own credit would be a fraud vector. Closed a real gap the item's own scope didn't anticipate: the Razorpay webhook (`server/routes/webhooks.ts`) was entirely invoice-shaped and would have silently swallowed a wallet-topup payment — `handleEvent()` now branches on the payment link's `notes.type` before its invoice lookup. Degrades behind `gateway_not_connected` as specified; the webhook settlement side needs no live gateway and is fully contract-tested, unlike the outbound link-creation call. See EXECUTION_PLAN.md Step 7. |
| ~~B-09~~ | ~~Bulk import (CSV/Excel, column mapping, dry run)~~ | ~~3~~ | **Done 2026-09-05.** Two new routes on `server/routes/students.ts` (`/import/inspect`, `/import`), server-side CSV/XLSX parsing (`papaparse`/`exceljs`, sniffed by real content not declared type), a name+phone dedup rule decided directly with the founder (a phone match alone isn't enough — siblings share a parent's phone; every duplicate needs an explicit per-row resolution), and a 3-step wizard (`src/components/BulkImportModal.tsx`) on People's Students lens. REDESIGN.md's cited §5.4 dedup spec does not exist — confirmed by reading the file. A real bug was found and fixed during browser verification: `tutor_id` was set only when the actor's *org role* was tutor, but `useStudentsList()` separately filters by tutor_id whenever the actor's *person-type* is tutor (a different field — see AuthContext.tsx) — an owner-run import created real students that then silently vanished from that owner's own list. See EXECUTION_PLAN.md Step 6 for the full design log. |
| ~~B-10~~ | ~~Staging environment~~ | ~~2~~ | **Complete 2026-09-12 — Supabase and Vercel.** Second project `classstackr-staging` (ref `fcshxorkxsaerwnuqrjh`, ap-south-1, same org). All 33 migrations pushed from an empty DB with zero errors — the first real from-zero test of the set. Seeded (demo parent + student included), Storage upload/signed-URL/fetch/delete round-tripped clean, `supabase_realtime` publication carries all 21 expected tables. The `tuition-saas` Vercel project's Preview environment now points at it (Production untouched), verified end to end against a real preview deployment; `supabase/README.md`/`.env.example` document targeting it locally — see HANDOFF.md §4. |
| ~~B-11~~ | ~~DPDP consent centre and per-student erasure~~ | ~~4~~ | **Done 2026-09-05.** `POST /api/v1/students/:studentId/erase` (`server/routes/students.ts`, owner/admin, type-to-confirm, no new route mount). Founder-confirmed model: hard-delete the personal + academic rows (`student_notes`, `assessments`, `enrollments`, `parent_links`, `session_requests`, invites, `documents` + Storage objects), anonymize the `students` row into an `is_deleted` stub (every PII column nulled, `erased_at`/`erased_by` stamped), leave `invoices`/`payments`/`refunds`/`wallets`/`wallet_ledger`/`attendance_records` untouched for 8-year retention — B-03's `balance == ledger sum` stays intact. Leftover wallet balance is a per-org choice (`settings.erasure.walletPolicy` = `block` (default) or `writeoff`). The premise was wrong: there was no `consentVersion` anywhere — consent was a validated-then-discarded boolean. New `consent_records` table (migration `20260905130000`, pushed to prod) + a `CONSENT_VERSION` constant now persist one row per parent/student redeem. The consent *document* that version points at is still not drafted — see §8. See EXECUTION_PLAN.md Step 10. |
| ~~B-20~~ | ~~Rewrite README~~ | ~~0.5~~ | **Done 2026-08-06.** Rewritten for the actual stack (Supabase/Postgres RLS, stateless Express, Vercel), correct commands, and a pointer to this document. |
| ~~—~~ | ~~Booking-request approval UI~~ | ~~~1~~ | **Done 2026-09-05.** Carried from spec v2 Tutor tab, but the plan's premise was wrong: `session_requests` was an unused stub, not an existing table/API with thin UI — this was a build-from-scratch feature (migration + API + UI), confirmed with the founder to cover both target shapes (join a recurring class, or book a tutor one-on-one) plus a propose-counter-offer flow. See EXECUTION_PLAN.md Step 5 for the full design log, the reused enrollment/session-creation helpers, and a real disabled-button bug found and fixed during browser verification. |
| ~~—~~ | ~~Cancellation-policy surface (parent-facing)~~ | ~~1~~ | **Done 2026-08-06.** Cancellation turned out to be staff-only today (no parent-facing cancel action exists), so the deliverable is a disclosure, not a new action: `t("schedule.cancellationDisclosure")` on `ParentPortal.tsx`'s Overview session list (the only surface a parent can reach), reading D-08's policy via a new client-side `getOrgCancellationPolicy()` (`src/lib/cancellationPolicy.ts`) against the existing `org_select` RLS policy. The pure resolve/cutoff logic moved to `shared/cancellationPolicy.ts` so client and server share one definition. Also surfaced in the staff `SessionPopover` (`Schedule.tsx`) alongside B-01's existing cancel button, which doubled as the browser-verification surface since no demo parent account exists. See EXECUTION_PLAN.md Step 3. |

**Also folded into R1 from DEV_PLAN, no new estimate:** external pentest (a procurement task, not engineering; do not self-certify with a scanner), enabling leaked-password protection in Supabase Auth, and wiring Cloud Scheduler to `/api/cron/materialize-sessions` and `/api/cron/reporting-daily`, which are both built and both currently never fire in production.

**R1 gate — met 2026-09-05 (EXECUTION_PLAN.md Step 13):** a mis-marked attendance can be fully reversed by an owner, with the wallet, the invoice and the ledger all agreeing afterwards ✅ (re-walked live: mark → ₹300 invoice accrued → reverse → invoice voided → Outstanding restored → `409` on double-reverse); the reconciliation job runs clean against production ✅ (`/reconcile-wallets` and `/expire-credits` both `200`, 0 wallets); a parent tops up their own wallet without a staff member ✅ (route live + role-gated; full path still blocked on no-demo-parent + no-Razorpay, degradation confirmed); a 200-student centre imports in one sitting ✅ (live-walked 2026-09-05, wizard re-confirmed); ~~staging exists and the R1 migrations were rehearsed on it first~~ — **deferred (founder: hold on B-10), recorded as a non-failing gate line; hard trigger before R2/B-06.** External pentest + leaked-password protection also deferred to pre-GTM (§8), not gate conditions.

### R2 — One person, many orgs (26 ed)

**Thesis:** make identity org-independent. This is the structural prerequisite for R3, and it is a real migration against live data. Staging is complete (§4 backlog, B-10, both Supabase and Vercel) — rehearse B-06's migration there before touching production, same discipline the hold on B-10 was meant to protect.

| ID | Item | ed |
|---|---|---|
| B-06 | Person-centric identity: one login, many memberships. Independent tutor modelled as a single-member org so the schema never forks (D-01) | 8 |
| B-07 | Org switcher plus cross-org conflict checking | 5 | ✅ Done 2026-09-12 (EXECUTION_PLAN.md Step 20) |
| ~~B-08~~ | ~~Tutor payouts and earnings: hours or sessions taught, earnings ledger, payout run, statement, TDS. Built once, serves org payroll and marketplace payouts alike~~ | ~~6~~ | **Done 2026-09-12 (EXECUTION_PLAN.md Step 21)** |
| ~~B-12~~ | ~~Monthly progress-report PDF~~ | ~~3~~ | **Done 2026-09-12 (EXECUTION_PLAN.md Step 22)** |
| ~~B-13~~ | ~~Substitute and leave management~~ | ~~4~~ | **Done 2026-09-12 (EXECUTION_PLAN.md Step 23)** |

**Also in R2, from the IA tabs:** the assignment marking loop back into the gradebook (currently upload works, marking does not, on both the staff and student side), guardian records moving from student-owned to parent-owned, cross-org family view for parents, and student session-requests routed to a parent for approval per D-05's per-student payment-permissions model (not a fixed age threshold — see §5).

**R2 gate:** one human account teaches independently on Tuesdays and at a centre on Thursdays, switches context without logging out, and neither org can book over the other; a parent with children at two different centres sees one home screen; a centre runs a payout cycle inside the product. **Met as of 2026-09-12.** The switching/booking half closed with EXECUTION_PLAN.md Step 20 (a real org switcher in the app rail, and a genuine cross-org tutor double-booking bug found and fixed along the way — `class_sessions.tutor_id` is the same id across a multi-org tutor's orgs, but the conflict check used to scope by `organization_id` too, so two orgs could each independently book the same tutor at the same time). The payout-cycle half closed with Step 21 (B-08): earnings accrue automatically off attendance, and a payout run aggregates a tutor's unpaid earnings into a TDS-deducted, statement-backed payout. The multi-centre-parent-home-screen item remains unscoped, folded into the "also in R2" IA-tab backlog below.

**R2 also unblocks D-04's migration.** D-04 is decided (§5: drop the legacy rupee-mirror columns, migrate to paise-native) — once the identity migration has proven the team can run a real migration against production data, `invoices.total_amount`/`subtotal` and `wallets.balance_currency` can be resolved on staging first. Conversion logic is already centralized in `shared/money.ts`; only the migration itself (not the decision) remains.

### R3 — The marketplace (30 ed)

**Thesis:** turn a management tool into a two-sided platform, and open the second revenue line. Sequenced in six stages, each depending on the one before.

| Stage | Contents | Release notes |
|---|---|---|
| 1. Supply | Public tutor profile (bio, subjects, boards, grades, mode, rate, languages, photo, intro video); verification tiers (email/phone → government ID → qualification docs → background check) with a visible badge; org storefront | B-14, 8 ed. Verification is non-negotiable: adults are being introduced to minors. It is also the genuine moat against listing sites. |
| 2. Discovery | Search and filter (subject, board CBSE/ICSE/State, grade, mode, price band, rating, distance, availability); matching ranked on fit, proximity, availability, response rate and outcomes, never on who paid most | Part of B-15. Get the board/grade taxonomy right once, retrofitting it is painful. |
| 3. Conversion | Structured enquiry with an SLA clock landing in the tutor's Inbox; trial lesson booked in-app with a structured follow-up decision; enrolment that hands off to the management product with wallet funded and invoice raised | B-15, 12 ed total. The trial is the highest-leverage primitive in this category. The enrolment handoff is the actual differentiation. |
| 4. Trust | Reviews gated on verified completed attendance, tutor may reply once, moderation queue; dispute resolution with evidence, decision and wallet remedy | B-16. Dispute resolution depends entirely on R1's reversal engine. Attendance gating is what makes ratings credible. |
| 5. Money | Escrow (held until the session is marked attended, then released); leakage strategy competing on value rather than blocking contact details | B-16, 10 ed with trust. D-02/D-03 decided 2026-09-12 (§5) — **this row is now stale on pricing:** D-03 ruled out a take-rate/commission model entirely in favour of tiered subscriptions for both centres and solo tutors, so the "take rate tapering" mechanism this stage originally specified needs re-scoping around subscription tiers instead; escrow itself (holding a session's payment until attendance) is unaffected. |
| 6. Compliance | Minor-safety policy for adult-minor 1:1 chat, session recording, parental thread visibility (D-06 — decided 2026-09-12, always parent-visible, §5); DPDP consent extended to marketplace, no behavioural tracking of children | Builds on R1's consent centre. Also a sales objection from every institutional buyer. |

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
| ~~B-03~~ | ~~Wallet-ledger reconciliation~~ | R1 | 5 | 0.9 | 2 | **Done 2026-09-05** |
| ~~B-10~~ | ~~Staging environment~~ | R1 | 4 | 1.0 | 2 | **Complete 2026-09-12, Supabase and Vercel** |
| ~~B-01~~ | ~~Attendance reversal~~ | R1 | 5 | 1.0 | 3 | **Done 2026-08-06** |
| ~~B-09~~ | ~~Bulk import~~ | R1 | 5 | 0.9 | 3 | **Done 2026-09-05** |
| ~~B-05~~ | ~~Self-serve parent top-up~~ | R1 | 5 | 0.9 | 4 | **Done 2026-09-05** |
| ~~B-04~~ | ~~Credit expiry~~ | R1 | 4 | 0.8 | 3 | **Done 2026-09-05** |
| ~~B-11~~ | ~~DPDP consent + erasure~~ | R1 | 4 | 0.8 | 4 | **Done 2026-09-05** |
| ~~B-12~~ | ~~Monthly progress PDF~~ | R2 | 3 | 0.8 | 3 | **Done 2026-09-12** |
| B-17 | WhatsApp comms router | R4 | 5 | 0.7 | 5 | 0.70 |
| ~~B-08~~ | ~~Tutor payouts~~ | R2 | 5 | 0.8 | 6 | **Done 2026-09-12** |
| B-19 | Referral loop | R4 | 3 | 0.6 | 3 | 0.60 |
| ~~B-06~~ | ~~Person-centric identity~~ | R2 | 5 | 0.9 | 8 | **Done 2026-09-12** |
| ~~B-13~~ | ~~Substitute and leave~~ | R2 | 3 | 0.7 | 4 | **Done 2026-09-12** |
| B-18 | Leading indicators | R4 | 3 | 0.7 | 4 | 0.53 |
| B-14 | Public profiles + verification | R3 | 5 | 0.7 | 8 | 0.44 |
| B-15 | Search, enquiry, trial | R3 | 5 | 0.6 | 12 | 0.25 |
| B-16 | Escrow, take rate, reviews | R3 | 4 | 0.6 | 10 | 0.24 |
| ~~B-07~~ | ~~Org switcher + cross-org conflicts~~ | R2 | 4 | 0.9 | 5 | **Done 2026-09-12** |

**Total: 90.5 ed at plan-time** (R1 22.5, R2 26, R3 30, R4 12); **76 ed remaining** after B-02, B-20 (1.5 ed), B-01 (3 ed) shipped 2026-08-06 and B-03 (2 ed), the booking-request approval UI (~1 ed), B-09 (3 ed), B-05 (4 ed) shipped 2026-09-05. At one engineer that is roughly 16 calendar weeks of pure build; budget 24 to 28 with review, migrations and the browser walkthroughs this stack demonstrably needs.

Note the score ranking and the release ranking disagree on purpose. B-06 scores 0.56 but gates all of R3, and B-14/B-15/B-16 score low only because they are large. Score breaks ties inside a release; it does not reorder releases.

---

## 5. Decisions only the founder can make

All eight are now answered — D-08 and D-07 on 2026-08-06, D-01 on 2026-08-06, and D-02/D-03/D-04/D-05/D-06 on 2026-09-12. Each row's Blocks column notes what that unblocks.

| ID | Decision | Status | Blocks |
|---|---|---|---|
| D-08 | Cancellation and no-show policy | **Decided 2026-08-06 — per-org configurable, not fixed.** Three settings per org: `cancellation_free_hours` (default 24), `cancellation_late_fee_percent` (default 50, applies inside the free window), `no_show_forfeit_percent` (default 100). All three are founder-set defaults any org can override, including no-show — narrower than the original recommendation, which would have fixed no-show at a flat 100% platform-wide. B-01's design must read these three fields per org rather than hardcoding the 24h/50%/100% split. | **B-01**, done 2026-08-06 |
| D-07 | Credit expiry period | **Decided 2026-09-05 — per-org, fully center-controlled, no platform default or bounds.** A center sets its own expiry window in Settings. Until it does, credits never expire for that org (today's behaviour is preserved; expiry is an opt-in, not a platform-imposed number). No minimum and no maximum on the window a center can choose. Expiry is measured from each top-up / purchase date, not from last activity, so B-04 needs per-lot credit tracking (walk `wallet_ledger` credit-lots FIFO, expire the unconsumed remainder of any lot past its window) rather than the single-scalar-plus-one-jsonb-key shape D-08 used. The expiry cron only touches wallets in orgs that have configured `creditExpiry`. Narrower than the original "configurable within a platform cap" recommendation: the founder chose no cap and no floor. | **B-04** |
| D-05 | Can a student transact without a parent? | **Decided 2026-09-12 — parent-controlled per-student permissions, not a fixed age rule.** Narrower than the original age-threshold recommendation: each parent gets a settings surface, per student, to control whether that student can pay for themselves at all, a spending limit, and which payment methods are allowed (e.g. wallet-only vs. any method). No platform-wide age cutoff. This is a real permissions model to design and build — a per-student settings UI plus a permission check on every self-serve booking/payment path in R2 — not a single boolean. | **R2 approval routing, student booking, consent** — now unblocked, scoped larger than planned |
| D-06 | Adult-minor 1:1 messaging policy | **Decided 2026-09-12 — parent-visible by default, no org-level override.** Every message between a tutor and a student is visible to that student's parent, unconditionally. | **Inbox today, marketplace trust in R3** — now unblocked |
| D-01 | Independent tutor: own org or org-less? | **Decided 2026-08-06 — single-member org, no schema fork.** Every tutor has an `organization_id`; an independent tutor is an org of one, no parallel org-less path. This decides only *how* an independent tutor's own membership looks — it does not by itself let one person hold multiple org memberships. That capability is B-06 (person-centric identity, R2, 8 ed) plus B-07 (org switcher, 5 ed); D-01 just makes that later migration land as "one shape, N memberships" instead of forking into an org and an org-less code path. | **B-06 and all of R3**, now unblocked |
| D-02 | Who is the customer in a marketplace booking? | **Decided 2026-09-12 — the centre retains the customer relationship whenever a centre is involved.** If a tutor working at a centre later leaves, the family's wallet, billing, and history stay with the centre, not the tutor. Applies only when a centre is in the picture; an independent tutor (D-01's "org of one") keeps their own relationships by definition, since there is no separate centre to retain them. **Related product rule decided alongside this, not itself part of D-02's original scope:** marketplace tutor discovery must always be an explicit, parent-initiated search — the app must never proactively suggest or push a tutor to a parent. | **Escrow, take rate, disputes** — now unblocked |
| D-03 | Marketplace pricing model | **Decided 2026-09-12 — subscription-only, multiple tiers, no take-rate/commission model.** Narrower than the original recommendation (subscription for orgs, take rate for individuals): both centres and independent solo tutors pay a subscription, with pricing differentiated by tier/usage level for each side (a Personal-vs-Teams SaaS split, not a percentage-of-earnings cut). B-16's "take rate" framing needs re-scoping to a tiered-subscription model before it's built. | **B-16, GTM** — now unblocked, B-16 needs re-scoping |
| D-04 | Drop the legacy rupee columns? | **Decided 2026-09-12 — yes, migrate to paise-native now that staging exists.** Drop `invoices.total_amount`/`subtotal` and make `wallets.balance_currency` a paise-native integer; rehearse the migration on staging before touching production. | **Tech Debt #3** — now unblocked |

---

## 6. Permission model

Spec v2's Roles and Permissions tab is now the canonical RBAC spec, replacing the blueprint's §9.3 matrix (which was written for Firestore rules). Seven roles: owner, admin, tutor, frontdesk, accountant, parent, student, plus platform admin. Tutors split into in-org and independent, which is the distinction R2 makes real.

Enforcement lives in three places and must stay consistent across all of them: RLS policies (the constitution, 81 tests), `requireRole` and the `CAN_MARK`/`CAN_MONEY` capability sets in the route layer (195 contract tests), and the client's own gating (untested, and the source of a real bug already fixed once).

**Rows in that matrix that nothing enforces yet, because the capability does not exist:** attendance reversal (B-01, done), own-earnings and payout visibility (B-08, done 2026-09-12 — EXECUTION_PLAN.md Step 21), publish public profile, search and browse tutors, book a trial, write a review (all R3), and switch organisations (R2, done). Every one of them lands with RLS tests in the same PR as the feature.

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

**Legal:** privacy policy, ToS, refund policy, documented 8-year financial-data retention, minor-safety policy from D-06 (before R3), and — **still open, flagged by EXECUTION_PLAN.md Step 10** — the **DPDP parental-consent document**. As of 2026-09-05 the app persists a `consent_records` row stamped with `CONSENT_VERSION` (`shared/consent.ts`, currently `"dpdp-2026-09.draft"`) on every parent/student invite redeem, but the document that version resolves to has not been written. Draft it, publish it, and bump `CONSENT_VERSION` to a non-`.draft` string (and again on every substantive revision — never reuse a version for changed terms). This is legal work, not engineering; it blocks nothing in R1.

**Launch readiness:** demo org with a wipe, onboarding tested with a stranger, staffed support channel, written release smoke script, rollback procedure (Vercel covers the app; there is no rehearsed procedure for a bad migration, and R1/R2 both ship migrations).

**Success criteria for launch, carried from the blueprint:** 25 paying orgs, week-4 retention above 80% of activated orgs, and over ₹10L monthly fee volume collected through the platform. That last number is the one that proves the wedge.

---

## 9. Conflicts found while merging, and how they were resolved

1. **DEV_PLAN's "only the pentest remains" versus spec v2's three structural gaps.** Spec v2 wins. DEV_PLAN was measuring completeness against its own Stage 0-to-4 plan, which never contained reversal, expiry, reconciliation, identity or the marketplace. The stage numbering is retired in favour of R1 to R4.
2. **README versus reality.** README described Firestore, Firebase Auth, custom claims, `npm run test:rules` and Cloud Run. None of that exists; the stack is Supabase, Postgres RLS, no custom claims, `npm run test:rls`, Vercel. Fixed by B-20 (2026-08-06) — README.md is now accurate.
3. **The blueprint's architecture and security sections.** Both are Firestore-era. Its C1 to C5 vulnerabilities were real then and are fixed now under a different architecture. Keep the strategy sections (§1 wedge, §3 role gaps, §4 market position, §14 launch gates); discard §2, §7, §8, §9, §10.
4. **An earlier draft of the k6 caveat.** It attributed the throughput cap to "the per-user rate limiter (120 req/min)." The limiter is not per-user in effect, for the reason B-02 documents. The load-test conclusion (p95 well under target, no duplicate invoice) still stands; only the explanation of the cap was wrong.
5. **REDESIGN §17's scalability note** claims a Firestore-plus-SQLite dual store stays backend-internal. That store is gone. Its actual conclusion (optimistic UI everywhere) survives on its own merits.
6. **Home.tsx's marketing copy.** Still written as a tutor marketplace ("Search", "Find 1-on-1 Tutors", "1,200+ Tutors", "Browse Group Batches"), which DEV_PLAN flagged as a mismatch with a B2B fee-collection product. Spec v2 changes the verdict: that copy is no longer wrong, it is early. Leave it until R3 and then make it true, rather than rewriting it to B2B now and rewriting it back later.
7. **`org_stats_daily` has no consumer.** DEV_PLAN deliberately declined to wire Money's insights tab to it, correctly, since that would trade live intraday numbers for a stale daily aggregate. B-18 is the first real consumer. Until then the table accumulates rows nobody reads, which is fine and intended.

---

## 10. What to do next — R2's opening moves

**R1 closed 2026-09-05** (EXECUTION_PLAN.md Step 13). Prior weeks' list — ship B-02/B-20, answer D-08/D-01, then B-01 → B-03 → booking UI → B-06/B-07 → B-09 → B-05 → B-04 → B-11 → Step 13 — is all done or founder-deferred; history preserved in git and the EXECUTION_PLAN Step notes.

Now, in order:

1. ~~Merge the R1 branch stack to `main`~~ **Done 2026-09-05** — founder chose "preserve per-step commits"; merged via GitHub PRs #2 (`r1-step-9-credit-expiry`) and #3 (`r1-step-10-dpdp-consent-erasure`), Step 13 doc closure cherry-picked onto `main` as `e92aa63`. All seven gates re-run green on the merged `main`; `api/index.js` byte-identical. Feature branches fully merged; deleting them is optional cleanup.
2. ~~Re-open B-10 staging~~ **Complete 2026-09-12 — Supabase and Vercel** — second project `classstackr-staging` (ref `fcshxorkxsaerwnuqrjh`), all 33 migrations pushed clean from zero, seeded (demo parent included — see HANDOFF.md §4/§9 for a related correction: the demo parent account has actually existed since `design/portals`, just never flagged as closing the gaps that cited its absence), Storage round-trip and realtime-publication both verified. The `tuition-saas` Vercel project's Preview environment now points at it (Production untouched), verified end to end against a real preview deployment, and `supabase/README.md`/`.env.example` document targeting it locally.
3. ~~Answer the R2-gating founder decisions~~ **Done 2026-09-12** (§5): D-05, D-06, D-02, D-03, D-04 all decided — see §5 for full detail. Two carry more scope than originally planned: D-05 is a per-student parent-controlled payment-permissions model (not a fixed age rule), and D-03 is subscription-only tiered pricing for both centres and solo tutors (no take-rate/commission model, so B-16 needs re-scoping before it's built).
4. **Scope B-06** against the real `tutor_profiles`/`parent_profiles`/`student_profiles` schema (all PK'd on `user_id`, NOT NULL `organization_id`) and write EXECUTION_PLAN.md's R2-0 + B-06 as full numbered steps, folding in D-05's permissions model. The R2 scaffold is already in EXECUTION_PLAN.md; not yet expanded into executable steps.
5. **Continue the long-lead GTM procurement in parallel** (§8): WhatsApp templates, DLT, Razorpay KYC, Google OAuth verification, external pentest (pre-GTM bucket), leaked-password toggle (one Supabase switch, rides the §8 Auth items — not an action item to re-surface).
6. ~~Small cleanup found at the R1 gate: `is_deleted = true` students leak into client `from("students").select` sites.~~ **Fixed 2026-09-05 (branch `fix-is-deleted-student-pickers`).** The three active-list pickers (`CommandPalette` jump-to, `Schedule` ClassWizard, `Documents` upload) now filter; the name-resolution / load-by-id / retained-financial-record sites are deliberately left unfiltered. Verified live + all seven gates green. See EXECUTION_PLAN.md Step 13's completion note. **Separately flagged (pre-existing, unrelated):** ~~`Documents.tsx`'s `DOCUMENT_SELECT` aliases a non-existent `documents.name` column (should be `file_name`) — the document list 400s; needs its own fix + a check that uploads work at all.~~ **Fixed 2026-09-05 (branch `cleanup-post-r1`).** `name` → `file_name`; the whole Documents flow (upload → list → signed-URL download → delete) verified end to end against production on the demo owner account — the first time it has run against real data. Same commit fixed the person-type vs org-role conflation in that file's two queries (HANDOFF.md §8/§9). All seven gates green, numbers unchanged.

---

## 11. Technical debt and testing strategy

**Merged in from DEV_PLAN.md on 2026-09-12, which is now retired** (its content moved here rather than staying a separate, thinner copy of §2-§3 above; git history has the original file). Old source comments citing `DEV_PLAN §2a Stage N item M`, `DEV_PLAN Epic N`, or a bare `DEV_PLAN E<number>` predate 2026-07-25 and never matched this document's layout either — treat them as loose pointers into [docs/BUILD_LOG_ARCHIVE.md](docs/BUILD_LOG_ARCHIVE.md)'s chronological build log, not as live anchors. `DEV_PLAN Tech Debt #N` citations are the one exception: that numbering is exact, and it continues below unchanged.

### 11.1 k6 load test at real scale — done 2026-08-01

`attendance_burst` against the live production API with founder sign-off, 15 VUs / ~90s against the seeded demo org. **p95 79-101ms across three runs, well under the 400ms / 5x-pilot target** (the headline number is already in §2's gates). No duplicate invoice despite 15 concurrent VUs on the same session/student — the `FOR UPDATE` wallet lock and the `billed`-flag idempotency guard held under real concurrent write pressure. Caveat if re-run: the script's single shared auth token means it tests "one token under concurrent connections," not "N distinct tutors at once" — a faithful multi-tutor burst needs the script extended to authenticate as several accounts.

### 11.2 Technical debt backlog

**The #N numbering is frozen as a citation anchor — do not renumber.** Only open items are listed; a closed item is retired by deleting its row, not by striking it through. Closed-item history through 2026-08-02 (Tech Debt #1/#2/#4/#5/#6/#7/#8/#9 and three verified-false entries) lives in git history and [docs/BUILD_LOG_ARCHIVE.md](docs/BUILD_LOG_ARCHIVE.md).

| # | Item | Priority | Effort |
|---|---|---|---|
| 3 | **Dual money columns — conversion logic centralized (2026-08-01), decision made 2026-09-12 (D-04, §5): drop the legacy columns.** All `Math.round(x*100)` / `x/100` call sites are now one pair of functions (`shared/money.ts`'s `rupeesToPaise`/`paiseToRupees`). **Now an engineering task, not a decision:** drop the legacy rupee-mirror columns (`invoices.total_amount`/`subtotal`) and make `wallets.balance_currency` a paise-native integer. This is a real schema migration against live production data — rehearse it on staging (now available) first, and confirm whether any historical invoice predates the paise columns or whether anything external reads the rupee mirrors before dropping them. | High | ~1 ed migration + read-path cleanup |

**Structural note, do not regress:** `profiles.organization_id` is **not** vestigial and must not be dropped — `Today.tsx`'s admin lanes query and subscribe to it. It is not authorization-bearing (RLS never trusts it) but it is load-bearing for a live feature.

### 11.3 Testing strategy

Four layers, all runnable locally with no Docker, Java, or live database.

| Layer | Command | Count | What it owns |
|---|---|---|---|
| Unit | `npm test` | 211 | Money math, invoice status machine, invoice numbering, webhook signatures, PDF composer, the realtime merge reducer, debounce + rupee/paise conversion, credit-expiry FIFO, one pure-core suite per workspace. |
| RLS / authorization | `npm run test:rls` | 89 | The constitution. Policies tested directly against PGlite with raw SQL. |
| Route contracts | `npm run test:contract` | 252 | The real Express app through supertest against PGlite. The auth matrix (401/403/200/409/422) the RLS layer structurally can't see, plus webhook HMAC verification, plus per-user (not per-IP) rate limiting. Runs in CI. |
| Load | `npm run test:load:smoke` | k6 | Read-only smoke. See §11.1 for the write scenario. |

**Rules.** New money/queue logic lands with unit tests in the same PR. Any migration or privileged-route change runs the RLS suite. Route contracts deliberately skip `cron.ts` (service-token auth), `webhooks.ts` (raw-body HMAC middleware), and `settings.ts`'s Google OAuth endpoints (deferred integration).

**Not built yet:**
- **Playwright E2E** for the golden journeys (signup → first class; book → attendance → invoice; invoice → payment link → webhook → paid; parent invite → OTP → consent → portal → pay; template edit reshapes future sessions). Journeys 3 and 4 stay blocked on Razorpay and OTP. This is the only layer that catches the "never ran in a browser" and "role vs organizationRole" bug classes in HANDOFF.md §8 — the same gap §7 above already names for R1/R3's money-touching flows.
- **Axe in CI.** The accessibility pass ran once (2026-07-25, fixed five WCAG AA violations) but is not automated — re-run it as new pages ship.

---

## 12. Market strategy and positioning

**Distilled from GO_TO_MARKET_BLUEPRINT.md on 2026-09-12**, whose surviving sections (§1, §3, §4, §12, §14) are folded in here; the full original is archived, section numbers unchanged, at [docs/GO_TO_MARKET_BLUEPRINT_ARCHIVE.md](docs/GO_TO_MARKET_BLUEPRINT_ARCHIVE.md) — kept verbatim because `server/utils/erasure.ts`, two migration files, and `shared/plans.ts` cite it by exact section (§8.2 retention, §4.3 pricing).

**Market position.** Competitors: Teachmint and Classplus (India, feature-broad, app-first, sales-heavy), Proctur/MyClassCampus (legacy ERP feel), TutorBird/Teachworks/TutorCruncher (Western, weak in India payments/WhatsApp). Nobody in the India segment is loved for product quality; all are feature checklists. **Do not compete on feature count.** The wedge:

> "ClassStackr collects your fees." The only tuition management product where attendance automatically becomes an invoice, the invoice automatically becomes a WhatsApp payment link, and the money automatically reconciles.

This is measurable in rupees (easy sale), viral through parents (every payment link is marketing), defensible through workflow lock-in (the ledger is the moat), and honest to the codebase's differentiated asset (the class-type pricing engine). Secondary differentiator, from REDESIGN.md: speed and calm — every competitor feels like an ERP.

**ICP at launch.** Primary: tuition centers with 1-5 tutors and 30-300 students in Indian metros/tier-2, currently running on WhatsApp groups + paper registers + GPay screenshots. Secondary: solo premium tutors. Explicitly not at launch: schools, franchises, marketplaces (FindTutors is cut, REDESIGN.md §18), non-India markets.

**Monetization.** Per-active-student pricing (aligns cost with value, scales with center size) — free up to 15 students, then slab pricing (`shared/plans.ts`); payments collected via Razorpay subscriptions; annual discount. Payment-collection transaction margin (0.2-0.5% on top of gateway fees) becomes the second revenue line once volume exists.

**AI sequencing.** Deterministic rules first (already shipped as the Today attention queue), then the morning brief, then reply drafting, then anything predictive — see §3 R4's AI note for the current, in-force version of this sequencing.

**Launch-gate categories** (contents superseded by §8 above; the categories still apply): security, product, engineering, legal/finance, operations, GTM gates — each needs a green checklist before charging real money.
