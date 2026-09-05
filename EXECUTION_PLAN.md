# ClassStackr Execution Plan — R1 (✅ complete 2026-09-05) + R2 scaffold

**What this is:** [MASTER_PLAN.md](MASTER_PLAN.md) §3 R1 ("Money is correct") turned into an ordered sequence of steps small enough to execute one at a time, each with a concrete definition of done. Check a box, move to the next step. This is the doc to hand to a fresh Claude session with "do the next unchecked step."

**R1 is complete** — all 13 steps done or explicitly founder-deferred, gate met at Step 13 (2026-09-05). An **R2 scaffold** (backlog + blockers) is at the bottom of this file; R2's numbered steps get written once staging (B-10) exists and the R2-gating founder decisions (D-02, D-03, D-05, D-06 — see MASTER_PLAN.md §5) land. Planning R2/R3 in executable detail before then would be guessing.

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
| 4 | B-03 wallet-to-ledger reconciliation job | 2 | ✅ Done 2026-09-05 |
| 5 | Booking-request approval UI | — | ✅ Done 2026-09-05 |
| 6 | B-09 bulk import (CSV/Excel) | — | ✅ Done 2026-09-05 |
| 7 | B-05 self-serve parent top-up | — | ✅ Done 2026-09-05 |
| 8 | **Needs you** — D-07 credit expiry period | — | ✅ Decided 2026-09-05 |
| 9 | B-04 credit expiry policy | 8 | ✅ Done 2026-09-05 (browser walkthrough deferred, see Step 9) |
| 10 | B-11 DPDP consent centre + per-student erasure | — | ✅ Done 2026-09-05 (erasure UI browser-verified; DB-state assertions via PGlite contract suite, direct prod DB access blocked — see Step 10) |
| 11 | **Needs you** — B-10 staging environment | — | ⏸️ Deferred 2026-09-05 (founder: hold) — recorded as an explicit non-failing gate line at Step 13; hard trigger before R2/B-06 |
| 12 | **Needs you** — external pentest + leaked-password toggle | — | ⏸️ Both deferred to pre-GTM 2026-09-05 — not R1-gate conditions |
| 13 | R1 gate checkpoint (full re-verification) | 1–12 | ✅ Done 2026-09-05 — all 7 gates re-run clean (211/89/252, 200.7KB, 16 mounts); money flows re-walked live; Steps 11/12 recorded as deferrals; MASTER_PLAN R1 marked complete. **R1 COMPLETE.** |

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
- [x] Throwaway contract test proving correct-match and deliberate-mismatch cases, written against the PGlite harness, then deleted — same convention as `/reporting-daily`'s verification (DEV_PLAN.md §3.3), since cron routes are deliberately excluded from the permanent contract suite (HANDOFF.md §5 rule... actually the testing-strategy note in DEV_PLAN.md §5: "Route contracts deliberately skip `cron.ts`").
- [x] Manually invoke against local dev with a real `CRON_SECRET`, confirm a clean org reports no mismatches. (Production currently has 0 rows in `wallets`, so this confirmed the route is wired correctly end-to-end — auth-gating, query execution, response shape — but didn't exercise real data. Worth re-running once a real org has wallet activity.)
- [x] Cloud Scheduler wiring is explicitly **out of scope** for this step (same open ops gap already noted for `/materialize-sessions` and `/reporting-daily` — don't try to close it here, it needs infra access this session doesn't have).
- [x] All seven gates green.

**Shipped 2026-09-05:** `POST /api/cron/reconcile-wallets` in `server/routes/cron.ts`, mirroring `/reporting-daily`'s secret-gating. Sums `wallet_ledger.credits`/`paise` per `(organization_id, student_id)`, compares to `wallets.balance_credits`/`balance_currency`, and on mismatch writes an `audit_events` row (`wallet.reconciliation_mismatch`) rather than auto-correcting. Gates: tsc clean, 182 unit, 81 RLS, 206 contract, build, bundle 199.2KB/260KB, API-bundle all 15 mounts present.

---

## Step 5 — Booking-request approval UI

**Goal:** ~~`session_requests` (per MASTER_PLAN.md §3, "carried from spec v2 Tutor tab") already exists as a table/API but the staff accept/decline/propose-alternative UI is thin.~~ **Correction, found while starting this step:** that description was wrong. `session_requests` was a bare stub (id, org, requester, status, created_at) — no route or client ever read or wrote it, and it had no columns to represent an actual request (no template/tutor/time reference). This was a build-from-scratch feature, not a thin-UI pass. Scope confirmed with the founder: support both request shapes (join an existing recurring class, or book a one-on-one with a specific tutor) with a full accept/decline/propose-counter-offer flow, not just accept/decline.

**Shipped 2026-09-05:**
- Migration `20260905120000_booking_requests.sql` (pushed live — no staging exists) fleshes out `session_requests`: `student_id`, exactly one of `template_id`/`tutor_id` (XOR check constraint), `requested_start_time/end_time`, `notes`, `proposed_template_id`/`proposed_start_time/end_time`, `response_note`, `responded_by_user_id`/`responded_at`, `resulting_enrollment_id`/`resulting_session_id`.
- New `server/routes/sessionRequests.ts` mounted at `/api/v1/session-requests`: create (any org member), staff-only list/accept/decline/propose, and a requester-only respond-to-proposal endpoint. Accept/respond-to-proposal reuse `scheduling.ts`'s enrollment-capacity and session-conflict logic directly (extracted into exported `createEnrollmentTx`/`createSessionTx` so there's one source of truth, not a second copy) rather than re-implementing those checks.
- Client: new `BookingRequestsPanel` rendered as a staff-only "Requests" segment in Inbox (kept as its own list+popover rather than merged into the conversations/notifications feed, which would have forced a booking request into a shape it isn't). Popover-first accept/decline/propose actions per REDESIGN.md §10.
- The requester's own response to a counter-offer is API-only, code-reviewed but not browser-verified — no demo parent account exists, same convention as this codebase's other parent/student-only surfaces (e.g. StudentDashboard/ParentPortal).
- **Real bug found and fixed during browser verification:** the propose-alternative form's template dropdown loaded its option list asynchronously after the form mounted; the submit button read a `useState` initializer that only runs once, so on a request's *first* open the button stayed disabled forever (templates hadn't arrived yet) unless the popover was closed and reopened. Fixed with a `useEffect` that syncs the default selection once the list arrives. Confirmed reproduced, then confirmed fixed, against a fresh request in production.

**Definition of done:**
- [x] All three staff actions (accept/decline/propose) work end to end, browser-verified against production (demo tutor account) — accept creates a real enrollment or session, decline just changes status, propose moves the request to `countered` and a requester-side accept resolves it against the *proposed* values, not the original ask.
- [x] All seven gates green (182 unit, 81 RLS, 220 contract [+14 new], build, bundle 199.6KB/260KB, API-bundle 16/16 mounts).

---

## Step 6 — B-09: bulk import (CSV/Excel, column mapping, dry run)

**Goal:** import 200 students in one sitting instead of manual entry — MASTER_PLAN.md's stated reason this is high-value: "the switching cost that loses the deal."

**Corrections found while starting this step** (this document's premises have a real track record of not surviving contact with the code — Steps 4 and 5 both had this too):
- **REDESIGN.md §5.4 does not exist.** Grepped the whole file — no numbered subsections under §5 at all, and no mention of "dedup" or "dry run" anywhere. The dedup-by-phone spec this step cited was never written. The actual dedup rule was decided directly with the founder during this step (see below) rather than discovered in a doc.
- **`papaparse` was mischaracterized as "just sitting in the bundle."** It's already live in production, parsing CSVs in Onboarding's student-import beat (`src/lib/onboarding.ts`'s `parseStudentsCsvRows`, called from `Onboarding.tsx`). That pipeline has no dry-run, no dedup, and a fixed (non-editable) header-alias mapping — this step's column-mapping UI and dedup logic are genuinely new, but CSV parsing itself had a working precedent.
- **"Reuse People.tsx's existing student-creation validation" overstated what was there.** `StudentModal`'s only check is `if (!form.name.trim())`, inline in a form handler — not an extractable pure function. Nothing to reuse directly; the per-row "missing name" check was written fresh in `server/utils/bulkImport.ts`, matching the same convention onboarding's CSV path already uses.

**Dedup rule, decided with the founder mid-step:** a row is a duplicate only when **both name and phone** match an existing student or an earlier row in the same file — a phone match alone doesn't count, since siblings legitimately share a parent's phone. Every flagged duplicate needs an explicit per-row Skip/Import-anyway resolution before it commits; nothing auto-imports and nothing auto-skips. Full reasoning in `server/utils/bulkImport.ts`'s header comment.

**Shipped 2026-09-05:**
- `server/utils/bulkImport.ts` (new): pure, unit-tested (11 cases) header-alias suggestion, per-row mapping/validation, and name+phone dedup detection — no DB, no Express.
- `server/routes/students.ts`: two new routes, `POST /import/inspect` (multer upload, sniffs CSV vs XLSX by real content — zip magic bytes — never the client-declared type, mirroring `documents.ts`; returns detected headers/sample/suggested mapping) and `POST /import` (single endpoint for both dry-run and commit, controlled by a `commit` field — same "field controls behavior" convention as `billing.ts` rather than splitting into two URLs). Row-by-row inserts, not one batch statement, so one bad or plan-capped row reports on itself without failing the rest of the file. `shared/schemas/students.ts` grew the request/response contracts.
- Client: `src/components/BulkImportModal.tsx` (new, standalone file — mirrors Step 5's `BookingRequestsPanel` convention rather than inlining into `People.tsx`), a 3-step wizard (upload → column mapping → dry-run preview with per-duplicate resolution → commit), wired into People's Students lens as an "Import Students" button next to "Add Student."
- **Real bug found and fixed during browser verification, the same class HANDOFF.md §8 already warns about:** the route set `tutor_id` only when the importing user's *org role* was `"tutor"`, leaving it `null` for an owner-run import. `useStudentsList()` (`src/hooks/usePeople.ts`) separately scopes the list to `tutor_id = own id` whenever the user's *person-type* (`role`, a different field — see `AuthContext.tsx`'s own comment distinguishing it from `organizationRole`) is `"tutor"` — true for essentially every solo-tutor demo account regardless of their actual org role. The two conditions look like the same check and aren't. Net effect: a real import created 3 real students that then silently vanished from the importing owner's own People list. Confirmed by direct DB query (rows existed, correct org, correct data) versus the rendered page (only the original 3 showed) versus a temporary debug log (`role: "tutor"` client-side, `role: "owner"` in `organization_members`). Fixed by making `tutor_id` unconditional (`req.user!.id`, matching `People.tsx`'s own `StudentModal`, which already sets it unconditionally for a manual add) rather than gated on org role. Reproduced live, fixed, re-verified live, then a regression assertion was added to the contract suite so a future revert can't silently reintroduce it without a test failing.
- Browser-verified against the demo org's production data (owner-role demo tutor account): uploaded a real 5-row CSV with mixed headers (`Mobile`, `Parent`, `Parent Mobile` — not the exact target field names) via a simulated file drop (the pane's headless file chooser can't be driven directly; a real `File` + `DataTransfer` + `change` event exercises the exact same upload code path a native file pick would). All 6 target columns auto-mapped correctly. Dry-run correctly showed 3 ready / 1 duplicate (flagged against an earlier row in the same file) / 1 error (missing name); commit produced exactly that outcome, then the created students correctly appeared in the live People list once the `tutor_id` bug above was fixed. Throwaway rows deleted afterward to leave production demo data clean; the `students.bulk_import` audit rows were left in place per this codebase's append-only audit convention.

**Definition of done:**
- [x] Dry-run mode never writes to the database — contract-tested (`tests/contract/studentImport.test.ts`) that a dry-run request produces zero new `students` rows.
- [x] A malformed/duplicate row is reported per-row, not a whole-file failure — contract-tested for both a missing-name row and a within-file duplicate.
- [x] Browser-verified with a real CSV against the demo org (see above).
- [x] All seven gates green (193 unit [+11], 81 RLS, 232 contract [+12], build, bundle 200.3KB/260KB, API-bundle 16/16 mounts).

---

## Step 7 — B-05: self-serve parent top-up

**Goal:** top-up is staff-only today; let a parent top up their own child's wallet.

**Scope confirmed as written** — no premise correction needed this time. `/wallets/topup` (staff-only, `CAN_MONEY`) stayed untouched; this added a second, parent-only route rather than widening the existing one's role check, because the two are semantically different money paths (staff records money already received, in cash/UPI/etc.; a parent can never self-report an amount into their own balance — that's a fraud vector, same as `recordManualPayment` having no parent-facing equivalent). It also had to close a real gap the plan's scope note didn't anticipate: the Razorpay webhook handler (`server/routes/webhooks.ts`) was entirely invoice-shaped — a wallet top-up payment link would have gone through Razorpay fine but never actually reached the wallet, since `handleEvent()` only ever looked up an `invoiceId`.

**Shipped 2026-09-05:**
- `shared/schemas/billing.ts`: `walletTopupLinkRequestSchema`/`WalletTopupLinkResponse`.
- `server/routes/billing.ts`: new `POST /wallets/topup-link`, parent-only (`req.user!.role !== "parent"` → 403), checks the caller is actually linked to the target student via `parent_links` before minting a link (mirrors `/invoices/:invoiceId/pay`'s exact pattern), 422s `gateway_not_connected` if the org has no Razorpay creds. The created Razorpay payment link carries `notes.type = "wallet_topup"` + `notes.studentId` instead of an invoiceId, since there's no invoice to reference.
- `server/routes/webhooks.ts`: `handleEvent()` now branches on `notes.type === "wallet_topup"` *before* its invoice-id lookup (which would otherwise try to query `invoices` with a synthetic reference string and error, not just miss). The new `handleWalletTopupPayment()` credits `wallets.balance_currency` and writes a `wallet_ledger` row (type `credit_currency`, reason `topup`, `by: 'razorpay_webhook'`) — same shape the existing staff-only manual topup writes, and deliberately writes nothing to `payments` (that table was never used for wallet top-ups even on the manual path). Idempotent via `wallet_ledger`'s own unique `(organization_id, idempotency_key)` index, keyed `rzp_<paymentId>` — same scheme as the invoice path's `payments` table, just a different table's constraint.
- Client: `src/lib/api.ts`'s `topUpWalletAsParent()`, and a small amount-input-plus-button in `ParentPortal.tsx`'s existing Wallet tab (`t("parentPortal.*")`, a new locale namespace — this page has almost no other i18n coverage, matching Step 3's precedent of adding a properly namespaced key for new work without retrofitting the whole file).
- **Known gap, explicitly out of scope:** `/billing/reconcile`'s poll only scans `invoices.payment_link`, so a wallet-topup link whose webhook delivery is somehow lost has no reconciliation safety net the way invoice payments do. Not fixed here — the whole feature is unverifiable live until Razorpay connects anyway (same founder deferral), and extending reconcile for a link type that's never been exercised against a real gateway isn't worth the risk of an unverifiable change. Flagged here for whoever wires up live Razorpay keys.

**Definition of done:**
- [x] A parent can only top up their own linked students' wallets, never another family's — contract-tested (`tests/contract/walletTopupLink.test.ts`): 401 no token, 403 non-parent role, 403 parent not linked to the target student (a second student with no `parent_links` row at all), 422 `gateway_not_connected` for a linked parent, 422 validation for a non-positive amount.
- [x] Degrades to `gateway_not_connected` cleanly today — contract-tested; the outbound Razorpay-connected success path is code-reviewed only, same convention as the existing payment-link footer. The *inbound* webhook settlement side, which needs no live gateway account, IS fully contract-tested (`tests/contract/webhooks.test.ts`'s new "wallet top-up" describe: credits the wallet, writes the ledger row, never touches `payments`/`invoices`, is idempotent on redelivery, writes the audit row, ignores a student that doesn't belong to the org).
- [x] All seven gates green (193 unit, 81 RLS, 242 contract [+10], build, bundle 200.3KB/260KB, API-bundle 16/16 mounts).

---

## Step 8 — Needs you: D-07, credit expiry period

**Decided 2026-09-05 (founder), via a decision-prep session.** The plan's original recommendation was "per-org configurable within a platform cap," mirroring D-08. The founder went narrower on both ends:

- **Per-org, set by the center.** Each org sets its own credit-expiry window in Settings.
- **No platform default.** Until a center configures a window, its credits never expire (today's behaviour). Expiry is an opt-in per org, not a number the platform imposes on everyone. Most orgs never touch Settings (see Step 1's note), so in practice most credits stay immortal until a center makes a deliberate choice.
- **No floor and no cap.** A center can set any window it wants. The founder explicitly declined a minimum (e.g. a 90-day floor to stop a predatory-short expiry) and a maximum.
- **Clock runs from each top-up / purchase date, not from last activity.** This is the load-bearing detail for Step 9: a single scalar balance plus one jsonb settings key (D-08's shape) is not enough. Step 9 needs per-lot tracking, walking `wallet_ledger` credit-lots FIFO and expiring the unconsumed remainder of any lot past its window.

MASTER_PLAN.md §5 D-07 row and §3 B-04 row updated to match.

---

## Step 9 — B-04: credit expiry policy

**Shipped 2026-09-05:**
- **No migration.** Same outcome as Step 1: `organizations.settings` is already client-writable jsonb through the owner/admin-gated `org_update` RLS policy, so `creditExpiry` is just a new top-level key (`{ enabled, windowDays }`); `wallet_ledger.type` has no CHECK constraint so the new `credit_expiry` literal needs none (same as Step 2's `credit_reversal`); the idempotency guard is `wallet_ledger`'s existing partial-unique `(organization_id, idempotency_key)` index (`20260709020900_rls_fixes.sql`), keyed `credit_expiry_<lotLedgerId>_<c|p>`; warning-notification dedup rides the existing `notifications` table. Nothing to push to production.
- **`shared/creditExpiry.ts`** (new, Zod-free — same rule as `shared/cancellationPolicy.ts`/`shared/money.ts`): `resolveCreditExpiryPolicy()` (enabled only when `enabled === true` AND a positive whole-day window; no floor, no cap, per the founder) and `computeCreditExpiry(ledgerRows, windowDays, now)` — the pure **on-the-fly FIFO lot walk**, chosen over a `wallet_credit_lots` table (option (a) in the plan): every positive `wallet_ledger` delta is a dated lot, every negative delta (including a prior run's own `credit_expiry` row) draws down the oldest open lots first, and any lot still holding an unspent remainder past `lot.at + windowDays` is broken. `credits` and `paise` are tracked as independent queues since a ledger row only ever carries one. An attendance reversal's credited-back currency starts a *new* lot dated at reversal time — the conservative choice (never expires money the center just returned).
- **`server/utils/creditExpiry.ts`** (new): re-exports the shared logic + the server-only `getCreditExpiryPolicy(orgId)` DB read, mirroring `server/utils/cancellationPolicy.ts` exactly.
- **`server/routes/cron.ts`**: new `POST /api/cron/expire-credits`, same `CRON_SECRET` gate as Step 4's `/reconcile-wallets` and `/reporting-daily` (no new route mount — still 16/16). Selects only orgs with `settings -> 'creditExpiry' ->> 'enabled' = 'true'`, re-resolves the policy per org (skips a toggled-on org with a zero/garbage window), walks each wallet's ledger, and in a per-wallet `withTransaction`: writes a negative-delta `credit_expiry` row per broken lot (idempotency pre-check like `/wallets/topup`), decrements `balance_credits`/`balance_currency` to match so B-03's `balance == ledger sum` invariant still holds, and writes one `wallet.credit_expiry` audit row per affected wallet. Then fires 30-day / 7-day warning notifications (`type: "wallet_credit_expiring"`, `payload.title` set server-side since cron can't reach `t()`) to every linked parent + the student's own login, deduped on `(lotLedgerId, stage, denom)` against notifications already written so a daily cadence never re-notifies. Never deletes.
- **`src/components/OrganizationSettings.tsx`**: new "7. Credit Expiry" section (checkbox + days input, input disabled and helper text switches to "prepaid credit never expires" when off), mirroring section 6's pattern. `src/locales/en.json` gained `inbox.notificationType.wallet_credit_expiring` (the notification also always carries `payload.title`, which `Inbox.tsx`'s `NotificationRow` prefers anyway).
- **Verification.** All seven gates green (see below). A throwaway `tests/contract/expireCredits.test.ts` drove the real HTTP route through the real Express app against PGlite (real Postgres, every migration applied) — 7 cases: no-config untouched, toggled-on-zero-window untouched, partial-lot remainder expiry (₹500 lot, ₹300 spent → ₹200 broken) with the `credit_expiry` row + idempotency key + wallet decrement + `balance == ledger sum` + audit row all asserted, idempotent re-run writes nothing further, 7-day warning fires once to parent+student then not again, cross-org isolation — then deleted (cron routes are outside the permanent contract suite, same as Step 4; copy retained in the session scratchpad). Live end-to-end against the production Supabase project via `npm run dev:preview` + `curl`: 404 with no / wrong `x-cron-secret`, `200 {"ok":true,"orgsProcessed":0,"walletsChecked":0,...}` with the configured secret — confirms auth-gating, query execution and response shape against real infra, exactly as far as Step 4's `/reconcile-wallets` got (production has 0 wallets and 0 opted-in orgs). The live seed-an-old-lot-and-watch-it-expire walkthrough against the demo org was **not** done: it needs a direct production DB write (the demo org has no wallet and no browser surface mints wallet credit — `/wallets/topup` is staff-only and Razorpay is deferred), which this session's tooling blocks. Same standing gap Step 4 flagged ("Worth re-running once a real org has wallet activity"); the PGlite pass covers the money math against a real Postgres engine in the meantime.

**Goal:** per-org window with warning notices before lapse. Today credits are immortal — MASTER_PLAN.md calls this "an unbounded liability with no revenue-recognition point."

**Scope (Step 8 now decided — 2026-09-05):**
- **Settings:** a new `creditExpiry` key on `organizations.settings` (same client-writable jsonb pattern as D-08's `cancellation`). Shape roughly `{ enabled: boolean, windowDays: number }`. When absent or `enabled: false`, the org's credits never expire. No clamp on `windowDays` (founder chose no floor, no cap).
- **Per-lot tracking:** the founder's "expiry runs from each top-up date" means you cannot expire against a single scalar balance. Credits arrive as `wallet_ledger` rows; consumption must be attributed FIFO to specific lots so the job knows how much of each dated lot is still unspent. Decide during implementation whether to (a) compute this on the fly from the full ledger each run, or (b) add a lightweight `wallet_credit_lots` table maintained alongside the ledger. (a) is less schema surface and matches B-03's "diagnostic reads the ledger" instinct; (b) is cheaper per run once wallets have long histories. Lean (a) unless the ledger walk is provably too slow.
- **Cron job:** new endpoint in `server/routes/cron.ts`, same `CRON_SECRET` pattern as Step 4's reconciliation and `/reporting-daily`. Skips any org with no `creditExpiry` or `enabled: false` entirely. For opted-in orgs: find lots past `windowDays` from their top-up date, expire the unspent remainder by writing a `wallet_ledger` row (type `credit_expiry`, a breakage entry) and decrementing the wallet balance. Never silently deletes.
- **Warnings:** fire a notification via the existing `notifications` surface at 30 days and 7 days before a lot lapses, per org. Not silent.
- **Migration:** goes straight to production (no staging, per Step 11's deferral) — same caution as every other R1 migration.

**Definition of done:**
- [x] An org with no `creditExpiry` set has its wallets untouched by the job — throwaway contract test (cron routes are outside the permanent suite, same as Step 4).
- [x] An opted-in org: a lot past its window is expired down to its unspent remainder (not the whole lot if partly consumed), a `credit_expiry` ledger row is written, the wallet balance matches the ledger sum afterward (don't break B-03's reconciliation) — throwaway contract test.
- [x] The 30/7-day warning notifications fire once each, not on every run — throwaway contract test (7-day case; 30-day path is the same code, unit-tested in `tests/unit/creditExpiry.test.ts`).
- [~] Browser-verified against the demo org — **not done, same blocker as Step 4.** The route was invoked live against production (secret-gating + response shape confirmed, 0 wallets / 0 opted-in orgs); a live expire-an-old-lot walkthrough needs a direct production DB write this session's tooling blocks and no browser surface mints wallet credit. Money math verified against a real Postgres engine via the throwaway PGlite pass. Revisit once a real org has wallet activity.
- [x] All seven gates green.

---

## Step 10 — B-11: DPDP consent centre and per-student erasure

**Shipped 2026-09-05:**

**Premise correction (this document's track record holds — Steps 4/5/6/9 all had one).** The scope note said "consent is currently implicit despite the portal stamping a `consentVersion`." There is no `consentVersion` anywhere in the codebase. Consent was a bare `z.literal(true)` on the parent-invite redeem request (`shared/schemas/parents.ts`), validated and then dropped on the floor — nothing persisted, no version, no timestamp. Confirmed by grepping the whole tree.

**Founder decisions taken mid-step (2026-09-05), all narrower/more concrete than the plan guessed:**
- **Erasure model — wipe personal, keep the money trail.** Hard-delete `student_notes`, `assessments`, `enrollments`, `parent_links`, `session_requests`, `parent_invites`, `student_invites`, `documents` (rows + the underlying Storage objects). Anonymize the `students` row in place — every identifying column nulled, `name` → `'Erased student'`, `student_user_id` detached, `is_deleted = true`, `erased_at`/`erased_by` stamped. Leave `invoices`/`payments`/`refunds`/`wallets`/`wallet_ledger`/`attendance_records` untouched (they carry no PII once the students row is scrubbed, and they're inside the 8-year window). The anonymized stub keeps every financial FK resolvable and B-03's `balance == ledger sum` invariant intact.
- **Leftover wallet balance — per-centre setting** (`organizations.settings.erasure.walletPolicy`, `"block"` default or `"writeoff"`). Block → erasure 409s while the wallet is non-zero, staff clear it through the existing Money surfaces. Writeoff → a single balanced pair (a negative `wallet_ledger` row `type='erasure_writeoff'` + the matching balance decrement) zeroes it, then erasure proceeds.
- **Authority — owner + admin**, type the student's exact name to confirm (re-checked server-side), same posture as org offboarding.
- **Consent centre — persist a consent record now.** New `consent_records` table, one row written per parent/student invite redeem, stamped with `CONSENT_VERSION` (`shared/consent.ts`). The *document* that version points at is still a legal deliverable, still not drafted — logged to MASTER_PLAN.md §8, out of engineering scope as the plan said.

**Migration** `20260905130000_dpdp_consent_erasure.sql` (**pushed straight to production** — B-10 held, `supabase db push`, `--dry-run` confirmed only this one file pending; no staging, same discipline as Steps 2/4/5): `consent_records` (server-write-only — no insert/update/delete policy, same as `audit_events`; select = own rows or org staff, via `is_staff()`), plus `students.erased_at`/`erased_by`. RLS tests land in the same PR (`tests/integration/consentErasure.test.ts`, +8).

- **`shared/consent.ts`** / **`shared/erasure.ts`** (both Zod-free, same rule as `shared/creditExpiry.ts`): `CONSENT_VERSION` constant; `resolveErasurePolicy()` (fail-safe — any non-`"writeoff"` value resolves to `"block"`, never move money on garbage).
- **`server/utils/erasure.ts`**: `eraseStudentTx(client, …)` — the whole table-by-table erasure inside the caller's transaction, throwing a typed `ErasureError` for the two guard failures (already erased → 409, non-zero wallet under `block` → 409). Detached portal-login uids are `array_remove`'d from *future scheduled* `class_sessions` only; past rosters are left as the historical record. `consent_records.student_id` for the erased student is nulled (the consent fact is kept, its link to the student is not). Storage objects are deleted after the tx commits, best-effort (Storage isn't transactional). `getErasurePolicy(orgId)` mirrors `getCreditExpiryPolicy`.
- **`server/routes/students.ts`**: new `POST /api/v1/students/:studentId/erase` (owner/admin, `requireOrg`, type-to-confirm) — **no new route mount**, still 16. The student-redeem transaction now also writes a `consent_records` row (`role: 'student'`).
- **`server/routes/parents.ts`**: the redeem transaction now persists the `consent` it already validated (`role: 'parent'`).
- **Client**: `src/lib/erasure.ts` (`canConfirmErase`), `src/lib/api.ts` (`eraseStudent`), an owner/admin-only "Erase student data" row action + type-to-confirm modal in `People.tsx` (`EraseStudentModal`), and a "8. Data Erasure (DPDP)" section in `OrganizationSettings.tsx` (the wallet-policy select). All strings through `t()` (`src/locales/en.json`, `people.erase*`).
- **Tests**: `tests/contract/studentErasure.test.ts` (+10 — 401/403/404-cross-org/422-name-mismatch, the full happy path asserting PII wiped + academic rows deleted + financial rows kept + B-03 invariant + audit row, 409 re-erase, 409 block-policy with a balance, the writeoff path with its ledger row, and future-session detach), plus consent-record assertions added to the existing `parents.test.ts` / `students.test.ts` redeem tests, plus `tests/unit/erasure.test.ts` (+4).
- **Verification.** All seven gates green (below). **Live walkthrough against production (demo owner account):** the "8. Data Erasure (DPDP)" Settings section renders; created a throwaway student "ZZ Erasure Test" through the app's own Add-Student modal, erased it via the new row action + type-to-confirm modal, confirmed the success toast, its disappearance from the People list, and a real `student.erased` audit-log entry (`students · b08428c2`, actor Demo Tutor). **Not** directly asserted against the live DB: the row-level anonymization / hard-delete / B-03-invariant details — this session's tooling blocks direct production DB reads and writes (same standing gap as Steps 4/9). Those are covered exhaustively by the throwaway-free `studentErasure.test.ts` contract suite against PGlite (a real Postgres engine, every migration applied). The erased anonymized stub row is left in the demo org — that *is* the correct end state of an erasure (an `is_deleted` stub with no PII, invisible in every app query), not test residue that can be cleaned up without breaking the retention model.

**Goal:** statutory. Org-level export exists (`server/routes/orgExport.ts`); per-student erasure does not, and consent is currently implicit despite the portal stamping a `consentVersion`.

**Scope:** two halves. (a) Per-student erasure: mirror `orgExport.ts`'s existing offboarding-adjacent patterns but scoped to one student — this touches financial-history retention rules (HANDOFF.md's 8-year retention note, GO_TO_MARKET_BLUEPRINT.md §8.2), so erasure almost certainly means anonymize-in-place for financial records and hard-delete for everything else, not a blanket delete. (b) Consent centre: the document `consentVersion` already points at doesn't exist yet — that's a **legal** deliverable (GO_TO_MARKET_BLUEPRINT.md §8's DPDP checklist), out of engineering scope; flag it back to the GTM checklist (MASTER_PLAN.md §8) rather than drafting legal text in this step.

**Definition of done:**
- [x] Per-student erasure request removes/anonymizes correctly, verified against a throwaway student in the demo org (browser walkthrough: created → erased → gone → audit row). Financial-record reconcilability (B-03's `balance == ledger sum`) asserted in the contract suite, including the `writeoff` path — direct prod-DB confirmation blocked this session, same gap as Steps 4/9.
- [x] Consent-document gap explicitly logged back to MASTER_PLAN.md §8 as still open, not silently dropped (and a `consent_records` table + `CONSENT_VERSION` now persist the trail — the founder chose to build this rather than defer the whole half).
- [x] All seven gates green.

---

## Step 11 — Needs you: B-10, staging environment

**Deferred 2026-09-05 (founder: hold), via a decision-prep session.**

The spend was never the blocker: a second Supabase project is $0/mo if the org stays on the Free plan (Free allows 2 projects/org) or ~$10/mo (~₹850) if on Pro, and a second Vercel preview environment is included at no extra cost on any Vercel plan. The real cost is ~1.5-2.5 engineering days to wire it up (create the project, `supabase db push` all 32 migrations against an empty DB — itself the first test that the set applies clean from zero — seed it including a demo parent account that prod deliberately lacks, a second Vercel env pointed at it, re-verify the realtime-publication migrations, first-ever Storage upload test, update `supabase/README.md` / `.env.example` / HANDOFF's "no staging" note).

The founder chose to hold. **Consequences carried forward, to be logged as an explicit deferral at Step 13:**
- R1 migrations keep going straight to production (as Steps 1-7 did).
- Parent-facing surfaces (Step 3's `ParentPortal` disclosure, Step 5's requester counter-offer, Step 7's parent top-up) stay unverifiable in a browser — no demo parent account exists on prod.
- Supabase Storage upload/download stays untested anywhere.
- The migration set has never been applied from zero.
- No rehearsed rollback for a bad migration, and R1/R2 both keep shipping them.

Revisit before starting R2 (B-06 is a real migration against live identity data and MASTER_PLAN.md §3 R2 says do not start it before staging exists).

---

## Step 12 — Needs you: external pentest + leaked-password protection

Two different asks bundled because they're both "needs you, not engineering," not because they're related.

**External pentest — deferred to pre-GTM procurement (founder decision 2026-09-05).** Not an R1 engineering blocker; it moves into the same long-lead GTM-procurement bucket as WhatsApp templates, DLT, Razorpay KYC and Google OAuth verification (MASTER_PLAN.md §8, §10). Still a real third-party manual engagement — do not accept an automated-scanner substitute (DEV_PLAN.md §2.2 is explicit). Vendor shortlist from the decision-prep session, for when quotes are wanted: **Astra Security** (Bengaluru, CERT-In empanelled, PCI-DSS/ISO27001/SOC2 aligned, ~₹1.5-4L for a real manual web+API test, ~2-3 wks, free retest + public certificate), **SecureLayer7** (Pune, researcher-led, business-logic/API/auth focus, strong fintech track record, ~₹2-5L on quote, ~2-4 wks, video evidence + retest), **Indusface** (Bengaluru, manual pentest layered on the AppTrana scanner platform, good if ongoing WAF/monitoring is also wanted). Reject any quote under ~₹40k with a 1-2 day turnaround: that is a relabelled scanner.

**Leaked-password protection — deferred to pre-GTM (founder decision 2026-09-05).** A one-toggle change in the Supabase dashboard (project `cwugpiernnwrhcximjwh` → Authentication → Sign In / Providers → Password → "Prevent use of leaked passwords" / HaveIBeenPwned check). DEV_PLAN.md §2.2 calls this the one open gap in an otherwise-closed security posture, and it is explicitly "not a blocker today." The founder chose not to action it now; it rides along with the auth items on the GTM checklist (MASTER_PLAN.md §8 "Auth"). No code, no engineering session, does not block anything in R1.

---

## Step 13 — R1 gate checkpoint

Once Steps 1-12 are checked (or explicitly deferred with a reason, same discipline as every other deferral in this project's history — see MASTER_PLAN.md §3's "R1 gate" paragraph), re-verify the whole gate as one pass rather than trusting each step's individual green run in isolation:

- [x] A mis-marked attendance can be fully reversed by an owner, wallet/invoice/ledger all agreeing afterward (Step 2, re-walked end to end). **Re-walked live against production 2026-09-05** — see the completion note below.
- [x] The reconciliation job (Step 4) runs clean against production. **Re-run live 2026-09-05:** `200 {"ok":true,"walletsChecked":0,"mismatches":0}` with the configured `x-cron-secret`, `404` without it. Production still has 0 wallets, so still not exercised against real drift (Step 4's standing note holds).
- [x] A parent tops up their own wallet without a staff member (Step 7 — or confirmed still gated on Razorpay, which is fine, just confirm the degradation path is real). **Degradation path re-confirmed live 2026-09-05:** `POST /api/v1/billing/wallets/topup-link` as a non-parent → `403 "This endpoint is for parent accounts"`. Full parent path still unexercisable (no demo parent account, no Razorpay creds); inbound webhook settlement is contract-tested. Step 7's notes remain honest.
- [x] A 200-student centre imports in one sitting (Step 6). **UI re-confirmed 2026-09-05** (the 3-step Import Students wizard opens from People → Students); full CSV → dry-run → commit was live-walked 2026-09-05 with code byte-identical since, 12 contract cases green, and the 3 `students.bulk_import` audit rows from that walk still in the log.
- [x] ~~Staging exists (Step 11) and every migration shipped in Steps 1-10 was rehearsed there first~~ — **explicitly deferred 2026-09-05 (founder: hold on B-10).** This gate line is **not met** and is not being met for R1; R1 is **not** treated as failing the gate on it. Accepted consequences carried forward from Step 11: (a) R1 migrations go straight to production unrehearsed (as Steps 1-10 did — 20260806100000, 20260905120000, 20260905130000, and the no-migration jsonb-key changes); (b) parent-facing surfaces (Step 3 `ParentPortal` disclosure, Step 5 requester counter-offer, Step 7 parent top-up) stay browser-unverifiable — no demo parent account on prod; (c) Supabase Storage upload/download stays untested anywhere; (d) the migration set has never been applied from zero against an empty DB; (e) no rehearsed rollback for a bad migration. **Hard trigger: staging must exist before R2 / B-06** (the live-data identity migration — MASTER_PLAN.md §3 R2 says do not start it before staging exists).
- [x] External pentest and leaked-password protection — **both deferred to pre-GTM 2026-09-05 (Step 12).** Neither is a condition on the R1 gate. External pentest → pre-GTM procurement bucket (vendor shortlist in Step 12: Astra Security / SecureLayer7 / Indusface; reject any sub-₹40k / 1-2 day "scanner" quote; no automated-scanner substitute). Leaked-password toggle → one Supabase dashboard switch, no code, rides the MASTER_PLAN.md §8 "Auth" checklist; do not re-surface it as an action item. Both tracked in MASTER_PLAN.md §8.
- [x] Update MASTER_PLAN.md: mark R1 complete, move its "What to do next week" (§10) to R2's opening moves, and start this document's R2 section. **Done 2026-09-05** — MASTER_PLAN.md §3 R1 marked complete, §10 rewritten as R2's opening moves, R2 scaffold added below (steps written once founder decisions D-02/D-03/D-05/D-06 and B-06/B-07 scoping land — not guessed ahead).

---

**Completed 2026-09-05 — R1 gate met (with the two founder-deferred lines recorded above, not counted as failures).**

**All seven gates re-run clean off the top of the stack** (`r1-step-10-dpdp-consent-erasure`, working tree clean, commit `1817bc1`):

| Gate | Command | Result |
|---|---|---|
| Typecheck | `npm run lint` | clean |
| Unit | `npm test` | 211/211 (20 files) |
| RLS / authorization | `npm run test:rls` | 89/89 (5 files) |
| Route contracts | `npm run test:contract` | 252/252 (19 files) |
| Build | `npm run build` | passes, `dist/server.js` 184.4 KB |
| Bundle budget | `npm run check:bundle-size` | 200.7 KB gzip, budget 260 KB |
| API bundle | `npm run build:api && npm run check:api-bundle` | 16/16 route mounts present |

Every number matches HANDOFF.md §2 except the server bundle (184.4 KB measured vs 184.9 KB recorded — 0.5 KB / 0.3 %, a non-budgeted metric, code unchanged; measurement drift, HANDOFF.md updated to 184.4). The committed `api/index.js` rebuilt byte-identical (no stale-artifact drift).

**Money-touching flows re-walked live against the production Supabase project (`cwugpiernnwrhcximjwh`) via `npm run dev:preview`, demo owner account:**

1. **Attendance reversal, end to end.** Created a throwaway ONE_ON_ONE / PER_SESSION session for today (₹300, one student) through the Add Class wizard → marked the student present via the Today roster popover (`POST /api/v1/billing/attendance` → 200) → a ₹300 invoice (`INV-6F3055`) accrued, Money → Outstanding moved ₹100 → ₹400 → reversed through the app's own authenticated `api()` client (`POST /api/v1/billing/attendance/reverse`, `reason: "cancellation"` — no dedicated UI, same as the 2026-08-06 walk) → `{ reversalPath: "invoice_voided", creditedPaise: 0, creditedCredits: 0 }` → Money → Outstanding back to ₹100 → Audit log shows `attendance.mark` → `attendance.reverse` on session `c97f5651` → a second reverse call → `409 already_reversed` (idempotency guard holds). The wallet credit/currency paths were not re-exercised live (production has 0 wallets) but are covered by the 9 contract cases (green) and unchanged since 2026-08-06. Residue: the throwaway session remains as a `completed` session with a voided invoice — completed sessions have no cancel affordance and direct prod-DB deletes are blocked this session (same constraint as Steps 4/9/10); it is absent from every money surface.
2. **`/api/cron/reconcile-wallets`** — `404` with no/wrong `x-cron-secret`; `200 {"ok":true,"walletsChecked":0,"mismatches":0}` with it. Clean against real infra; 0 wallets so no real-drift exercise (Step 4's note stands).
3. **`/api/cron/expire-credits`** — `200 {"ok":true,"orgsProcessed":0,"walletsChecked":0,"lotsExpired":0,"creditsExpired":0,"paiseExpired":0,"warningsSent":0}`. 0 opted-in orgs, 0 wallets (Step 9's note stands).
4. **Bulk import** — Import Students wizard opens from People → Students; full path live-walked 2026-09-05, code identical since, 12 contract cases green.
5. **Parent top-up degradation** — `POST /api/v1/billing/wallets/topup-link` as a non-parent → `403 "This endpoint is for parent accounts"`. Route live and role-gated; full parent path still blocked on no-demo-parent + no-Razorpay exactly as Step 7 records.
6. **Per-student erasure** — created a throwaway student through the Add-Student modal → "Erase student data" row action → type-to-confirm modal (correct DPDP copy) → `POST /api/v1/students/53e30338…/erase` → 200 → gone from the People list → Audit log `student.erased · students · 53e30338`. Row-level anonymize/hard-delete asserted only by `studentErasure.test.ts` (10 cases, green) — direct prod-DB read blocked this session, same as Step 10. The anonymized stub is the correct erasure end state, not residue.

**Also re-checked live:** the Step 3 cancellation-policy disclosure renders in the staff `SessionPopover` ("Free cancellation until 30 Aug 2026, 06:30 pm. After that, a 50% fee applies." — coded defaults 24h / 50%). The `Layout` hook-order console warning (logged in the session memory) did **not** reproduce anywhere across a full click-through of Today, Schedule, People, Money, Audit log and their popovers/modals/wizards — consistent with the 2026-07-26 investigation; the only console errors were the placeholder Sentry DSN and the intentional 409 test.

**One issue found during the re-walk, flagged to the founder, not fixed (larger than a small fix):** `is_deleted = true` student rows — both archived students and B-11 erased stubs (name `"Erased student"`) — leak into ~10 client-side `from("students").select(...)` sites that don't filter them: `CommandPalette.tsx`, `Schedule.tsx`'s Add Class wizard, `useInbox.ts` (messageable contacts), `useMoney.ts` (invoice pickers), `Today.tsx`, `useStudentStory.ts`, `Documents.tsx`, `ParentPortal.tsx`, `Onboarding.tsx`. Only `usePeople.ts` and one `useInbox.ts` query filter `is_deleted`. Pre-dates B-11 (archive already had this) but B-11 makes it conspicuous. Not an R1-gate blocker — erasure itself is correct (PII wiped, financial trail intact); this is a stub leaking into secondary pickers, no PII exposed. Needs per-site product judgment (some sites legitimately load an erased row by id to render "this record was erased"), so not a blanket `.eq("is_deleted", false)`.

**Merge of the four-branch stack to `main`: pending founder decision** (stack: `r1-step-10-dpdp-consent-erasure` → `r1-step-9-credit-expiry` → `r1-steps-6-7-bulk-import-parent-topup` → `main`, none merged).

---

# ClassStackr Execution Plan — R2 (scaffold)

**Status: not startable yet.** R1's gate is met (Step 13), which is the trigger to *begin* this section — but R2's steps cannot be written in executable detail until two things land, exactly as the top-of-document scope note says:

1. **Staging (B-10) must exist.** MASTER_PLAN.md §3 R2 is explicit: B-06 is a real migration against live identity data, do not start it before staging. Step 11's deferral carried a hard trigger to here. Standing up staging is the first R2 work item regardless of the founder decisions below (it was ~1.5-2.5 eng-days when scoped: create the second Supabase project, `supabase db push` all migrations against an empty DB — itself the first from-zero test — seed it *including a demo parent account* prod lacks, a second Vercel env, re-verify the realtime-publication migrations, first Storage upload test, update `supabase/README.md` / `.env.example` / HANDOFF's "no staging" note).
2. **Founder decisions D-02, D-03, D-05, D-06 (MASTER_PLAN.md §5) must be answered** where they touch R2 — D-05 (can a student transact without a parent?) directly gates R2's session-request → parent-approval routing; D-02/D-03 are mostly R3 but shape B-08's wallet/invoice ownership model. D-01 is decided (single-member org, no schema fork) and already unblocks B-06's shape.

**R2 thesis (from MASTER_PLAN.md §3):** make identity org-independent — one login, many memberships. Gate: one human account teaches independently on Tuesdays and at a centre on Thursdays, switches context without logging out, neither org can book over the other; a parent with children at two centres sees one home screen; a centre runs a payout cycle in-product.

**R2 backlog, in dependency order (to be turned into numbered steps once the two blockers above clear):**

| ID | Item | ed | Blocked on |
|---|---|---|---|
| R2-0 | Staging environment (B-10) | 2 | founder go-ahead only |
| B-06 | Person-centric identity: one login, many memberships; independent tutor as a single-member org (D-01 decided) | 8 | staging; needs its own scoping pass |
| B-07 | Org switcher + cross-org conflict checking | 5 | B-06; needs its own scoping pass |
| B-08 | Tutor payouts & earnings ledger (serves org payroll now, marketplace payouts in R3) | 6 | B-06; partly D-02 |
| B-12 | Monthly progress-report PDF | 3 | — (could pull forward) |
| B-13 | Substitute & leave management | 4 | B-06 |

**Also in R2, from the spec v2 IA tabs:** the assignment-marking loop into the gradebook (upload works, marking doesn't, both sides); guardian records moving from student-owned to parent-owned; cross-org family view for parents; student session-requests routed to a parent for approval below the D-05 age threshold.

Do not expand this into executable steps ahead of the blockers — that is the guessing the top-of-document scope note warns against. Next action when R2 starts: scope B-06 against the real `tutor_profiles`/`parent_profiles`/`student_profiles` schema (all PK'd on `user_id` with NOT NULL `organization_id` today) and write R2-0 + B-06 as full steps.
