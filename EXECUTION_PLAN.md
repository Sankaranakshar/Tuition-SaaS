# ClassStackr Execution Plan — R1

**What this is:** [MASTER_PLAN.md](MASTER_PLAN.md) §3 R1 ("Money is correct") turned into an ordered sequence of steps small enough to execute one at a time, each with a concrete definition of done. Check a box, move to the next step. This is the doc to hand to a fresh Claude session with "do the next unchecked step."

**Scope: R1 only.** R2 (person-centric identity) and R3 (marketplace) both depend on staging existing (Step 11) and on founder decisions not yet made (D-02, D-03, D-05, D-06, D-07 — see MASTER_PLAN.md §5). Planning their execution in this much detail now would be guessing. This document gets extended with R2's steps once R1's gate (MASTER_PLAN.md §3) is met.

---

## How to use this document

- **Work top to bottom.** Steps are ordered by real dependency (what unblocks what), not just backlog score — this already differs from MASTER_PLAN.md §4's ranked-by-score list on purpose.
- **Each step is self-contained.** It names the exact files to touch, the pattern to follow (usually an existing route in the same file), and the gates that must be green before checking the box. A fresh session should be able to read one step and start working without re-reading this whole file.
- **"Needs you" steps are not engineering.** They need a decision, a signature, or money leaving the building. Everything else, Claude can execute end to end: code, migration, tests, gate run, doc update.
- **Definition of done always includes:** the relevant gates from HANDOFF.md §2 (tsc, unit, RLS, contract, build, bundle, API-bundle — run all seven, not just the ones that seem related), plus any browser walkthrough called out for that step (per MASTER_PLAN.md §7, money-touching interactive flows are exactly what automated gates can't see).
- **After finishing a step:** update this file's checkbox and status line, and update HANDOFF.md/MASTER_PLAN.md's affected numbers (gate counts, backlog table) in the same pass — this repo's established convention, see MASTER_PLAN.md §9 and HANDOFF.md's own "last verified" line.
- **Do not start a step whose "Depends on" isn't checked yet.**

---

## Progress tracker

| # | Step | Depends on | Status |
|---|---|---|---|
| 0a | B-02 rate limiter fix | — | ✅ Done 2026-08-06 |
| 0b | B-20 README rewrite | — | ✅ Done 2026-08-06 |
| 0c | D-08 decided (cancellation policy) | — | ✅ Done 2026-08-06 |
| 0d | D-01 decided (independent tutor identity) | — | ✅ Done 2026-08-06 |
| 1 | Cancellation-policy settings (D-08 schema) | 0c | ✅ Done 2026-08-06 |
| 2 | B-01 attendance reversal engine | 1 | ✅ Done 2026-08-06 |
| 3 | Cancellation-policy surface (parent-facing) | 2 | ✅ Done 2026-08-06 |
| 4 | B-03 wallet-to-ledger reconciliation job | 2 | ☐ Not started |
| 5 | Booking-request approval UI | — | ☐ Not started |
| 6 | B-09 bulk import (CSV/Excel) | — | ☐ Not started |
| 7 | B-05 self-serve parent top-up | — | ☐ Not started |
| 8 | **Needs you** — D-07 credit expiry period | — | ☐ Not started |
| 9 | B-04 credit expiry policy | 8 | ☐ Not started |
| 10 | B-11 DPDP consent centre + per-student erasure | — | ☐ Not started |
| 11 | **Needs you** — B-10 staging environment | — | ☐ Not started |
| 12 | **Needs you** — external pentest + leaked-password toggle | — | ☐ Not started |
| 13 | R1 gate checkpoint (full re-verification) | 1–12 | ☐ Not started |

Steps 5, 6, 7, 10 have no hard dependency on 1-4 and can be picked up out of order if you want parallel progress — they're placed here in backlog-score order (MASTER_PLAN.md §4).

---

## Step 1 — Cancellation-policy settings (D-08 schema)

**Done 2026-08-06.** No migration needed, as scoped — `organizations.settings` (already jsonb, already client-writable through the existing owner/admin-gated RLS `org_update` policy) grew a `cancellation` key. `src/components/OrganizationSettings.tsx` got a new "6. Cancellation Policy" section (three number inputs, percentages clamped client-side 0-100). `server/utils/cancellationPolicy.ts` (new file, not inlined in `billing.ts`, mirroring the existing `invoiceStatus.ts`/`invoiceNumber.ts` pattern of pulling pure, unit-testable logic out of the route file) exports `resolveCancellationPolicy()` — a pure per-field-fallback merge against `DEFAULT_CANCELLATION_POLICY` (24/50/100) — plus `getCancellationPolicy(orgId)`, the async `organizations.settings` fetch Step 2 will call. Browser-verified against the demo tutor account (seeded with `organization_members.role = "owner"`): section renders with the coded defaults, a changed value survives a page reload, reset back to 24/50/100 and re-saved to leave production demo data clean.

**Goal:** give D-08's three decided settings a place to live, readable from the server, editable from the UI. This unblocks Step 2.

**Why:** MASTER_PLAN.md §5, D-08 — `cancellation_free_hours` (default 24), `cancellation_late_fee_percent` (default 50), `no_show_forfeit_percent` (default 100), all founder-overridable per org.

**Scope — no migration needed.** `organizations` already has a `settings jsonb` column, read/written directly from the client today (`src/components/OrganizationSettings.tsx:24,42`, via `supabase.from("organizations")`, no server route involved — RLS on `organizations` already restricts the update to owner/admin, verify this hasn't drifted before relying on it). Add a new top-level key to the same jsonb shape:
```ts
cancellation: {
  freeHours: 24,
  lateFeePercent: 50,
  noShowForfeitPercent: 100,
}
```
1. `src/components/OrganizationSettings.tsx`: add `cancellation` to the default `settings` state (line ~11-17) and a new "6. Cancellation Policy" section (mirror the existing numbered-section pattern) with three inputs (number, number, number — all 0-100 for the two percentages, clamp client-side).
2. `server/routes/billing.ts`: add a small helper (near the top, alongside `CAN_MARK`/`CAN_MONEY`) that reads `organizations.settings->cancellation` for a given org, with the three defaults as fallback when the key is missing or the org has never saved settings (this is the common case today — don't assume every org has touched Settings). This helper is what Step 2 calls.

**Definition of done:**
- [x] `cancellation` section renders and saves in Settings → Organization, verified in a browser against the demo tutor account (owner role).
- [x] The billing.ts helper returns the coded defaults for an org with no `settings` row and no `cancellation` key at all — write a unit test for this in `tests/unit/` (a new small `tests/unit/cancellationPolicy.test.ts` mirroring `tests/unit/money.test.ts`'s style, pure function, no DB).
- [x] All seven gates green (HANDOFF.md §2).

---

## Step 2 — B-01: attendance reversal and wallet credit-back

**Done 2026-08-06.** New route `POST /api/v1/billing/attendance/reverse` in `server/routes/billing.ts`, same `CAN_MARK` gate and `withTransaction`/`FOR UPDATE` shape as `/attendance`. Migration `20260806100000_attendance_reversal.sql` adds `attendance_records.reversed_at`/`reversed_by` (the idempotency guard, applied to the hosted project via `supabase db push`); no change needed to `wallet_ledger.type` since it's a plain `text not null` with no CHECK constraint. `reverseAttendanceRequestSchema`/`reverseAttendanceResponseSchema` added to `shared/schemas/billing.ts`. The design decision the plan flagged (auto-reverse from `/sessions/cancel` vs. a separate explicit per-student action) was resolved as recommended: reversal stays separate; `/sessions/cancel` is unchanged. The free-cancellation-window check evaluates elapsed time against *now*, the moment `/attendance/reverse` is called — since reversal never fires automatically from `/sessions/cancel`, a staff member choosing `reason="cancellation"` on this endpoint is itself the cancellation decision, so there's no earlier "cancellation initiated" instant to reconstruct. Credit-charged sessions always credit back the whole session credit regardless of policy percentage (credits are discrete, no fractional-credit accounting exists); currency-charged sessions credit back the policy-computed percentage; invoiced-unpaid sessions are voided outright (no partial-void concept in the invoice status machine); invoiced-paid sessions get a percentage-based `refunds` row via the same shape `/refunds` already uses. A zero-delta `wallet_ledger` row of type `credit_reversal` is written even on the invoice path, so B-03's future reconciliation job can see a reversal happened without corrupting the balance sum it checks. Contract-tested in `tests/contract/billing.test.ts` (9 new cases: credit path, currency path, invoiced-unpaid void, invoiced-paid partial refund, double-reversal 409, unbilled 422, not-found 404, role gate, no-token 401). Real browser walkthrough against the demo org's production data (`Demo Tuition Center`): created a throwaway PER_SESSION-templated session for today, marked Aarav Mehta present via the real Today-page roster popover (confirmed billed — a ₹500 unpaid invoice appeared in Money → Outstanding), called `/attendance/reverse` through the app's own authenticated `api()` client from the browser console (no dedicated UI exists yet — Step 3's territory), confirmed Money → Outstanding dropped back to ₹100 and the Audit Log showed real `attendance.mark` → `attendance.reverse` entries, then deleted the throwaway session/attendance/invoice rows to leave production demo data clean (audit trail left intact, per the append-only convention).

**Goal:** the keystone item. Un-mark a session, credit the wallet, void or refund the accrued invoice, write a linked ledger entry and audit row — reading Step 1's per-org policy rather than a hardcoded split.

**Why:** MASTER_PLAN.md §3 R1, B-01. Today `POST /api/v1/billing/sessions/cancel` (`server/routes/billing.ts:281-302`) only flips `class_sessions.status` to `cancelled` — confirmed by reading it: no wallet touch, no invoice touch, no ledger entry at all. This is the exact gap Spec v2 flagged.

**Scope:**
1. **Migration** (`supabase/migrations/`, follow the existing timestamp-prefix naming): add `reversed_at timestamptz`, `reversed_by uuid references auth.users(id)` to `attendance_records`. This is the idempotency guard — a row with `reversed_at` set has already been reversed, mirroring how `billed` already guards against double-billing on the same table.
2. **New route**, `POST /api/v1/billing/attendance/reverse` in `server/routes/billing.ts`, same file, same `requireRole(...CAN_MARK)` pattern as `/attendance`. Request: `{ sessionId, studentId, reason: "cancellation" | "no_show" }`. Inside one `withTransaction` (mirror `/attendance`'s and `/refunds`' structure):
   - `select ... from attendance_records where session_id = $1 and student_id = $2 for update` — 404 if missing, 409/no-op if `reversed_at` already set (idempotent, same convention as `/refunds`' duplicate check).
   - 422 if `billed = false` — nothing to reverse.
   - Compute elapsed time between `now()` and the session's `start_time` (already on the row via `session_start`). Read Step 1's org policy. If `reason = "no_show"`: credit back `100 - noShowForfeitPercent`% of what was charged. If `reason = "cancellation"`: credit back 100% if elapsed hours-before-session exceeded `freeHours` at cancellation time (need to reconstruct this — store the original `session_start` minus when the cancel actually happens relative to it, not relative to `now()` at reversal time, since reversal and cancellation might not be the same instant; simplest correct approach: capture the decision at cancel time and pass the resulting refund percentage into this endpoint, or fold `/sessions/cancel` and this endpoint together — see the design note below), else credit back `100 - lateFeePercent`%.
   - Reverse the correct wallet/ledger path depending on how the original charge was billed: if `wallet_ledger` shows `debit_credit` for this session+student, credit back 1 credit; if `debit_currency`, credit back the computed percentage of `feePaise` in rupees; if the charge went to an **invoice** instead (the `invoiced` path in `/attendance`), void the invoice if unpaid, or write a `refunds` row via the same shape `/refunds` already uses if it was paid.
   - Write a `wallet_ledger` row with `type: "credit_reversal"` (new type — check `wallet_ledger`'s `type` column for a CHECK constraint before adding a new literal; extend it in the same migration as (1) if one exists) linked to the session, so B-03's reconciliation job can see it.
   - Set `attendance_records.reversed_at = now(), reversed_by = actor`, and `status` to `cancelled` or leave as-is per your read of whether a reversed "present" should still show as present-but-refunded (recommend: keep `status` as the historical record, reversal is a separate fact — don't overwrite what actually happened).
   - `writeAudit(orgId, actor, "attendance.reverse", "attendance_records", ..., { studentId, sessionId, reason, creditedPaise/Credits })`.
3. **Design decision to make while implementing, not before:** should `/sessions/cancel` call this reversal automatically for every already-billed student on the session, or should reversal stay a separate per-student action a staff member takes deliberately? Recommend the latter (separate, explicit, per-student) — a session can have some students marked present and billed, others absent; cancelling the *session* and reversing a *student's charge* are different-shaped operations. Wire `/sessions/cancel` to just keep doing what it does (flip status); the parent-facing surface in Step 3 and staff UI call `/attendance/reverse` explicitly per student.
4. **Zod schema:** add `reverseAttendanceRequestSchema` to `shared/schemas/billing.ts` next to `markAttendanceRequestSchema`.

**Definition of done:**
- [x] Route contract tests in `tests/contract/billing.test.ts` (or a new `tests/contract/attendanceReversal.test.ts` if it's getting long): reverse a credit-charged session (verify wallet credited back, ledger row written, `reversed_at` set), reverse a currency-charged session, reverse an invoiced (unpaid) session (verify invoice voided), reverse an invoiced-then-paid session (verify a `refunds` row appears), double-reversal is a no-op/409, reversing an unbilled attendance record 422s, RLS/role check (only `CAN_MARK` roles).
- [x] RLS suite still green — this touches no new table-level policy (existing tables), but re-run `npm run test:rls` anyway per HANDOFF.md §5 rule 10 since it's a privileged-route change.
- [x] **Real browser walkthrough, not just tests** (MASTER_PLAN.md §7's explicit call-out for this exact flow): mark a student present on a `PER_SESSION` template against the demo org, verify it bills, then reverse it from whatever UI surface exists (even a temporary one, or via a signed-in `curl`/Postman call against local dev if no UI ships in this step — Step 3 is the real UI), and confirm the wallet balance and invoice list reflect the reversal in the actual running app, not just in test assertions.
- [x] All seven gates green.
- [x] MASTER_PLAN.md §3 B-01 row and §4 backlog row updated to done; HANDOFF.md gate counts updated.

---

## Step 3 — Cancellation-policy surface (parent-facing)

**Done 2026-08-06.** Cancellation is staff-only today — confirmed by reading `src/pages/Schedule.tsx`: `MyScheduleView` (the student self-view at `/app/my-schedule`) renders session cards with no cancel affordance at all, and the parent nav rail (`src/components/Layout.tsx:80-84`) has no schedule route reachable by a parent in the first place — `ParentPortal.tsx`'s Overview tab is the *only* surface a parent can reach that shows an upcoming session. So this step added a disclosure, not a new cancel action, exactly as the plan's scope note anticipated.

The pure `resolveCancellationPolicy()`/`DEFAULT_CANCELLATION_POLICY` logic moved out of `server/utils/cancellationPolicy.ts` into a new `shared/cancellationPolicy.ts` (Zod-free, mirroring `shared/money.ts`'s existing convention) alongside a new `cancellationCutoff(sessionStart, freeHours)` helper, so the client and server resolve the exact same defaults instead of duplicating the merge logic; `server/utils/cancellationPolicy.ts` now just re-exports and adds the DB-touching `getCancellationPolicy(orgId)`. A new `src/lib/cancellationPolicy.ts` mirrors that server read through the client's own RLS-gated `organizations` select (`org_select`: any org member, parents included, per `supabase/migrations/20260709020200_rls.sql:59-60` — no policy change needed).

The disclosure — `t("schedule.cancellationDisclosure")`, "Free cancellation until {{cutoff}}. After that, a {{feePercent}}% fee applies." — was added to `ParentPortal.tsx`'s Overview session list (the actual deliverable) and, since staff has no walkthrough path into a parent-only page without impersonation or a throwaway account, also to `Schedule.tsx`'s existing staff `SessionPopover` (same cancel affordance B-01 already uses), which doubles as this step's real browser-verification surface.

Unit (182/182), RLS (81/81), and contract (206/206) suites all green — no RLS or contract changes were needed since this only added a client-side read against an already-open `org_select` policy. Browser-verified live against the demo tutor account: a throwaway same-day session (Aug 6, 4:00 PM, created and cancelled via the app's own UI afterward) showed "Free cancellation until 5 Aug 2026, 04:00 pm. After that, a 50% fee applies." — the outside-the-window state, cutoff already elapsed; an existing Aug 12 recurring batch session showed "Free cancellation until 11 Aug 2026, 06:30 pm. After that, a 50% fee applies." — the inside-the-window state, cutoff still upcoming. Both states render off the same coded defaults (24h/50%/100%) since the demo org has never overridden them. `ParentPortal.tsx`'s own render of the same disclosure is code-reviewed only, not live-clicked — reaching it requires a parent-role account, and no demo parent account exists (`scripts/seed.ts` seeds no `parent_links` row), matching this repo's established convention for role-gated surfaces unreachable from the single-role demo tutor account (HANDOFF.md §9).

**Goal:** show a parent, before they cancel or after a no-show, what the cutoff/fee/refund actually is — currently invisible.

**Why:** MASTER_PLAN.md §3 R1 table, "Cancellation-policy surface (parent-facing)," ~1 ed, paired explicitly with B-01: "the clearest source of fee disputes."

**Scope:** wherever a parent can currently cancel a session or view an upcoming one (check `src/pages/ParentPortal.tsx` and `src/pages/Schedule.tsx`'s session popover for the existing cancel affordance, if any — confirm during implementation whether parents can already trigger `/sessions/cancel` or whether this is staff-only today, since that changes whether this step needs a new parent-facing cancel action or just a policy disclosure on an existing one). Add a small inline disclosure using Step 1's org policy (fetched via a lightweight read — either a new unauthenticated-safe read since it's not sensitive, or reuse the existing `organizations.settings` client-side read pattern already in `OrganizationSettings.tsx`): "Free cancellation until {cutoff time}. After that, a {lateFeePercent}% fee applies." Uses `src/lib/format.ts` for time formatting per HANDOFF.md §6.

**Definition of done:**
- [x] Disclosure renders correctly for a session inside and outside the free window (two states, verify both).
- [x] i18n: string goes through `t()` per HANDOFF.md §6, not hardcoded.
- [x] Browser-verified against the demo org (staff view at minimum; parent view if reachable without a throwaway production account, otherwise code-reviewed only — matches this repo's established convention for role-gated surfaces, see HANDOFF.md §9).
- [x] All seven gates green.

---

## Step 4 — B-03: wallet-to-ledger reconciliation job

**Goal:** a scheduled check that `wallets.balance_credits`/`balance_currency` equals what `wallet_ledger` says it should be — the check that catches the *next* B-01-shaped bug before a parent notices their balance is wrong.

**Why:** MASTER_PLAN.md §3 R1, B-03, 2 ed. Explicitly: "same `CRON_SECRET` pattern as `/api/cron/reporting-daily`."

**Scope:** new endpoint `POST /api/cron/reconcile-wallets` in `server/routes/cron.ts`, following the exact existing pattern of `/api/cron/reporting-daily` (same file — read it first, copy its secret-gating and idempotent-upsert shape). Logic: for each wallet, sum `wallet_ledger` rows for that `(organization_id, student_id)` and compare to the wallet's current `balance_credits`/`balance_currency`. Where they disagree, write a row to a small new table (or reuse `audit_events` with a distinct action type `wallet.reconciliation_mismatch` — prefer this over a new table, less schema surface for a diagnostic-only feature) rather than silently auto-correcting; a human should look at a real drift before the job starts rewriting balances.

**Definition of done:**
- [ ] Throwaway contract test proving correct-match and deliberate-mismatch cases, written against the PGlite harness, then deleted — same convention as `/reporting-daily`'s verification (DEV_PLAN.md §3.3), since cron routes are deliberately excluded from the permanent contract suite (HANDOFF.md §5 rule... actually the testing-strategy note in DEV_PLAN.md §5: "Route contracts deliberately skip `cron.ts`").
- [ ] Manually invoke against local dev with a real `CRON_SECRET`, confirm a clean org reports no mismatches.
- [ ] Cloud Scheduler wiring is explicitly **out of scope** for this step (same open ops gap already noted for `/materialize-sessions` and `/reporting-daily` — don't try to close it here, it needs infra access this session doesn't have).
- [ ] All seven gates green.

---

## Step 5 — Booking-request approval UI

**Goal:** `session_requests` (per MASTER_PLAN.md §3, "carried from spec v2 Tutor tab") already exists as a table/API but the staff accept/decline/propose-alternative UI is thin.

**Scope:** find the existing `session_requests` read path (grep for it — likely partially wired into Inbox or Schedule already) and build out accept/decline/propose-alternative actions using the existing popover/inline-action interaction vocabulary (REDESIGN.md §10 — popover-first editing, not a new modal pattern).

**Definition of done:**
- [ ] All three actions (accept/decline/propose) work end to end, browser-verified.
- [ ] All seven gates green.

*(Lighter detail here deliberately — read the existing `session_requests` code first; the shape of "thin UI over an existing table" means the real scope only becomes clear once you've seen what's there.)*

---

## Step 6 — B-09: bulk import (CSV/Excel, column mapping, dry run)

**Goal:** import 200 students in one sitting instead of manual entry — MASTER_PLAN.md's stated reason this is high-value: "the switching cost that loses the deal."

**Scope:** `papaparse` is already a dependency (seen in the built bundle, `dist/assets/papaparse.min-*.js`) and `exceljs` is already used server-side (`server/routes/orgExport.ts`) — both directions (import and export) should share format-handling conventions where sensible. Build: file upload → column-mapping UI (map spreadsheet headers to student fields) → dry-run preview (show what would be created/skipped, especially dedup-by-phone per REDESIGN.md §5.4) → commit. Reuse `People.tsx`'s existing student-creation validation rather than duplicating it.

**Definition of done:**
- [ ] Dry-run mode never writes to the database — verify with a contract test that a dry-run request produces zero new `students` rows.
- [ ] A malformed/duplicate-phone row is reported per-row, not a whole-file failure.
- [ ] Browser-verified with a real CSV against the demo org.
- [ ] All seven gates green.

---

## Step 7 — B-05: self-serve parent top-up

**Goal:** top-up is staff-only today; let a parent top up their own child's wallet.

**Scope:** `server/routes/billing.ts`'s existing `/wallets/topup` (line 72) is currently gated `requireRole(...CAN_MONEY)` — staff only. Add a parent-facing path: either a new route or a role check that also allows `parent` when `studentId` is one of their own linked students (check `parent_links`/however parent-student linkage is modeled — see `parents.ts` route). **This step must degrade behind `gateway_not_connected`** per HANDOFF.md §7 — a parent's self-serve top-up almost certainly wants to go through Razorpay (not a manual/cash record, which wouldn't make sense for a parent to self-report), so this is naturally blocked on Razorpay live keys, which are deferred. Build the full flow anyway; it should return the same clean `gateway_not_connected` 422 every other Razorpay-dependent path already does, and go live automatically once GTM procurement (MASTER_PLAN.md §8) connects real keys.

**Definition of done:**
- [ ] A parent can only top up their own linked students' wallets, never another family's — RLS/route-contract test for this specifically (the obvious cross-tenant/cross-family bug to guard against).
- [ ] Degrades to `gateway_not_connected` cleanly today (can't be live-verified until Razorpay is connected, per the founder's deferral — code-reviewed + contract-tested only, same convention as the existing payment-link footer).
- [ ] All seven gates green.

---

## Step 8 — Needs you: D-07, credit expiry period

Per-org configurable within a platform cap is MASTER_PLAN.md's recommendation, mirroring how D-08 landed (Step 1) — but confirm the actual numbers with you before Step 9 builds against them, the same way D-08's specifics (24h/50%/100%, all overridable) came from a real conversation rather than the plan's original recommendation. Suggested question to answer: what's the default expiry window, and what's the platform-wide maximum an org can extend it to?

---

## Step 9 — B-04: credit expiry policy

**Goal:** per-org window with warning notices before lapse. Today credits are immortal — MASTER_PLAN.md calls this "an unbounded liability with no revenue-recognition point."

**Scope:** depends entirely on Step 8's answer. Likely shape once decided: extend Step 1's `organizations.settings.cancellation`-style pattern with a new `creditExpiry` key; a scheduled job (same `cron.ts` pattern as Steps 4's reconciliation and the existing `/reporting-daily`) that flags/expires credits and fires a warning notification (via the existing `notifications` surface) before lapse, not silently.

**Definition of done:** (fill in once Step 8 lands and the real shape is known — don't guess the warning-window UX ahead of the decision.)

---

## Step 10 — B-11: DPDP consent centre and per-student erasure

**Goal:** statutory. Org-level export exists (`server/routes/orgExport.ts`); per-student erasure does not, and consent is currently implicit despite the portal stamping a `consentVersion`.

**Scope:** two halves. (a) Per-student erasure: mirror `orgExport.ts`'s existing offboarding-adjacent patterns but scoped to one student — this touches financial-history retention rules (HANDOFF.md's 8-year retention note, GO_TO_MARKET_BLUEPRINT.md §8.2), so erasure almost certainly means anonymize-in-place for financial records and hard-delete for everything else, not a blanket delete. (b) Consent centre: the document `consentVersion` already points at doesn't exist yet — that's a **legal** deliverable (GO_TO_MARKET_BLUEPRINT.md §8's DPDP checklist), out of engineering scope; flag it back to the GTM checklist (MASTER_PLAN.md §8) rather than drafting legal text in this step.

**Definition of done:**
- [ ] Per-student erasure request removes/anonymizes correctly, verified against a throwaway student in the demo org, financial records confirmed still reconcilable afterward (don't break B-03's reconciliation job).
- [ ] Consent-document gap explicitly logged back to MASTER_PLAN.md §8 as still open, not silently dropped.
- [ ] All seven gates green.

---

## Step 11 — Needs you: B-10, staging environment

A spend decision (new Supabase project, ~2 ed of engineering to wire it up once approved), not something to provision unilaterally. Once you approve the spend, the engineering part (separate Supabase project, `supabase db push` against it, a second Vercel preview environment or branch deploy pointed at it, updated `.env.example` guidance) can be picked up as its own step here. This is what unblocks R1's full gate (a real environment to rehearse migrations on before they hit production) and all of R2.

---

## Step 12 — Needs you: external pentest + leaked-password protection

Two different asks bundled because they're both "needs you, not engineering," not because they're related:
- **External pentest:** a real third-party engagement (HANDOFF.md §2.2 / MASTER_PLAN.md §3) — a procurement task, budget it and pick a vendor; do not accept an automated-scanner substitute.
- **Leaked-password protection:** a one-click toggle in the Supabase Auth dashboard (HANDOFF.md §2.2 calls this out as the one open gap in an otherwise-closed security posture) — this one takes two minutes once you're logged into the Supabase dashboard; flag it here so it doesn't get lost among the bigger items.

---

## Step 13 — R1 gate checkpoint

Once Steps 1-12 are checked (or explicitly deferred with a reason, same discipline as every other deferral in this project's history — see MASTER_PLAN.md §3's "R1 gate" paragraph), re-verify the whole gate as one pass rather than trusting each step's individual green run in isolation:

- [ ] A mis-marked attendance can be fully reversed by an owner, wallet/invoice/ledger all agreeing afterward (Step 2, re-walked end to end).
- [ ] The reconciliation job (Step 4) runs clean against production.
- [ ] A parent tops up their own wallet without a staff member (Step 7 — or confirmed still gated on Razorpay, which is fine, just confirm the degradation path is real).
- [ ] A 200-student centre imports in one sitting (Step 6).
- [ ] Staging exists (Step 11) and every migration shipped in Steps 1-10 was rehearsed there first, retroactively if it wasn't rehearsed at the time.
- [ ] Update MASTER_PLAN.md: mark R1 complete, move its "What to do next week" (§10) to R2's opening moves, and start this document's R2 section.
