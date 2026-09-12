# ClassStackr Execution Plan

**What this is:** [MASTER_PLAN.md](MASTER_PLAN.md) §3's current release turned into an ordered sequence of steps small enough to execute one at a time, each with a concrete definition of done. This is the doc to hand a fresh Claude session with "do the next unchecked step."

**Where things stand:** **R1 ("Money is correct") is complete and merged to `main`** (2026-09-05). Its 13 steps, their definitions of done, the premise corrections found mid-step, and the Step 13 gate re-verification are archived in full at [docs/EXECUTION_PLAN_R1_ARCHIVE.md](docs/EXECUTION_PLAN_R1_ARCHIVE.md) — source comments still cite its "Step N" anchors, so it is frozen, not deleted.

**R2 ("identity is org-independent") is scaffolded below but not startable yet** — its numbered steps get written once staging (B-10) exists and the R2-gating founder decisions land (see the scaffold). Planning R2/R3 in executable detail before then is guessing.

---

## How to use this document

- **Work top to bottom.** Steps are ordered by real dependency (what unblocks what), not backlog score — this differs from MASTER_PLAN.md §4's ranked list on purpose.
- **Each step is self-contained.** It names the exact files to touch, the pattern to follow (usually an existing route in the same file), and the gates that must be green before checking the box.
- **"Needs you" steps are not engineering.** They need a decision, a signature, or money leaving the building. Everything else, Claude executes end to end: code, migration, tests, gate run, doc update.
- **Definition of done always includes** the seven gates from HANDOFF.md §2 (tsc, unit, RLS, contract, build, bundle, API-bundle — run all seven), plus any browser walkthrough called out for that step (per MASTER_PLAN.md §7, money-touching interactive flows are exactly what automated gates can't see).
- **After finishing a step:** update this file's checkbox/status line and the affected numbers in HANDOFF.md / MASTER_PLAN.md in the same pass — this repo's established convention (MASTER_PLAN.md §9, HANDOFF.md's "last verified" line).
- **Do not start a step whose "Depends on" isn't checked yet.**

---

## R1 — complete (2026-09-05)

Full detail: [docs/EXECUTION_PLAN_R1_ARCHIVE.md](docs/EXECUTION_PLAN_R1_ARCHIVE.md). Summary tracker:

| # | Step | Status |
|---|---|---|
| 0a | B-02 rate limiter fix | ✅ 2026-08-06 |
| 0b | B-20 README rewrite | ✅ 2026-08-06 |
| 0c | D-08 decided (cancellation policy) | ✅ 2026-08-06 |
| 0d | D-01 decided (independent tutor identity) | ✅ 2026-08-06 |
| 1 | Cancellation-policy settings (D-08 schema) | ✅ 2026-08-06 |
| 2 | B-01 attendance reversal engine | ✅ 2026-08-06 |
| 3 | Cancellation-policy surface (parent-facing) | ✅ 2026-08-06 |
| 4 | B-03 wallet-to-ledger reconciliation job | ✅ 2026-09-05 |
| 5 | Booking-request approval UI | ✅ 2026-09-05 |
| 6 | B-09 bulk import (CSV/Excel) | ✅ 2026-09-05 |
| 7 | B-05 self-serve parent top-up | ✅ 2026-09-05 |
| 8 | **Needs you** — D-07 credit expiry period | ✅ Decided 2026-09-05 |
| 9 | B-04 credit expiry policy | ✅ 2026-09-05 (browser walkthrough deferred — no wallet data on prod) |
| 10 | B-11 DPDP consent centre + per-student erasure | ✅ 2026-09-05 (erasure UI browser-verified; DB-state via PGlite contract suite) |
| 11 | **Needs you** — B-10 staging environment | ⏸️ Deferred 2026-09-05 (founder: hold) — **hard trigger before R2/B-06** |
| 12 | **Needs you** — external pentest + leaked-password toggle | ⏸️ Both deferred to pre-GTM 2026-09-05 |
| 13 | R1 gate checkpoint (full re-verification) | ✅ 2026-09-05 — all 7 gates green (211/89/252, 200.7 KB, 16 mounts); money flows re-walked live. **R1 COMPLETE.** |

Gate numbers at R1 close: tsc clean · 211 unit · 89 RLS · 252 contract · build `dist/server.js` 184.4 KB · bundle 200.7 KB gzip / 260 KB · API bundle 16/16 mounts.

Two items (B-10 staging, external pentest + leaked-password toggle) were explicitly deferred rather than failing the gate — full reasoning and consequences in the archive's Steps 11-13; current status in MASTER_PLAN.md §3's R1 section and §8's GTM checklist.

---

# R2 (scaffold)

**Status: not startable yet.** R1's gate is met, which is the trigger to *begin* this section — but R2's steps cannot be written in executable detail until two things land:

1. **Staging (B-10) must exist.** MASTER_PLAN.md §3 R2 is explicit: B-06 is a real migration against live identity data, do not start it before staging. Step 11's deferral carried a hard trigger to here. Standing up staging is the first R2 work item regardless of the founder decisions below (~1.5–2.5 eng-days when scoped: create the second Supabase project, `supabase db push` all migrations against an empty DB — itself the first from-zero test — seed it *including a demo parent account* prod lacks, a second Vercel env, re-verify the realtime-publication migrations, first Storage upload test, update `supabase/README.md` / `.env.example` / HANDOFF's "no staging" note).
2. **Founder decisions D-02, D-03, D-05, D-06 (MASTER_PLAN.md §5) must be answered** where they touch R2 — D-05 (can a student transact without a parent?) directly gates R2's session-request → parent-approval routing; D-02/D-03 are mostly R3 but shape B-08's wallet/invoice ownership model. D-01 is decided (single-member org, no schema fork) and already unblocks B-06's shape.

**R2 thesis (from MASTER_PLAN.md §3):** make identity org-independent — one login, many memberships. Gate: one human account teaches independently on Tuesdays and at a centre on Thursdays, switches context without logging out, neither org can book over the other; a parent with children at two centres sees one home screen; a centre runs a payout cycle in-product.

**R2 backlog, in dependency order** (to be turned into numbered steps once the two blockers above clear):

| ID | Item | ed | Blocked on |
|---|---|---|---|
| R2-0 | Staging environment (B-10) | 2 | founder go-ahead only |
| B-06 | Person-centric identity: one login, many memberships; independent tutor as a single-member org (D-01 decided) | 8 | staging; needs its own scoping pass |
| B-07 | Org switcher + cross-org conflict checking | 5 | B-06; needs its own scoping pass |
| B-08 | Tutor payouts & earnings ledger (serves org payroll now, marketplace payouts in R3) | 6 | B-06; partly D-02 |
| B-12 | Monthly progress-report PDF | 3 | — (could pull forward) |
| B-13 | Substitute & leave management | 4 | B-06 |

**Also in R2, from the spec v2 IA tabs:** the assignment-marking loop into the gradebook (upload works, marking doesn't, both sides); guardian records moving from student-owned to parent-owned; cross-org family view for parents; student session-requests routed to a parent for approval below the D-05 age threshold.

Do not expand this into executable steps ahead of the blockers. Next action when R2 starts: scope B-06 against the real `tutor_profiles`/`parent_profiles`/`student_profiles` schema (all PK'd on `user_id` with NOT NULL `organization_id` today) and write R2-0 + B-06 as full steps.
