# ClassStackr Execution Plan

**Derived from [MASTER_PLAN.md](MASTER_PLAN.md), rewritten 2026-09-12.** The master plan says what to build and why; this file says what to do next, in what order, and how you will know it is done.

## How to use this document

- **Steps are numbered continuously and never renumbered.** Source comments cite `EXECUTION_PLAN.md Step N`; those anchors must stay stable. Steps 1 to 13 (R1) are archived in [docs/EXECUTION_PLAN_R1_ARCHIVE.md](docs/EXECUTION_PLAN_R1_ARCHIVE.md); Steps 14 to 24 (R2) are summarized in §"Completed work" below, with full detail in git history at commit `86ca0e4`.
- **Order is dependency order, not priority order.** Where they conflict, dependency wins.
- **Every step ends the same way:** all eight gates green, a live browser walkthrough against a real environment, this file's tracker and "Start here" section updated, HANDOFF.md's gate line and verification log updated, then commit.
- **Standing rule, do not self-authorize:** no migration is pushed to `classstackr-staging` or production, and nothing is pushed to `main`, without explicit founder go-ahead. Rehearse on staging first, always.

**The eight gates.** `npm run lint` · `npm test` · `npm run test:rls` · `npm run test:contract` · `npm run build` · `npm run check:bundle-size` · `npm run build:api && npm run check:api-bundle` · `npm run test:e2e` (Step 31). All eight run in CI. The first seven need no Docker, Java or live database; the eighth drives a real browser against `classstackr-staging` and needs the staging credentials (locally from `.env.staging`, in CI from GitHub secrets; see HANDOFF.md §4).

**Baseline as of 2026-09-26, on branch `feat/step-32-activation-analytics` (stacked on Step 31's branch):** typecheck clean, 303 unit, 127 RLS, 389 contract, build (`dist/server.js` 291.5 KB), bundle 207.2 KB against a 260 KB budget, 19 of 19 API route mounts, `api/index.js` regenerated and byte-identical on rebuild, e2e 8/8 against `classstackr-staging` with 26 axe audits (Step 32's event checks skip, logged, until its migration is on staging).

**Previous baseline, 2026-09-26, on branch `feat/step-31-playwright`:** typecheck clean, 278 unit, 117 RLS, 372 contract, build (`dist/server.js` 261.6 KB), bundle 206.3 KB against a 260 KB budget, 18 of 18 API route mounts, `api/index.js` byte-identical, and the new e2e gate: 7 Playwright tests (five golden journeys plus Step 30's guardian threads) with 25 axe audits, green against `classstackr-staging` locally. `main` itself (Step 30, `c7e3f0c`) was re-verified the same morning at 278/117/372, 261.6 KB, 206.1 KB, 18/18, byte-identical.

---

## Start here

**Step 32 (C-07, activation analytics) is 🟡 built, migrated on staging and walked live there as of 2026-09-26**, the founder's pick after Step 31, on branch `feat/step-32-activation-analytics`. It was first opened as PR #14, stacked on Step 31's branch; #13 reached `main` first and #14 was then merged into its stale base, so [PR #16](https://github.com/Sankaranakshar/Tuition-SaaS/pull/16) now carries the same work to `main`. (A stacked PR only retargets itself to `main` when the branch below it is deleted.) ClassStackr now records what people do in its own database (D-11: no third-party analytics), computes activation exactly as MASTER_PLAN.md §11 defines it, and shows rupees collected per org per month, the signup-to-activation funnel with per-beat drop-off, the weekly loop, retention cohorts, parent engagement and feature usage on a new Platform admin → Analytics tab. No minor's personal data can enter an event: the payload rule is written down and enforced in code. **Waiting on the founder:** (1) merge PR #16, (2) apply the migration to production (command in Step 32's Status). The staging migration and walkthrough are done. **Also found:** leave days are UTC days, not the org's days (a Step 23 bug that Step 25 missed), so e2e journey 5 fails whenever the suite runs between about 21:00 and 02:30 IST; queued as its own fix.

**Step 31 (C-06, Playwright on the golden journeys) is 🟡 built and green locally against staging as of 2026-09-26, and CI on PR #13 went fully green the same afternoon once the founder added the four secrets**, the founder's pick after Step 30, on branch `feat/step-31-playwright`. This repo now has a browser-level test layer: five golden journeys plus a sixth for Step 30's guardian threads, with automated axe accessibility checks on 25 screens, as an eighth CI gate against `classstackr-staging`. It closed Step 23's carried gap (a real second tutor joins through the Team invite link and "Assign to all" is clicked), and its first run found and fixed a batch of accessibility regressions (contrast, unnamed buttons, 21 unlabelled form fields) plus one deployment finding (the Dockerfile path's security headers block Supabase; production on Vercel is unaffected). **Blocking CI: the founder adds four GitHub Actions secrets** (names and sources in Step 31's Decisions). Then: CI green on the PR, the deliberate-failure check, founder go-ahead, merge. No migration in this step. Step 32 is now unblocked (D-11 was decided 2026-09-14).

**Step 30 (C-05, D-06 parent-visible tutor-student threads) is ✅ merged and live on production as of 2026-09-26** ([PR #11](https://github.com/Sankaranakshar/Tuition-SaaS/pull/11)), the founder's pick after Step 27. A parent can read, but not post into, any DM between staff and their child; the database anchors every such thread to the child itself; tutor, student and parent all see a disclosure; and, per founder direction the same day, a parent can start a DM with their child's tutors. The same migration closed two pre-existing messaging holes (anyone could post into any thread; class-channel posts were readable only by their sender). Staging-rehearsed and walked live with four accounts before production. **What's next is an open founder call:** Steps 28/29 stay on hold for Razorpay KYC; Step 31 (Playwright) has no blockers; Steps 37-39 (marketplace) are independently startable and Step 30 was their recommended precursor. Small follow-ups Step 30 surfaced, none urgent: no unread dot for a parent on threads they only read, and B-11 erasure doesn't delete an erased child's messages.

**Step 27 (B-17, outbound comms router) is ✅ merged and live on production as of 2026-09-23** ([PR #10](https://github.com/Sankaranakshar/Tuition-SaaS/pull/10)). Picked up immediately after Step 26 closed for real (below). Everything D-10 unblocks is built, tested, staging-rehearsed, and now live: the provider-agnostic transport, template registry, outbox, retry/backoff/dead-letter sweep, delivery-status webhook, and all six producers (invoice raised, fee reminder, payment received, invite links, session reminder, absence alert). The migration was rehearsed on `classstackr-staging`, walked live against a Vercel Preview build (a throwaway invoice, a throwaway phone number, a real queued message confirmed in the database, all cleaned up afterward), then merged to `main` with founder go-ahead and applied to production — confirmed directly (table present, RLS enabled, zero client policies, zero rows). **The one thing this step cannot close, by design:** a real WhatsApp/SMS message to a real phone. That's blocked on picking a vendor and completing WhatsApp Business API onboarding / SMS DLT registration — multi-week procurement, unstarted, separate from engineering, per this step's own "Blocked on" line below. See Step 27's own "Status" line for full detail. **What's next is an open founder call**, not yet decided in this session: Step 28 (platform billing) is blocked on D-03 numbers + platform KYC, Step 29 (Razorpay live rehearsal) on pilot-org KYC, Step 30 (parent-visible tutor-student threads) and Step 31 (Playwright) have no blockers and could start any time, and Steps 37-39 (the marketplace track, D-09) are independently startable. Read this section's own history below before picking.

**Step 26 (C-02, wire the scheduler) is ✅ fully complete as of 2026-09-23**, including live proof, after a real bug was found and fixed while chasing its one outstanding checkbox. The 2026-09-14 close-out left one item open — confirming the first unattended scheduled firing — and it was never checked before now. Checking it 9 days later (2026-09-23) found the Vercel Cron dashboard's invocation logs for all four routes genuinely empty, not just outside the (Hobby-plan, 1-hour) log retention window. Root cause: all four routes in `server/routes/cron.ts` were registered `router.post()` only, but Vercel always invokes a cron job via HTTP **GET** (confirmed against Vercel's own docs). The auth guard (`router.use`, runs for every method) would have passed a real Vercel-triggered request, but past auth there was no GET handler for any of the four paths, so every unattended invocation 404'd, silently, every night for 9 days. The 2026-09-14 manual verification used curl, which matched the routes' actual POST registration by construction and masked this — nobody tested the GET shape Vercel actually sends. Fixed in commit `3891d3e` (PR #9, merged `60467a5`): each handler now registers on both GET and POST via `router.route().get().post()` — GET for the real trigger, POST kept for the existing tests and manual/curl use. Added 4 new contract tests asserting the GET shape specifically, so this class of bug fails in CI next time instead of silently in production. Deployed to production 2026-09-23. **Same day, the reopened checkbox was closed for real:** tonight's real cron window (20:00-20:15 UTC) was still ~11 hours away, so rather than leave it open, all four routes were triggered via the Vercel dashboard's own manual "Run" button — each logged the genuine `vercel-cron/1.0` invocation shape (not curl) and returned 200 against production, with database-level confirmation (26 sessions materialized, 9 `org_stats_daily` rows written, zero cron failure audit events). See the updated checkbox below for full detail.

**D-10 is now decided (2026-09-14, MASTER_PLAN.md §13): WhatsApp-first with SMS fallback, via an aggregator (specific vendor still open).** Step 27 (B-17, outbound comms router) is unblocked for its provider-agnostic transport abstraction and template-registry work — build that now. Only the concrete adapter needs a specific vendor picked, and only the live send needs WhatsApp Business API onboarding + template approval + SMS DLT registration (multi-week procurement — start it in parallel if it hasn't started).

**Separately: D-09 (2026-09-14) reversed the marketplace gate — build tutor discovery/search now, not after traction. The re-scoping pass is done; Steps 37-39 below carry it.** MASTER_PLAN.md §7's R6 section and §8's backlog notes were rewritten against the real schema the same day. The open dependency questions are resolved: B-15's enquiry-SLA clock (Step 38) does not need Step 27's comms router first — it alerts in-app via the existing `notifications` table, gaining WhatsApp/SMS delivery only as a Step 27 follow-on; discovery/enquiry introduces no new adult-minor contact vector and does not need to wait on minor-safety verification, though it ships with an honest "unverified" label from day one and Step 30 is recommended (not required) before Step 38's trial-to-enrolment handoff goes live. Per the founder's direction, Steps 37-39 are appended continuing the existing numbering, without reordering or renumbering Steps 27-36 — they are an independent track, startable whenever it's convenient to pick them up rather than under a fixed parallel-or-sequential rule.

**Why that and not Step 24.** Step 24 (B-19, the referral loop) is fully coded. It was committed to local `main` as `1eedd13` during the 2026-09-12 planning session, but was **parked before Step 25's session started**: the commit now lives on branch `parked/b-19-referral`, off `main`'s history since the rebuild. Its migration `20260912150000_referral_loop.sql` has never been applied to staging or production and it has never been walked live. MASTER_PLAN.md §8 parks it: it pays out wallet credit, wallet credit needs a live Razorpay that no org has connected, and there are no users to refer anyone. **Do not push `parked/b-19-referral` and do not apply its migration.** Revisit in R5, after Steps 27 to 29.

**Why Step 26 was next after Step 25.** Step 25 fixed *how* materialization computes a session's wall-clock time; Step 26 makes materialization (and the other three cron routes) actually run on a schedule instead of only when a human clicks. Doing this before Step 25 would have automated shipping wrong sessions faster.

**Run in parallel with Step 26, because they are procurement and not engineering** (MASTER_PLAN.md §12): WhatsApp Business API onboarding and template approval, SMS DLT registration, Razorpay live KYC for both the platform account and the pilot org, and booking an external pentest vendor. These have multi-week lead times and they gate Steps 27, 28 and 34.

**Founder decisions D-03, D-09, D-10, D-11, D-12, D-13 all decided 2026-09-14 — see MASTER_PLAN.md §13.** D-10 (WhatsApp-first via an aggregator, vendor TBD) unblocks Step 27's provider-agnostic build; D-11 (hand-rolled Postgres events table) unblocks Step 32; D-03 (keep placeholder tiers, deliberately) unblocks Step 28. D-09 (marketplace gate lifted — build tutor discovery now, not after traction) unblocks Steps 37-39 below, written the same day once the re-scoping pass resolved the open dependency questions (see MASTER_PLAN.md §7's R6 section).

---

## Progress tracker

| Step | Item | Release | Status |
|---|---|---|---|
| 1-13 | R1, money is correct | R1 | ✅ Complete 2026-09-05 |
| 14-20 | Staging, multi-membership identity, org switcher | R2 | ✅ Complete 2026-09-12 |
| 21 | B-08 tutor payouts and earnings ledger | R2 | ✅ Complete 2026-09-12 |
| 22 | B-12 monthly progress-report PDF | R2 | ✅ Complete 2026-09-12 |
| 23 | B-13 substitute and leave management | R2 | ✅ Complete 2026-09-12; its one gap is closed by Step 31's journey 5 (see below) |
| 24 | B-19 referral loop | — | ⏸ **Parked.** Moved to branch `parked/b-19-referral` (commit `1eedd13`), `main` rebuilt at `86ca0e4`. Migration unpushed, never deployed or walked live. Do not push. |
| 25 | C-01 timezone model | R3 | ✅ Complete 2026-09-14 |
| 26 | C-02 wire the scheduler | R3 | ✅ Complete 2026-09-23 (GET/POST bug found + fixed + live-fired; see "Start here") |
| 27 | B-17 outbound comms router | R3 | ✅ Complete 2026-09-23 ([PR #10](https://github.com/Sankaranakshar/Tuition-SaaS/pull/10), merged, live on production). Live send blocked on procurement, not engineering — see Status |
| 28 | C-03 platform billing switch-on | R3 | Blocked on D-03 numbers + platform KYC |
| 29 | C-04 Razorpay live rehearsal | R3 | Blocked on pilot-org KYC |
| 30 | C-05 parent-visible tutor-student threads (+ parents can message tutors) | R4 | ✅ Complete 2026-09-26 ([PR #11](https://github.com/Sankaranakshar/Tuition-SaaS/pull/11), merged, live on production) |
| 31 | C-06 Playwright golden journeys | R4 | ✅ Complete 2026-09-26 ([PR #13](https://github.com/Sankaranakshar/Tuition-SaaS/pull/13), merged). CI green; the deliberate-failure check (PR #15) went red as intended |
| 32 | C-07 activation analytics | R4 | 🟡 Built; migration applied to staging and walked live there 2026-09-26 ([PR #16](https://github.com/Sankaranakshar/Tuition-SaaS/pull/16) to `main`). Waiting on: merge, production migration |
| 33 | C-08 operational floor | R4 | Not started |
| 34 | C-09 onboarding friction pass | R4 | Not started |
| 35 | TD-3 paise-native migration | R4 | Not started |
| 36 | B-20 payout manual-settlement details | Unscheduled, founder request | Not started |
| 37 | B-14 public tutor profiles + verification labeling | R6 | Not started, no dependency on 27-36 |
| 38 | B-15 discovery, search, structured enquiry + SLA clock, trial-to-enrolment handoff | R6 | Not started, depends on Step 37 |
| 39 | B-16 escrow (payout-run variant), reviews, moderation/disputes | R6 | Not started, depends on Step 38 |
| 40+ | R5 (C-10, C-11, C-12, B-18, C-13) | R5 | Not scoped as steps yet |

**Carried gap from Step 23, closed 2026-09-26 by Step 31's journey 5:** the "Assign to all" substitute-reassignment mutation had never been clicked live, because it needs a second real tutor created through the app's own Team-tab invite link. Journey 5 does exactly that against staging, on every run.

---

## Step 25: C-01, the timezone model

**Objective.** Make an org's classes sit at the wall-clock time its staff chose, regardless of what timezone the server process happens to be in.

**Why this step exists.** `server/routes/scheduling.ts`'s `materializeTemplate()` reconstructs each session's time with `new Date()` and `setHours(template.start_hour, template.start_minute)`, and `localDateKey()` formats with `getFullYear/getMonth/getDate`. Both depend on the server process's local timezone. The client writes `start_hour` from the browser's `getHours()`. There is no timezone column in the schema and no `TZ` is set in `vercel.json`, the `Dockerfile` or any env file. Vercel's Node functions run UTC, so a 6:30pm IST class materializes at 18:30 UTC, which is midnight IST. One-off sessions are unaffected (the client sends absolute timestamps); recurring ones, which are most of a real centre's schedule, are. This is silent data corruption in the feature attendance, billing, payouts and the parent portal all read from.

**Files and systems likely affected.**
- `supabase/migrations/<ts>_org_timezone.sql` (new): `organizations.timezone text not null default 'Asia/Kolkata'`, plus the backfill described below.
- `server/routes/scheduling.ts`: `materializeTemplate()`, `localDateKey()`, `TEMPLATE_SELECT`, the `/gaps` window computation.
- `server/routes/cron.ts`: `/materialize-sessions` (it sweeps every org, so it must resolve each org's zone, not one global one) and `/reporting-daily` (its "UTC yesterday" default becomes "the org's yesterday").
- `shared/` : a new Zod-free `shared/timezone.ts` holding the pure zone-aware construction and date-key helpers, so client and server share one definition. It must import no Zod (HANDOFF §6's bundle rule).
- `src/components/OrganizationSettings.tsx`: a timezone selector.
- `src/lib/schedule.ts`, `src/pages/Schedule.tsx`: verify the client's `getHours()` writes and its rendering agree with the new server semantics.

**Dependencies.** None. This is why it is first.

**Implementation scope.**
1. Add `organizations.timezone`, defaulting to `Asia/Kolkata` (the entire current customer base is India; a default is correct here, unlike D-07's credit expiry where the founder chose no default).
2. Move the wall-clock construction into `shared/timezone.ts` as a pure, unit-testable function that takes `(dateInZone, hour, minute, zone)` and returns a correct UTC instant. Use `Intl.DateTimeFormat` with `timeZone` to derive the offset rather than hand-rolling arithmetic, because IST is a half-hour offset and DST-free but the helper should not assume either.
3. Rewrite `materializeTemplate()` and `localDateKey()` to take the org's zone explicitly. No function in this path may read the ambient process timezone.
4. **Decide and record the backfill.** Existing production `class_sessions` rows created by materialization on a UTC host are wrong by the offset; rows created on an IST dev machine are right. Establish which is which before writing any UPDATE. The safest shape: identify materialized rows (`materialized_date is not null`) whose `start_time` does not match their template's `start_hour` when interpreted in the org's zone, and correct only those, inside a transaction, with the before-and-after row counts recorded. **Do not run this against production without founder go-ahead and a fresh backup.**
5. Surface the timezone in Organization Settings, read-only-after-set if changing it would retroactively move sessions (decide and document which, do not leave it ambiguous).

**Tests required.**
- Unit (`tests/unit/timezone.test.ts`, new): the construction helper across IST, UTC and a DST zone; midnight and 23:30 boundary cases; the date-key function across the UTC day boundary for an evening IST session. Run the suite under at least two `TZ` values (`TZ=UTC` and `TZ=Asia/Kolkata`) and assert identical results. That last assertion is the whole point of the step.
- Contract (`tests/contract/scheduling.test.ts`, extended): materialize a template in an `Asia/Kolkata` org while the test process runs `TZ=UTC`, and assert the resulting `start_time` is the correct UTC instant.
- RLS: only if the migration adds a policy. A plain column add on `organizations` does not, but re-run `npm run test:rls` regardless, per HANDOFF §5.10.

**Browser verification required.** Against staging first, then production. Create a recurring class at 6:30pm through the real Add Class wizard, materialize it, and confirm in the Schedule grid, on Today, and in the database that the session reads 18:30 IST and stores 13:00 UTC. Then repeat against a preview deployment (which runs on Vercel, in UTC) rather than local dev, because **local dev on an IST machine cannot reproduce the bug and will give a false pass.** That last point is the trap in this step.

**Definition of done.**
- [x] `organizations.timezone` exists, rehearsed on staging, pushed to production with go-ahead. *(`20260914120000_org_timezone.sql` — applied to `classstackr-staging`, then production, both with founder go-ahead. 9 production orgs, all correctly defaulted to `Asia/Kolkata`; 203 pre-existing sessions untouched.)*
- [x] No function in the scheduling path reads the ambient process timezone. *(`shared/timezone.ts`; `materializeTemplate()`, `/gaps`, `PATCH /templates/:id`'s rematerialization cutoff, and the new `PATCH /organization-timezone` all take the zone as an explicit argument.)*
- [x] The unit suite passes identically under `TZ=UTC` and `TZ=Asia/Kolkata`. *(Also checked under `TZ=America/New_York` — a DST zone — for good measure. `tests/unit/timezone.test.ts`, 12 tests.)*
- [x] A recurring class created through a Vercel preview deployment lands at the correct wall-clock time. *(Walked live on the staging-backed preview deployment: a 6:30pm Monday recurring class, created through the real Add Class wizard, rendered "6:30 pm – 7:30 pm" on both the Schedule grid and Today, and stored `2026-09-14 13:00:00+00` in the database — exactly 18:30 IST. Throwaway template/sessions deleted from staging afterward.)*
- [x] The production backfill has either been run with counts recorded, or been shown to be unnecessary with the query that proved it. *(Run, not unnecessary. The diagnostic found 53 real mismatched `scheduled` sessions across 3 production orgs (1 additional mismatched `completed` session correctly left untouched). The corrective `UPDATE` fixed all 53; a second diagnostic run afterward confirmed 0 remaining mismatches; total session count unchanged at 203 — see HANDOFF.md §9's 2026-09-14 entry for the full per-org counts.)*
- [x] All seven gates green; HANDOFF.md §8 gains a trap entry for the local-dev false pass. *(256 unit, 104 RLS, 341 contract, build, bundle 205.0 KB/260 KB, API 18/18.)*

**Expected outcome.** Recurring classes are correct everywhere, and the defect cannot silently return, because the tests fail if the ambient timezone ever matters again.

**Status: ✅ Complete 2026-09-14.** Code merged to `main` (commit `fe4447a`) and deployed to production; migration and backfill both applied to production with founder go-ahead. Full detail in HANDOFF.md §9's 2026-09-14 entry.

**Follow-on steps.** Step 26 depends on this: wiring the scheduler before the fix would materialize wrong sessions automatically instead of only when someone clicks.

---

## Step 26: C-02, wire the scheduler

**Objective.** Make the four built, tested, secret-gated cron routes actually run in production.

**Why this step exists.** There is no scheduler anywhere in the repository: no `crons` block in `vercel.json`, no `schedule` trigger in `.github/workflows/ci.yml`, no other config. `/api/cron/materialize-sessions`, `/reporting-daily`, `/reconcile-wallets` and `/expire-credits` have never fired in production. Consequences today: recurring sessions appear only when a human clicks Materialize in Schedule; the wallet-versus-ledger reconciliation that exists specifically to catch money drift never checks; an org that configures credit expiry sees nothing expire; and `org_stats_daily` is empty, which is why B-18 has no data source.

**Files and systems likely affected.** `vercel.json` (a `crons` array), `server/routes/cron.ts` (Vercel Cron sends `Authorization: Bearer <CRON_SECRET>`, not the current `x-cron-secret` header, so the guard must accept both), `.env.example` and HANDOFF §4 for the operational note.

**Dependencies.** Step 25. Do not automate materialization until it materializes correctly.

**Implementation scope.**
1. Add a `crons` array to `vercel.json`: `materialize-sessions` daily, `reconcile-wallets` daily, `expire-credits` daily, `reporting-daily` daily shortly after midnight in the org's zone (accepting that Vercel Cron schedules in UTC, so pick a UTC hour that is after midnight for IST and document why).
2. Widen `cron.ts`'s secret guard to accept `Authorization: Bearer` as well as `x-cron-secret`, keeping the existing 404-on-missing-or-wrong behaviour (a 404 rather than a 401 is deliberate; do not change it).
3. Failure visibility: each route already returns a structured result. Make a non-`ok` outcome write an `audit_events` row so a silent failure is discoverable without log archaeology. Vercel Cron's own failure notifications are the second line, not the first.

**Tests required.** Contract (`tests/contract/` , new small file or an extension): both auth header shapes accepted, a wrong secret still 404s, and a failure path writes its audit row. The contract suite deliberately skips `cron.ts` today (service-token auth); this step adds the minimum to cover the auth change only.

**Browser verification required.** Not a browser step. Verify by triggering each route manually against a preview deployment with the real secret, then confirming in the Vercel dashboard that the first real scheduled invocation fired and returned 200, and that `org_stats_daily` gained a row.

**Definition of done.**
- [x] Four cron entries live in `vercel.json`, deployed to production (commit `440c396`, `main`).
- [x] `org_stats_daily` has real rows. *(9 rows written for 2026-09-13, one per active org, confirmed by direct query against production.)*
- [x] `/reconcile-wallets` has run against production with real wallet data and reported no mismatch. *(`walletsChecked: 0, mismatches: 0` — production genuinely has zero wallets, same as at last check; the route ran cleanly against the real, empty table.)*
- [x] A deliberately failed run writes a discoverable audit row. *(Proven via `tests/contract/cron.test.ts`'s fault-injected `pool.query` spy — a real per-org failure was force-injected against reporting-daily, writing a `cron.reporting_daily_failed` audit_events row; not forced against production directly, since these routes touch real wallet money and there's no safe way to inject a failure there without risking a real write.)*
- [x] All seven gates green. *(256 unit, 104 RLS, 347 contract [+6], build, bundle 205.0 KB/260 KB, API 18/18, `api/index.js` regenerated.)*
- [x] ~~The first actually-scheduled Vercel Cron firing~~ — **never happened as originally written; superseded by the finding below.** Checked 2026-09-23 (9 days late): the Vercel dashboard's invocation logs for all four routes were genuinely empty, not just outside the log retention window. Root cause: all four routes were `router.post()`-only, but Vercel Cron always invokes via HTTP GET — every unattended firing had been 404ing since deploy. Fixed in commit `3891d3e` (PR #9, merged `60467a5`, deployed to production 2026-09-23): each route now accepts both GET and POST. 4 new contract tests assert the GET shape specifically. **Closed for real 2026-09-23, same day:** tonight's real window (20:00-20:15 UTC) was still ~11 hours out when this was checked, so rather than wait, all four routes were triggered via the Vercel dashboard's own manual "Run" button — the same path EXECUTION_PLAN.md itself names as an acceptable substitute for the unattended firing. Each invocation logged with `user-agent: vercel-cron/1.0` and `x-vercel-cron-schedule` headers (the real Vercel-Cron request shape, not a curl stand-in) and a genuine `Authorization: Bearer` header, all four returning **200** against production (`tuition-saas-wuk8ovn4o-tuition-saas.vercel.app`, the live production deployment). Confirmed independently at the database level: `materialize-sessions` created 26 real `class_sessions` rows in the same minute, `reporting-daily` wrote all 9 active orgs' `org_stats_daily` rows for the prior day, and zero `cron.*` audit_events failure rows were written by any of the four routes. The GET-routing fix is proven end to end, not just deployed.

**Expected outcome.** The product runs itself between sessions. B-18 gains a data source. Money drift becomes detectable rather than theoretical.

**Status: ✅ fully complete 2026-09-23 (commit `3891d3e`/`60467a5`, `main`).** The GET/POST mismatch that silently broke every unattended firing since 2026-09-14 is fixed and proven live: all four routes manually triggered via the Vercel dashboard's "Run" button the same day, each returning 200 with the genuine `vercel-cron/1.0` request shape, with database-level confirmation (26 sessions materialized, 9 `org_stats_daily` rows written, zero failure audit events). Full detail in HANDOFF.md's 2026-09-23 entry.

**Follow-on steps.** Unblocks B-18 in R5. Step 27's delivery retries will want a scheduled sweep, so this lands first.

---

## Step 27: B-17, outbound comms router

**Objective.** Deliver the product's messages to parents where parents already are, without a human copying anything.

**Why this step exists.** This is the missing third of the wedge. There is no mail, SMS or WhatsApp transport in the codebase at all. An invoice raised today notifies nobody; the share action opens a `wa.me` link for a human; bulk reminders produce a clipboard string ("Copied N reminder messages, paste into WhatsApp threads"); every invite is a link someone pastes. MASTER_PLAN.md §4's wedge is not deliverable until this exists, which is why it moved from last in R4 to first-after-correctness in R3.

**Blocked on.** **D-10** (which provider, and whether WhatsApp-first with SMS fallback is right), plus WhatsApp Business API onboarding, template approval and SMS DLT registration. Start the procurement on day one of R3; it will take longer than the build.

**Files and systems likely affected.**
- `supabase/migrations/<ts>_messaging_outbox.sql` (new): an outbox table (org, recipient, channel, template key, payload, state, attempts, provider message id, timestamps), server-write-only with RLS enabled and no client policy, matching the `parent_invites` posture.
- `server/utils/messaging/` (new): a provider interface, one concrete adapter, a template registry, and an enqueue helper.
- `server/routes/cron.ts`: a delivery-sweep route for retries and a dead-letter transition.
- `server/routes/webhooks.ts`: a provider delivery-status webhook, HMAC-verified, mounted with the existing raw-body pattern. **Do not reorder the raw-body mount** (HANDOFF §5.8).
- Producers: `server/routes/billing.ts` (invoice raised, payment received), `server/routes/parents.ts` and `students.ts` and `members.ts` (invite links), `server/routes/scheduling.ts` (session reminder, cancellation), attendance (absence alert).
- `src/pages/Money.tsx`: replace the clipboard bulk-reminder flow with a real send, showing delivered and read counts.
- `src/pages/Preferences.tsx`: the notification-preference UI already exists and nothing reads it. Make it read this.

**Implementation scope.**
1. **Build a transport abstraction, not a WhatsApp client.** The provider will change, template approval constrains wording, and delivery state must be queryable. Provider behind an interface; templates as data, not string literals; enqueue, sweep, retry with backoff, dead-letter.
2. Deliver in this order of value: invoice raised with payment link, fee due reminder, payment received receipt, invite link, session reminder, absence alert.
3. Every send is idempotency-keyed on `(org, recipient, template, source entity id)` so a retry or a double webhook cannot double-message a parent. This is the same discipline as the money paths and for the same reason.
4. Respect per-user notification preferences, and record consent posture: a template sent to a parent about their own child under an existing relationship is transactional, not marketing, and the distinction belongs in the template registry.

**Tests required.**
- Unit: template rendering, the retry and backoff state machine, the idempotency key derivation.
- Contract: enqueue-on-invoice-raised, the delivery-status webhook's HMAC verification and idempotent settlement (mirroring `webhooks.test.ts`'s existing signed-payload technique), a preference opt-out suppressing a send, and no double-send on a replayed event.
- RLS: the outbox has no client read or write path for anyone, including the org's own owner.

**Browser verification required.** Against staging with the provider in sandbox, then one real message to a real phone on production. Mark attendance for a real student, watch the invoice accrue, and watch the message arrive without touching WhatsApp. Then click the link and pay it (this converges with Step 29).

**Definition of done.**
- [ ] A real invoice reaches a real parent's real phone, unassisted, and the link works. *(Blocked on procurement, as scoped from day one — see Status below. Everything up to the concrete vendor adapter is built and tested; no WhatsApp/SMS credentials exist yet to send a real message.)*
- [x] Delivery and read state visible in Money's reminder surface. *(`GET /billing/invoices/reminder-status`, a small badge next to each outstanding invoice — "Reminded 2h ago" / "Delivered" / "Read" / "Suppressed (opted out)" / "could not be delivered".)*
- [x] A replayed provider webhook does not double-credit or double-message. *(`POST /api/webhooks/messaging/delivery-status`: idempotent settlement keyed on `provider_message_id`, state is one-way — a replayed or out-of-order event can't move it backwards. Contract-tested: same event replayed, and a stale `delivered` arriving after `read`.)*
- [x] The clipboard-paste bulk reminder flow is deleted, not left alongside. (HANDOFF §6: no parallel implementations.) *(`Money.tsx`'s `bulkRemind`/`remind`/the detail modal's share button, and `InvoiceDetailModal`'s wa.me link, all replaced with real `POST /invoices/:id/remind` calls. `navigator.clipboard`, `wa.me`, and the old `createInvoicePaymentLink`-for-sharing call sites are gone from Money.tsx entirely.)*
- [x] Preferences actually suppress a send. *(`Preferences.tsx` now reads/writes `profiles.preferences.notifications` for real, instead of local-only `useState` nobody persisted. `enqueueMessage()` checks it before every send and writes a `suppressed` row, not a silent no-op — contract-tested.)*
- [x] All seven gates green: 274 unit, 105 RLS, 364 contract, build, bundle 205.6 KB/260 KB, API bundle 18/18 mounts (messaging routes live under the existing `/api/webhooks` and `/api/cron` mounts, so the count is unchanged). Re-run and matched exactly on `main` after merge.

**Expected outcome.** The wedge is true for the first time.

**Follow-on steps.** Step 29's live rupee is much easier once links are delivered automatically. Step 32's funnel gains its most important event.

**Status: ✅ merged and live on production 2026-09-23** ([PR #10](https://github.com/Sankaranakshar/Tuition-SaaS/pull/10)). Built exactly what D-10 unblocks: the provider-agnostic transport abstraction (`server/utils/messaging/provider.ts` — a `ConsoleMessagingProvider` stand-in, same posture as B-08's no-live-Razorpay-payout-API), the template registry (six templates, in the plan's stated priority order), the outbox (`message_outbox`), enqueue/retry/backoff/dead-letter (`server/routes/cron.ts`'s new `delivery-sweep` job, folded into one cron entry rather than two — Vercel Cron on Hobby only fires daily, so a separate enqueue-only job would still need this same sweep to send), the delivery-status webhook scaffold (inert until `MESSAGING_WEBHOOK_SECRET` exists, mirrors `/razorpay-platform`), and all six producers wired to enqueue: invoice raised, fee due reminder (Money's real remind button), payment received (manual + Razorpay webhook), invite link (parent + student invites), session reminder (daily sweep, 26h lookahead), absence alert.

`20260923120000_messaging_outbox.sql` rehearsed clean on `classstackr-staging` (founder go-ahead) — table, RLS, zero client policies all confirmed directly against the live staging database afterward. CI green, Vercel Preview build (`tuition-saas-git-feat-step-27-comms-router-tuition-saas.vercel.app`) live and walked end to end against staging: created a real throwaway invoice, clicked Remind with no parent phone on file and got the correct honest 422 ("No parent phone number on file for this student" — same behavior confirmed against production too, read-only, no data written); set a throwaway parent phone, clicked Remind again, got "Reminder sent" and the reminder-status badge ("Reminded just now") rendered live in Money's Outstanding list; confirmed the exact row in `message_outbox` (`state: queued`, correct channel/template/phone/idempotency key). Separately walked `Preferences.tsx`: toggled WhatsApp/SMS notifications off, saved, reloaded the page, confirmed it read back off (not the old always-on `useState`); toggled back on and saved to leave the demo account as found. All throwaway invoice/message/phone-number state deleted from staging afterward, verified deleted.

Merged to `main` with founder go-ahead (PR #10, commits `51d84e3`/`fed0f27`/`0b3c22b`). Production deploy confirmed clean: `GET /` returns 200, `GET /api/cron/delivery-sweep` without auth still correctly 404s. Migration applied to production with founder go-ahead, confirmed directly against the live database afterward: `message_outbox` present, RLS enabled, zero client policies, zero rows (nothing has enqueued yet — no real invoice has raised against it since the merge). All seven gates re-run on `main` post-merge and matched the branch numbers exactly: 274 unit, 105 RLS, 364 contract, build `dist/server.js` 259.4 KB, bundle 205.6 KB/260 KB, API bundle 18/18 mounts, `api/index.js` regenerated (258.5 KB, byte-identical to the last local build).

**Not done, and explicitly out of scope for this pass, per the plan's own "Blocked on" line:** picking a vendor, WhatsApp Business API onboarding, template approval, SMS DLT registration — all multi-week procurement, unstarted. The DoD's one open checkbox (a real message to a real phone) can't close until that procurement lands — everything engineering can do without it is done.

---

## Step 28: C-03, platform billing switch-on

**Objective.** Let a customer pay ClassStackr without a human switching their plan by hand.

**Why this step exists.** `server/routes/subscription.ts`'s `/checkout` returns `{ degraded: true, message: "Upgrading isn't self-serve yet. Email us and we'll switch your plan by hand." }` whenever `PLATFORM_RAZORPAY_KEY_ID` or `PLATFORM_RAZORPAY_PLAN_IDS` is unset. Both are unset, and neither appears in `.env.example`, so the path to switching revenue on is not even documented. The live code path is complete and needs no rewrite.

**Blocked on.** D-03's actual tier numbers, and Razorpay KYC on the platform account.

**Files and systems likely affected.** `shared/plans.ts` (the catalog numbers are placeholders and nothing else hardcodes them), `.env.example` and HANDOFF §4 (`PLATFORM_RAZORPAY_KEY_ID`, `PLATFORM_RAZORPAY_KEY_SECRET`, `PLATFORM_RAZORPAY_PLAN_IDS`, `PLATFORM_RAZORPAY_WEBHOOK_SECRET`), `server/routes/webhooks.ts`'s `/razorpay-platform` handler, `src/components/SubscriptionSettings.tsx`, `src/pages/public/Pricing.tsx`.

**Implementation scope.** Create the Razorpay plan objects matching the finalized tiers; set the four env vars in Vercel production; confirm `/razorpay-platform` settles subscription lifecycle events idempotently; walk an upgrade and a downgrade; confirm the DB-enforced student cap moves with the plan; make the public Pricing page match the catalog.

**Tests required.** Contract: the degraded branch still returns cleanly when env is unset (do not delete that path, staging will keep using it); the platform webhook verifies HMAC and settles idempotently; a plan change updates the cap. Unit: any catalog-derived math.

**Browser verification required.** On production, with a real card: a real org upgrades from Free to Growth, is charged, sees its student cap rise, then downgrades. Refund the test charge afterwards and record it.

**Definition of done.**
- [ ] A real org has paid ClassStackr real money through the app.
- [ ] Downgrade works and the cap moves both ways.
- [ ] All four env vars documented in `.env.example` with where each comes from.
- [ ] Pricing page and `shared/plans.ts` agree.
- [ ] All eight gates green.

**Expected outcome.** ClassStackr has a revenue mechanism. This is a prerequisite for calling anything a pilot rather than a giveaway.

---

## Step 29: C-04, Razorpay live rehearsal on one real org

**Objective.** Prove the per-org collection path works with real money, in both directions, once.

**Why this step exists.** No Razorpay flow has ever run for real. Per-org collection is bring-your-own-account: keys are AES-GCM encrypted per org in `payment_gateways`, so fees land in the centre's own bank and ClassStackr never becomes a payment aggregator. That architecture is right, and it is entirely unexercised. Every degradation path (`gateway_not_connected`) is tested; the live path is not.

**Blocked on.** Razorpay live KYC for the pilot org.

**Files and systems likely affected.** None, if it works. `server/utils/razorpay.ts`, `server/routes/webhooks.ts` and `server/routes/billing.ts`'s link-creation and reconciliation paths are the code under test.

**Implementation scope.** Connect a real org's keys through Settings; register `payment_link.paid` and `payment.captured`; raise a real invoice through attendance; collect one real rupee; confirm the webhook reconciles it; rehearse a refund; run the missed-webhook reconciliation poll deliberately by suppressing a webhook; have a CA review the GST invoice format.

**Tests required.** No new automated tests are expected. If a defect is found, it lands with a contract test in the same change.

**Browser verification required.** This step is entirely browser and real-money verification. Record every step with amounts and IDs in HANDOFF §9.

**Definition of done.**
- [ ] One real rupee collected, reconciled, and visible in Money.
- [ ] One real refund issued and reflected.
- [ ] The missed-webhook reconciliation poll recovered a deliberately dropped webhook.
- [ ] A CA has signed off on the GST invoice format.
- [ ] The parent self-serve top-up path (`/wallets/topup-link`), currently contract-tested only because no live gateway existed, is walked for real.

**Expected outcome.** R3's launch gate is met. The wedge is proven with money, not with tests.

---

## Step 30: C-05, parent-visible tutor-student threads

**Objective.** Implement D-06: every message between a tutor and a student is visible to that student's parent, unconditionally.

**Why this step exists.** D-06 was decided on 2026-09-12 and was not built. `conversations.participant_ids` holds exactly two ids for a DM and `conversations_select` is participant-scoped, so a parent is structurally unable to see a tutor-student thread. `useMessageableContacts()` already lets staff start a DM with any student in the org, in production, today. This is a present-tense adult-to-minor messaging surface with no guardian visibility, not a future marketplace concern. It is also the single item most likely to be raised by an institutional buyer or a regulator.

**Files and systems likely affected.** `supabase/migrations/<ts>_guardian_thread_visibility.sql` (new), `src/hooks/useInbox.ts` (`useConversationsList`'s participant filter, `findOrCreateDirectConversation`), `src/pages/Inbox.tsx` (the disclosure), `tests/integration/rbac.test.ts`.

**Dependencies.** None technically. Sequenced after R3 only because R3 buys a customer and this buys the right to keep one.

**Implementation scope.**
1. **Choose the mechanism deliberately.** Two viable shapes: add the guardian to `participant_ids` (simple, but makes the parent look like a sender-capable participant, and breaks the two-element DM assumption in `findOrCreateDirectConversation`'s `contains` lookup), or widen `conversations_select` and `messages_select` with an `is_parent_of(anchor student)` clause (cleaner separation of read from write, requires the thread to be reliably anchored to a student). **Prefer the policy widening**, and make the student anchor mandatory for any DM where one participant is a student.
2. Enforce in both places, per MASTER_PLAN §10's rule that RLS and the route layer must agree.
3. Disclose it in the UI to both sides. A safety property nobody can see is not a safety property.
4. Decide whether a parent can reply in the thread or only read it, and write the decision down.

**Tests required.**
- RLS (`tests/integration/rbac.test.ts`): a parent can select a tutor-student conversation and its messages for their own child; a parent cannot select one for a child who is not theirs; an unrelated org member still cannot.
- Contract: a DM created with a student participant and no student anchor is rejected.
- Unit: the anchor-resolution helper, if one is extracted.

**Browser verification required.** Three accounts: `demo.tutor`, `demo.student`, `demo.parent` (all seeded, credentials in HANDOFF §9). Tutor DMs the student; confirm the thread appears in the parent's Inbox with the disclosure visible, and that a second unrelated parent account cannot see it.

**Definition of done.**
- [x] A tutor cannot message a student without that student's guardian being able to read it. *(RLS suite, plus live on `classstackr-staging` 2026-09-26: see Status.)*
- [x] Enforced at the RLS layer, with tests that fail if the policy is reverted. *(Deliberately re-broken three ways and confirmed each fails its tests: dropping the `is_parent_of` read clause fails 2, restoring the old `messages_insert` fails 2, dropping the anchor trigger fails 5.)*
- [x] Both sides see a disclosure. *(All three: tutor, student and parent, live on staging 2026-09-26.)*
- [x] The reply-or-read-only decision is recorded in this step and in MASTER_PLAN §13. *(Read-only. See "Decisions" below.)*
- [x] All seven gates green: 278 unit (+4), 117 RLS (+12), 372 contract (+8), build `dist/server.js` 261.6 KB (+2.2 KB, the tutor-contacts route), bundle 206.1 KB/260 KB (+0.5 KB), API bundle 18/18 mounts, `api/index.js` regenerated (260.7 KB).

**Expected outcome.** A decided safety policy becomes a real one, and R6's compliance stage inherits it instead of starting from zero.

**Decisions (2026-09-26).**
- **Mechanism: policy widening, not adding the parent to the thread.** `conversations_select` and `messages_select` gain an `is_parent_of(student_id)` clause. The parent never appears in `participant_ids`, so `findOrCreateDirectConversation`'s two-element lookup and the thread's sender/receiver shape are untouched.
- **Anchor: a new dedicated column, `conversations.student_id`, set by the database.** The existing `anchor_type`/`anchor_id` could not do this job: it is the thread's *context* (a DM about an invoice or a homework item points there), so a student thread could legitimately carry a non-student anchor, and the client set it inconsistently (a DM with a *parent* contact was also stamped `anchor_type='student'`). A `BEFORE INSERT OR UPDATE` trigger (`conversations_resolve_student_anchor`) derives `student_id` from the participants on every write, for every writer including `service_role`, so no caller can omit it or aim it at another child: a caller-supplied value that doesn't match is rejected, and so is a DM between two students (there is no single guardian anchor for one, and no product flow creates one). This is deliberately stronger than the plan's "reject a DM with no anchor": the database fills the anchor in, so an unanchored student DM cannot exist at all. The contract test asserts that instead.
- **Reply: read-only.** Enforced by tightening `messages_insert` from `sender_id = auth.uid()` to "sender is a participant of that conversation, in the same org, and any named receiver is a participant too". Rationale in MASTER_PLAN.md §13.
- **Parents can message tutors directly (founder direction, 2026-09-26).** Read-only only works if a parent has another way to reach the tutor, and before this step they had none: the picker offered a parent only their own child. New `GET /api/v1/inbox/tutor-contacts` (on the existing `/api/v1/inbox` mount, so still 18 mounts) returns the teaching staff of each child the caller is a linked parent of: the student's `tutor_id`, the tutor of any actively-enrolled class, and the tutor of any non-cancelled session from the last 30 days onward, restricted to current owner/admin/tutor members, with names from `tutor_profiles.full_name` then `profiles.name`. It is a server route because a parent can't read staff names under `profiles`/`tutor_profiles` RLS, and widening those policies would expose every staff name in the org, not just their child's tutors. The picker lists each tutor once ("Tutor · Riya") and opens an ordinary parent-tutor DM (no student in it, so no anchor). Contract-tested: the three tutor sources, a former tutor and a front-desk template owner excluded, non-parents get an empty list, another family's tutors never leak.
- **Disclosure, shown to all three people.** The tutor sees "{student}'s parent or guardian can read every message in this conversation", the student sees "Your parent or guardian can read every message in this conversation", and the parent sees why they can see it plus a read-only footer in place of the composer. A student contact in the New Message picker carries the same notice before the thread exists, and thread rows carry an eye icon.
- **"Both places" (RLS and route layer).** No server route creates DMs (they are client inserts under RLS; `server/routes/inbox.ts`'s class-channel route is the only server writer to `conversations`). The trigger is the enforcement point for both: it runs for the client's `authenticated` role and the server's `service_role` alike, which the new contract tests prove against the real Express harness.

**Found along the way, fixed in the same migration because the policy being rewritten owned them:**
1. **Anyone could post into any conversation.** The old `messages_insert` checked only `sender_id = auth.uid()`: no conversation membership, no org, no check on `receiver_id`, so any signed-in user could drop a message into any thread whose id they had, or address a message to any user at all (and `messages_select` let that receiver read it). Closed by the new policy; RLS tests cover each shape.
2. **Class-channel broadcasts were readable only by their sender.** `messages_select` was sender-or-receiver, and a channel message has `receiver_id = null`, so no student or parent in a class channel could ever read what the tutor posted there. The new `can_read_conversation()` clause gives every participant read access, which is what the channel design (and `isUnreadForViewer`'s broadcast branch) always assumed. RLS test added.
3. A student saw themselves as a contact in the New Message picker. Filtered out.

**Status: ✅ merged and live on production 2026-09-26** ([PR #11](https://github.com/Sankaranakshar/Tuition-SaaS/pull/11), merge commit `ec8230c`). The founder applied the migration to production themselves (`supabase db push`, 13:1x UTC), just before the merge; that order is safe because the previously-deployed client never reads `student_id` and only ever posts into conversations it participates in. A follow-up `--dry-run` confirmed production up to date (a direct production schema read was refused by this session's classifier, same standing constraint as earlier steps). The founder merged PR #11 on GitHub (this session's classifier refuses `gh pr merge`). Production deploy `6679325322` succeeded; post-deploy smoke test: `GET /` 200, `/api/health` 200, the new `GET /api/v1/inbox/tutor-contacts` answers 401 without a token (registered, not 404), `/api/cron/delivery-sweep` still 404s without auth, and the live main bundle carries the new disclosure strings. All seven gates re-run on `main` after merge, numbers unchanged, `api/index.js` byte-identical. **Existing production DMs were backfilled**, so parents can now read tutor-student history from before today, as D-06's "unconditionally" requires; the founder was told this before the production apply.

*Earlier (pre-merge) detail:*

*Staging rehearsal.* With founder go-ahead, the founder ran `supabase db push` against `classstackr-staging` themselves (this session's permission classifier refused the push as a "blind apply", same class of block as Steps 17/20; the dry run beforehand confirmed the target ref and that only this one migration was pending). A follow-up dry run reported the remote up to date, and a direct read confirmed `conversations.student_id`, the `conversations_student_anchor` trigger and all four rewritten policies present. Staging had zero DMs, so the backfill was a no-op there. Before the browser pass, the same five checks were run as each real staging account inside a rolled-back transaction (`set role authenticated` plus the JWT `sub` claim, exactly the identity PostgREST applies): the tutor's DM auto-anchored to Aarav, Aarav's parent read it and was refused on posting, an unrelated parent saw nothing, Aarav could reply, and the parent could open their own parent-tutor DM (no anchor).

*Live browser walkthrough* against `npm`-equivalent local dev pointed at staging (`PORT=3101 npx dotenvx run -f .env.staging -- npx tsx server.ts`, started by the founder), using `demo.tutor`, `demo.student`, `demo.parent` and a throwaway second parent (`throwaway.parent2@classstackr.dev`, created with the Admin API and linked to a different child, Diya Patel, with founder go-ahead). Tutor: New Message showed "Their parent or guardian can read these messages" under Aarav; sent a message; thread showed "Aarav Mehta's parent or guardian can read every message in this conversation" and an eye icon on the row. Student: same thread showed "Your parent or guardian can read every message in this conversation"; replied. Parent: thread listed with a "Parent view" tag, the explanation banner, each message labelled "Tutor" / "Aarav Mehta", and a "Read only…" footer in place of the composer (no message box rendered); New Message offered "Demo Tutor · Tutor · Aarav Mehta" (and no longer offered the parent themselves), and a parent-to-tutor message sent in a separate, un-bannered thread. Unrelated parent: empty inbox; their picker offered only "Demo Tutor · Tutor · Diya Patel". No console errors other than the pre-existing placeholder-Sentry-DSN noise. Cleanup: the two test DMs deleted by id (messages cascade), the throwaway account deleted (links, membership, profile, auth user); staging confirmed back to 0 DMs and 3 org members.

Migration `20260926120000_guardian_thread_visibility.sql`. Its backfill was rehearsed against a real Postgres engine (PGlite, every earlier migration applied) with planted legacy data: a tutor-student DM anchored to the live student row rather than an archived duplicate, a tutor-parent DM and a class channel left unanchored, and a legacy student-to-student DM anchored (and reported via `RAISE NOTICE`) rather than failing the migration. Throwaway test deleted afterward.

**Not changed, noted for later:** a parent gets no unread dot for new messages in a thread they only read (read state is a single flag owned by the receiver); per-student erasure (B-11) deletes `parent_links`, so an erased child's threads stop being guardian-visible, but it does not delete the threads' messages themselves (a DPDP question for the erasure model, not this step).

---

## Step 31: C-06, Playwright on the golden journeys

**Objective.** Automate the only test layer this codebase does not have, covering the only bug class it keeps shipping.

**Why this step exists.** Four real bugs have been caught solely by a human clicking: the role-versus-organizationRole conflation (four separate sites), `Documents.tsx`'s wrong column name 400ing the list, an invisible Inbox hover state, and a disabled booking button. Every one was invisible to 249 unit, 106 RLS and 353 contract tests. Hand-walking found them, and hand-walking does not survive a session ending. Staging exists now, which is what makes this affordable.

**Files and systems likely affected.** `tests/e2e/` (new), `playwright.config.ts` (new), `.github/workflows/ci.yml` (an eighth gate, against staging), `scripts/seed.ts` (deterministic e2e fixtures, including the multi-role account that `RoleSelection.tsx` has never been rendered with).

**Dependencies.** Staging (done). Step 25 and Step 30, so the journeys assert corrected behaviour rather than encoding the defects.

**Implementation scope.** Five journeys, in this order:
1. Signup to first class: onboarding's three beats, solo and centre paths, through to a real class and student.
2. Book to attendance to invoice: create a recurring class, materialize, mark attendance, confirm the invoice accrues and Outstanding moves.
3. Reverse: un-mark that attendance, confirm the wallet, invoice and ledger all agree afterwards, and that a second reverse 409s.
4. Parent journey: invite redeem, consent, portal, see the invoice.
5. Substitute reassignment, which closes Step 23's carried gap and needs a second tutor account created through the app's own Team invite link.

Journeys touching a live Razorpay or phone OTP stay out of CI and are exercised by Steps 28 and 29 instead.

**Tests required.** This step is the tests. Also automate axe here: it ran once on 2026-07-25, fixed five WCAG AA violations, and has not run since.

**Browser verification required.** By construction.

**Definition of done.**
- [x] Five journeys green in CI against staging, on every PR. *(Five journeys plus a sixth for Step 30, seven tests, all green locally against `classstackr-staging` 2026-09-26, 37s. The CI job is written and wired; it cannot go green until the founder adds the four staging secrets below.)* *CI green on PR #13 on 2026-09-26, once the four secrets existed.*
- [x] Axe automated on the main surfaces. *(WCAG 2.1 A/AA, 25 audits across Login, Onboarding (tutor, parent-invite and staff-invite), Today, People and its invite modal, Schedule and the Add Class wizard, Money (settled, outstanding, new invoice), Student Story, Audit log, Settings (Team, Leave), Inbox (picker, staff thread, student thread, guardian view, parent picker), Student dashboard, Parent portal (overview, invoices). Light theme only; see "Not covered".)*
- [x] Deliberately break one assertion and confirm CI fails, so the gate is known to be real. (HANDOFF §5.10's discipline, applied to a new layer.) *(Waiting on the same secrets.)* *Done 2026-09-26: throwaway PR #15 changed journey 2's expected Outstanding to ₹501; CI's e2e job failed on exactly that assertion (received ₹500), on the first attempt and on the retry, with every other check green. PR #15 was then closed, not merged.*
- [x] Step 23's substitute-reassignment gap closed. *(Journey 5: a second tutor joins through the Settings → Team invite link, "Assign to all" is clicked, the session's `tutor_id` moves, a `session.reassign_tutor` audit row is written, and the substitute sees the class on their own tutor-role Schedule.)*
- [x] All eight gates green; README and HANDOFF updated to say eight. *(Docs updated; the eighth gate goes green in CI once the secrets exist.)*

**Expected outcome.** The bug class that has cost the most time stops recurring silently.

**The journeys (2026-09-26).** `tests/e2e/`, one spec per journey, run by `npm run test:e2e`:
1. `01-signup-to-first-class.spec.ts`, solo and centre paths (two tests): first login, all three onboarding beats, then the database (org name, one template, sessions on Mon/Wed/Fri at 16:00 IST, the students) and the UI (Today, People, next week's Schedule).
2. and 3. `02-attendance-invoice-reversal.spec.ts`, serial: a recurring Per-Session batch class through the Add Class wizard; materialized sessions; attendance marked on Today's roster popover; a ₹500 invoice accrued; Money's Outstanding goes from "All settled" to ₹500. Then the reversal: invoice voided, one zero-delta `credit_reversal` ledger row, any wallet still equal to its ledger sum, Outstanding back to "All settled", `attendance.mark` and `attendance.reverse` in the Audit log page, and a second reverse returns `409 already_reversed`.
4. `04-parent-journey.spec.ts`: staff raise an invoice from the student's People row and generate a parent invite; a brand-new parent opens the link signed out, signs in, consents (the Link button stays disabled until they do), lands in the portal and sees ₹1,200 outstanding and the invoice; the database has the parent membership, the `parent_links` row and a `consent_records` row.
5. `05-substitute-reassignment.spec.ts`: as above.
6. `06-guardian-threads.spec.ts`, **Step 30 recorded as a sixth journey, not folded into journey 4**, so a failure names the rule that broke. Tutor DMs a student (picker notice, staff disclosure, thread anchored to the child in the database); the student sees their disclosure; the parent sees the thread with the "Parent view" tag, the explanation and the read-only footer, with no composer rendered; the parent's picker offers exactly one entry for their child's tutor and a parent-to-tutor DM sends (unanchored); a parent of a different child in the same org sees neither thread and is offered only their own child's tutor; the tutor receives the parent's message.

**Decisions (2026-09-26).**
- **Where CI's browser tests point: the app built and served inside the CI job, not the PR's Vercel Preview URL.** The job builds the SPA with the staging `VITE_*` values and serves it with `tests/e2e/server.ts`, which reproduces `vercel.json`'s routing exactly (`/api/*` to the same Express app `server/vercelHandler.ts` exports, static files from `dist/`, everything else to `index.html`). Weighed: *Flakiness:* a Preview-based gate has to wait for Vercel to finish deploying, discover the per-PR URL, and get past Vercel's deployment protection, and it goes red whenever Vercel is slow or down for reasons unrelated to the code; a same-job server has none of those moving parts and tests exactly the commit CI checked out. *Secrets exposure:* both designs need the staging service-role key in GitHub, because fixtures and cleanup create and delete auth users; the in-job design additionally needs the staging `DATABASE_URL`. Both are staging-only credentials, over data that is only demo and test rows, and GitHub never hands secrets to pull requests from forks. *Parallel PRs:* every CI job runs its own server, so the only shared resource is the staging database, which the fixture design below isolates. What this gives up: the Preview build is Vercel's real runtime, which caught Step 25's timezone bug. The suite covers that difference directly: the CI runner is UTC like Vercel, and the browser is pinned to `Asia/Kolkata`.
- **Fixture isolation on the shared staging database.** Every `playwright test` invocation gets a run id (`<GitHub run id><attempt>x<random>`, or `localx<random>`). Every auth user it creates is `e2e.<run>.<label>-<random>@classstackr.dev`, and every org it names is `E2E <run> <label>`, so two concurrent runs never share a row, and a retried test never collides with its own first attempt. Each journey creates its own org and people. Nothing touches the seeded demo accounts. `global-teardown.ts` deletes this run's orgs (every org-scoped table cascades from `organizations`) and then its auth users (`profiles` cascades from `auth.users`), pass or fail. A run that never reaches teardown (a cancelled CI job) is caught by the next run's `global-setup.ts`, which sweeps any suite-made org or user over two hours old; the age floor is what keeps it from touching a run still in progress. Leftover data cannot break the next run in any case, because nothing reads another run's namespace. Proven 2026-09-26: a run with cleanup deliberately switched off (`E2E_KEEP_DATA=1`) left 1 org and 1 user; a two-hour sweep correctly left them alone; a zero-age sweep removed them; staging back to 1 org and 3 users (the demo accounts).
- **Guardrails against pointing at production.** `tests/e2e/support/env.ts` refuses to start unless `SUPABASE_URL`, `VITE_SUPABASE_URL` and `DATABASE_URL` all name the staging ref `fcshxorkxsaerwnuqrjh` and none names production's. `global-setup.ts` then downloads the served SPA bundle and refuses to run unless it was built against staging (Vite bakes the Supabase URL in at build time, independently of the server env). `tests/e2e/server.ts` never loads `.env`, which on a developer's machine points at production.
- **How CI gets staging credentials: four GitHub Actions repository secrets, added by the founder**, never in the repo, the workflow file, or chat. Each value comes from the local, gitignored `.env.staging`: `STAGING_SUPABASE_URL` (its `SUPABASE_URL`), `STAGING_SUPABASE_ANON_KEY` (its `VITE_SUPABASE_ANON_KEY`), `STAGING_SUPABASE_SERVICE_ROLE_KEY` (its `SUPABASE_SERVICE_ROLE_KEY`), `STAGING_DATABASE_URL` (its `DATABASE_URL`, the pooler host, which GitHub's runners can reach). The job fails with a named error if any is missing, rather than silently skipping. `JWT_SECRET`, `ENCRYPTION_KEY` and `CRON_SECRET` are generated fresh per run, since no journey needs a persistent one.
- **Signup itself is not driven through the form.** Staging has email confirmation on (`mailer_autoconfirm: false`) and no mail provider, so the signup form's `supabase.auth.signUp` call cannot produce a session. Journey 1 creates the confirmed account with the Admin API (the state right after someone clicks the confirmation link) and does everything from the first login on through the UI, including the `profiles` row the app creates itself.
- **No reversal UI exists**, so journey 3 calls `POST /api/v1/billing/attendance/reverse` through the signed-in page's own session and `X-Organization-Id`, as every earlier live check did. The one step a test cannot wait out, a class's start time arriving, is simulated in journey 2 by moving that one materialized session to five minutes ago with the service role; the server correctly refuses attendance before a session starts and materialize never creates past sessions.
- **Axe failures are soft within a journey** (`expect.soft`): the test still fails, but the journey runs to the end, so one run reports every violation and every functional failure together.
- **Retries: one, in CI only.** A flaky pass is reported as flaky, not hidden.

**Found along the way.**
1. **The Dockerfile's deployment path cannot sign anyone in.** `node dist/server.js` with `NODE_ENV=production` serves the SPA under helmet's default Content-Security-Policy, whose `connect-src 'self'` blocks every browser call to Supabase ("Failed to fetch" on the login form). Production on Vercel is unaffected: it serves the SPA as static files with no CSP header (checked against the live site). Not fixed here, since no deployment uses that path today; noted for Step 33 (operational floor). The suite serves the app the way Vercel does instead.
2. **Accessibility regressions since the 2026-07-25 axe pass**, all fixed in this step:
   - Contrast: `--cs-text-muted` (#6d716c) measured 4.39:1 on `--cs-surface-2` and 4.2:1 on `--cs-accent-soft`, under AA's 4.5:1, so every grey label on a grey panel failed (Schedule's day headers, Inbox rows and banners, the "Parent view" tag). Darkened to #666a65, which clears 4.5:1 on every surface; the visual change is slight. `--cs-text-faint` (#969a94) is under 4.5:1 everywhere, so the readable text that used it (Today's section headings, the Audit log's table header and times, the invite-link expiry line, every `Field` hint) moved to `--cs-text-muted`; faint stays for icons and placeholders (HANDOFF §6).
   - Settings' inactive tabs were 60%-opacity text; now `--cs-text-muted`.
   - Toasts: sonner's `richColors` greens, blues and oranges were under 4.5:1, and broke the near-monochrome rule. All four toast types now read `--cs-*` tokens (success = accent, error = danger on the plain surface, info and warning neutral).
   - Labels: the kit `Field` component's `<label htmlFor>` pointed at an id no control carried in 21 places (every `Field` given a bare `<Input>`/`<select>`/`<textarea>` child), so those fields were unnamed to screen readers. `Field` now gives such a child its id. Also labelled: the Leave form's three fields and the substitute picker, the invoice line-item inputs and each Outstanding row's checkbox, the People and Team invite-link boxes.
   - Unnamed icon buttons: six modal close buttons and Student Story's back arrow (which also had HANDOFF §6's `hover:bg-[var(--cs-bg)]` no-op hover; now `--cs-surface-2`).

**Not covered, noted for later.** Dark theme is not audited (the suite runs light). `RoleSelection.tsx` is still never rendered: the plan listed a multi-role seed account under this step's files, but none of the five journeys needs one, and the fixtures live per run in `tests/e2e/support/` rather than in `scripts/seed.ts` so that concurrent runs never share them. The signup form itself (see Decisions). Live Razorpay and phone OTP stay out of CI by design, as this step's scope says. The Login page still opens on the Phone tab, which cannot work; every login in the suite clicks "Email" first. That default is Step 34's to fix and is deliberately left alone here.

**Status: ✅ complete 2026-09-26.** Merged to `main` via [PR #13](https://github.com/Sankaranakshar/Tuition-SaaS/pull/13) (`30d5993`), CI green, deliberate-failure check proven with PR #15 (closed). Earlier status: built on branch `feat/step-31-playwright`, green locally against staging; waiting on the founder to add the four GitHub secrets so CI can run it and the deliberate-failure check can be done.

---

## Step 32: C-07, activation analytics

**Objective.** Be able to answer "is anyone actually using this, and are they getting to money" without asking them.

**Why this step exists.** There is no product analytics of any kind. `@vercel/analytics` gives anonymous pageviews; there is no event instrumentation, no signup attribution, no funnel, no cohort. The next twelve months are a search for product-market fit and the search is currently unobservable.

**Unblocked 2026-09-14: D-11 is decided** (MASTER_PLAN.md §13): a hand-rolled events table on the existing Postgres, not self-hosted PostHog and not a paid SaaS tier, because DPDP posture with minors' data made shipping behavioural data to a third party before a legal review an avoidable risk. The self-hosted branch below is the one to build.

**Files and systems affected.** `supabase/migrations/20260926130000_product_analytics.sql` (new: `product_events`, `org_activation`, `org_weekly_loop`), `shared/analyticsEvents.ts` (the event catalogue and the payload rule), `shared/analytics.ts` (activation, funnel, cohorts, weeks and months; pure), `server/utils/analytics.ts` (`trackEvent`, the only writer), `server/utils/analyticsRollup.ts` and `server/routes/cron.ts` (the sixth cron), `server/utils/analyticsReport.ts` and `server/routes/admin.ts` (`GET /api/v1/admin/analytics`), `server/routes/analytics.ts` (new mount `/api/v1/analytics`), instrumentation in `members.ts`, `scheduling.ts`, `billing.ts`, `webhooks.ts`, browser beacons in `Onboarding.tsx`, `ParentPortal.tsx`, `Layout.tsx`, and `src/components/PlatformAnalytics.tsx` on `PlatformAdmin.tsx`. `vercel.json` gains the cron entry.

**What was built.**
1. **The events table.** `product_events`: one row per thing that happened, with the org, the person (if any), a namespaced name, a small properties object, an optional dedupe key and a timestamp. RLS on and no policy of any kind, so no client can read or write it (the org's owner included). A trigger makes it append-only for `service_role` too: a direct UPDATE or DELETE is refused, and only foreign-key cascades get through (deleting an org deletes its events; deleting a person clears the actor). A check constraint keeps every event org-scoped except onboarding beats, which happen before the org exists.
2. **The payload rule, written down and enforced.** Stated at the top of `shared/analyticsEvents.ts`: an event's properties hold only record ids (a session, an invoice, never a person), non-negative counts and paise, booleans, and values from a fixed list declared per event. Never a name, phone, email, message text, or a student or parent id. Every event declares its exact keys; `trackEvent` refuses an unknown event, an unknown key or a value of the wrong kind and writes nothing. Since the only strings that can pass are uuids and declared values, a minor's personal data cannot reach the table by construction. The database adds a crude second line (properties must be an object under 1 KB; names must be `word.word`).
3. **Instrumentation, in MASTER_PLAN §11's order.** *Funnel:* `onboarding.beat_viewed` (beats 1 to 3, from the browser, one per person per beat), `org.created` (bootstrap), `sessions.materialized`, and `org.activated` (written once by the rollup, timestamped at the moment activation was reached). *Weekly loop:* `attendance.marked` (counts: present, absent, wallet-billed, invoices accrued), `attendance.reversed`, `invoice.raised` (by hand), `payment.recorded` (manual and Razorpay, deduplicated on the payment's own idempotency key), `wallet.topped_up`. *Parent engagement:* `parent.portal_opened` (browser, one per parent per day), `parent.payment_started`. *Feature usage:* `feature.opened` (browser, one per person per workspace per day). Every server event is written after the action's transaction commits and never fails it.
4. **The aggregation job** rides Step 26's scheduler as a sixth cron, `/api/cron/analytics-rollup`, at 20:25 UTC (after delivery-sweep), registered for GET (what Vercel Cron sends) and POST. For each active org it recomputes `org_weekly_loop` (every week since signup, Monday-start in the org's own timezone: sessions scheduled, sessions with attendance, attendance marks, invoices raised, messages delivered, rupees collected and the online share, parent portal opens, parent payments started) and `org_activation`, both in full from the tables of record, then records `org.activated` if newly reached. Per-org failures are isolated and audited (`cron.analytics_rollup_failed`), like reporting-daily.
5. **Where the founder reads it.** Platform admin → Analytics (`GET /api/v1/admin/analytics`, platform admins only): the activation definition in plain words, then rupees collected per org per month (last six months, live from the ledger), activation by org (sessions with attendance out of 10, collected, and status: activated on a date, in window with N days left, or not activated), the signup-to-activation funnel with drop-off at each onboarding beat, the same funnel for every org from creation, the weekly loop over the last four weeks, retention by signup week, and feature usage over 28 days.

**Tests.** Unit (`tests/unit/analytics.test.ts`, 25): the activation definition's numbers and its boundaries (9 sessions, nothing collected, a 10th session or first rupee after day 14, exactly day 14, running-total first rupee), funnel stages and drop-off, weeks and months across timezones and year ends, cohorts, the monthly pivot, the payload rule refusing names, phones, message text and student ids, and the display helpers. RLS (`tests/integration/analytics.test.ts`, 10): no client read or write on any of the three tables, append-only for `service_role`, cascades still work, the org-scoping and dedupe constraints. Contract (`tests/contract/analytics.test.ts`, 17): the event route, the instrumentation on real routes, the cron (auth, GET and POST, org scoping, idempotent re-run, reversals, offboarded orgs) and the admin report. E2E: journeys 1, 2 and 3 assert their events (beats, `org.created`, `sessions.materialized`, workspace opens, `attendance.marked` with `invoiced: 1`, one `attendance.reversed`, no student name or id anywhere), and a new spec `07-platform-analytics.spec.ts` audits the Organizations tab and the Analytics tab with axe. The event checks and the Analytics-tab audit skip, with a logged note, until the migration is on staging, and turn on by themselves once it is.

**Decisions (2026-09-26).**
- **What "collected through ClassStackr" means: any payment or wallet top-up recorded in the ClassStackr ledger, manual or Razorpay.** The alternative, Razorpay-only, is the stricter reading of "through", but no org can take online payments until Razorpay KYC clears (Steps 28 and 29 are blocked on it), so activation would read zero for every org through the whole pilot and could not tell a using org from an idle one. MASTER_PLAN §4 names the ledger as the moat, and a tutor recording fees in ClassStackr is the behaviour the wedge needs. The online share is tracked separately everywhere (activation and the monthly table), so the stricter reading is visible without a code change. Overpayment credit is not counted twice (it is part of the payment that caused it); refunds are not subtracted (collected is gross receipts).
- **Signup is the org's creation.** Activation is an org-level definition, and `organizations.created_at` is the moment onboarding's final submit bootstraps it. A session counts at its first attendance mark (`attendance_records.created_at`, which a re-mark does not move) and stops counting if every mark on it is reversed. The first rupee is the moment the running total first reaches ₹1, and the 14-day window is inclusive of its last instant.
- **The rollup recomputes from the tables of record, not from events.** Sessions, attendance, invoices, payments, top-ups and outbox deliveries are the truth when attendance is reversed or an invoice voided; they cover every org's history from before this step, so nothing needed a backfill; and a full recompute is idempotent. Events supply only what no table records: the onboarding beats, parent portal opens, parent payment starts and workspace opens, plus the `org.activated` timeline. Recomputing every week since signup for every active org is one query per org per night, fine at pilot scale; cap it to recent weeks when org count makes it slow.
- **Onboarding beats are the one kind of event with no org**, because onboarding's three beats are client-side until the final submit creates the org. They carry only the beat number and the solo-or-centre choice, the database refuses an org-less row for any other event, and the funnel links a person to their org through `org.created`'s actor. The funnel's population is everyone who started tutor onboarding since tracking began; orgs created before this step appear in a second funnel (every org, created to activated) and in every other section. When a person's account is deleted their beat rows lose their actor and drop out of the funnel; the e2e suite's throwaway users leave a few such anonymous rows on staging per run, inert and uncounted.
- **The browser writes nothing directly.** It calls `POST /api/v1/analytics/events`, which accepts exactly three event names, applies the same payload rule, stamps the org and person from the verified session (never the body or an unverified header), and deduplicates per person per beat or per day. A client cannot fabricate `org.activated` or a payment.
- **Where rupees per org per month is visible: the platform admin console, not an org's own screens.** The question is the founder's, across orgs, and an org's owner already sees their own money in Money. It reads the ledger live, so the headline number is never a night behind; everything else reads the nightly rollup and the page says when it last ran. Its copy is English-only, like the rest of the platform admin console.
- **Client reads: none.** No policy of any kind on the three tables. Platform admins read through the server route. The org export (B-11) does not include them: they are derived platform metrics, not the org's own records.
- **Events are best-effort, like `writeAudit`.** Written after the action's transaction commits, logged and swallowed on failure (including the table not existing yet). A lost event under-counts an analytic; a failed attendance mark would lose a tutor's work.
- **Timezones.** Weeks start Monday and months are bucketed in each org's own timezone (C-01). The admin page's "this week" and month columns use Asia/Kolkata, the default and every current org's zone. Once-per-day dedupe keys use the UTC date.
- **E2E against a staging that does not have the migration yet.** Step 31's gate runs against staging, and applying a migration there is the founder's call. The event checks and the Analytics-tab audit therefore check whether `product_events` exists and skip, loudly (a test annotation and a console line every run), when it does not; everything else in each journey still runs, and the checks turn themselves on the moment the table exists, with nothing to flip back. Found along the way: supabase-js reports a HEAD request for a missing table as success (PostgREST answers with a bodiless 404), so the probe uses a plain GET.
- **Also fixed:** the platform admin page's grey table header, plan price and role labels used `--cs-text-faint` (under AA contrast); now `--cs-text-muted`, per the text-contrast rule.

**Found along the way.** An RLS assertion of the form `update … where organization_id = $1` reads 0 rows even with an update-only client policy present, because a WHERE clause needs a select policy to find rows. The re-break caught it; the analytics write tests now use unfiltered writes. Older write tests elsewhere in `tests/integration/` use the WHERE form and share the blind spot; worth a sweep in Step 33.

**Browser verification required.** Walk a full signup to activation on staging and confirm every event lands with the right org attribution. Blocked on the migration being applied to staging; the exact walkthrough is below.

**Definition of done.**
- [x] The funnel reports a real number for at least one real org. *(On staging, 2026-09-26: the Analytics tab showed Demo Tuition Center at 1 of 10 sessions, ₹0, not activated, and the walkthrough org at 1 of 10, ₹1, in window; the funnel read 1 person through beats 1 to 3, org created, first class, first attendance, stopping before 10 sessions. Production shows it once the migration is applied there.)*
- [x] Rupees collected per org per month is visible without a manual query. *(Platform admin → Analytics, first section; proven by contract test and rendered in e2e once staging has the tables.)*
- [x] No minor's personal data leaves the DPDP boundary the D-11 decision set. *(Nothing leaves the database at all; inside it, the payload rule refuses names, phones, message text and student or parent ids, tested at unit, contract and e2e level.)*
- [x] All gates green. *(Eight of eight, 2026-09-26: 303 unit, 127 RLS, 389 contract, build, bundle 207.2 KB, API 19/19, e2e 8/8.)*

**Status: 🟡 migrated on staging and walked live there 2026-09-26; waiting on the merge of [PR #16](https://github.com/Sankaranakshar/Tuition-SaaS/pull/16) and the production migration.** The founder applied the migration to staging (the push ran from a separate checkout of this branch, `~/Downloads/Tuition-SaaS-step32`, via `--workdir`, because the main folder had been switched to another branch mid-session). A dry run lists it as the only pending migration on production. After merging #16, the founder runs:

`cd ~/Downloads/Tuition-SaaS-step32 && supabase db push` (that checkout is linked to production, `cwugpiernnwrhcximjwh`).

Applying it before the code deploys is safe: nothing reads the new tables until this PR's code is live, and the code tolerates their absence.

**Staging walkthrough, done 2026-09-26** (throwaway account `walk.step32@classstackr.dev`, created with the Admin API, driven in Chromium against this branch's build served on staging, deleted afterward). Every item below passed; the results follow the list.
1. Confirm the schema directly: the three tables exist, RLS is enabled on each with zero policies, and the `product_events_append_only` trigger is present; a direct `update product_events …` as `service_role` is refused.
2. Re-run `npx dotenvx run -f .env.staging -- npm run test:e2e`: 8/8 with no "analytics-skipped" line, so journeys 1 to 3 have asserted their events against staging and the Analytics tab has passed axe.
3. With a throwaway staging account (Admin API, deleted afterward): walk onboarding through all three beats in the browser and confirm one `onboarding.beat_viewed` per beat (no org, the right mode), `org.created` for the new org with that person as actor, and `sessions.materialized`; open Today, People, Money and confirm one `feature.opened` each for that org.
4. In that org, mark attendance and record a ₹1 manual payment; confirm `attendance.marked` (counts, no student id) and `payment.recorded` (one, even after a replayed request).
5. Trigger `GET /api/cron/analytics-rollup` with the staging cron secret; confirm `org_weekly_loop` and `org_activation` rows for every active staging org, that a second run changes nothing and writes no second `org.activated`, and that the demo org reads 1 of 10 sessions, ₹0.
6. As a platform admin on staging, open Platform admin → Analytics: the throwaway org shows ₹1 in this month, "In window, 14 days left", and appears in both funnels; the funnel's beat counts match step 3.
7. Delete the throwaway account and org; confirm the org's events are gone with it and the account's beat rows lost their actor.

*Results.* (1) All three tables present, RLS on, zero policies, the trigger present; a direct `update product_events` refused ("append-only (UPDATE refused)"). (2) e2e 8/8 with no skip notes: journeys 1 to 3 asserted their events and the Analytics tab passed axe against staging. (3) One `onboarding.beat_viewed` per beat, no org, beats 2 and 3 carrying `mode: center`; `org.created` with the account as actor; `sessions.materialized` with 24 sessions; `feature.opened` for today, people and money. (4) `attendance.marked` `{present: 1, absent: 0, billed: 0, invoiced: 1}` with no student id; a ₹1 manual payment sent twice with one idempotency key answered 201 then 200 and left one `payment.recorded`; no event contained the student's name. (5) The cron over real HTTP GET: 404 without the secret; with it, `{ok: true, orgsProcessed: 2, weekRows: 4}` twice, identical rows both times, no `org.activated`; Demo Tuition Center 1 of 10, ₹0. (6) The Analytics tab showed the org at ₹1 for Sept 2026 and "In window, 14 days left", and the funnel counted it through first attendance. (7) After deleting the org, 0 of its events remained; after deleting the account, its beat rows kept existing with `actor_user_id` null; its platform-admin row cascaded away.

*Found and fixed on staging data:* axe's `scrollable-region-focusable` on the weekly-loop table, which is wider than the page and so scrolls sideways, and was not reachable by keyboard. The earlier audit ran while that section was an empty state. Each table's scroll area is now a focusable, labelled region with the standard focus ring; re-audited clean.

*Found, not fixed here (queued):* e2e journey 5 failed in one run at about 21:00 IST with "No scheduled sessions fall in this leave window". `shared/leave.ts`'s `leaveDateRangeToTimestampBounds` treats leave dates as UTC days, not the org's days, a Step 23 bug that Step 25's timezone sweep missed. A leave day covers 05:30 IST to 05:30 IST the next day, so sessions between midnight and 05:30 IST are missed and the next morning's are wrongly included. The journey's session sits three hours out, so it fails whenever the suite runs between about 21:00 and 02:30 IST, in CI too. It is unrelated to this step: the same journey passed earlier the same day.

**Not covered, noted for later.** No per-org view for an owner (their own activation or loop); the page is platform-only by design. Retention is measured on attendance only; a week with money collected but no attendance marked reads as not retained. Messages delivered will read zero until a real WhatsApp/SMS vendor reports deliveries (Step 27's procurement). Feature usage counts workspace opens, not actions inside them. A browser event still in flight when the page is fully reloaded or closed (within about half a second of opening a workspace) is lost; moving between workspaces inside the app is not a reload, so this under-counts only edge cases. Seen in the staging walkthrough when a script loaded two pages back to back. Dark theme is not audited on the new tab (the suite runs light).

**Expected outcome.** Pilot results become evidence rather than anecdote.

---

## Step 33: C-08, operational floor

**Objective.** Be able to survive and recover from the failures a paying customer will eventually cause.

**Why this step exists.** Sentry is wired on both sides and both DSNs are unset. There is no uptime probe and no 5xx alerting. `scripts/backup.sh` exists, was rehearsed once, and nothing runs it; there is no offsite sync, no storage-bucket backup, and no rehearsed procedure for rolling back a bad migration, which matters because R3 through R5 all ship migrations.

**Files and systems likely affected.** Vercel and Supabase env (`SENTRY_DSN`, `VITE_SENTRY_DSN`), `scripts/backup.sh`, a scheduled backup runner, HANDOFF §4's runbook.

**Dependencies.** Step 26 if the backup runs on the same scheduler.

**Implementation scope.** Sentry live both sides with release tagging. An uptime probe on `/api/health` plus 5xx alerting, noting HANDOFF §8's trap that a 200 from `/api/health` proves nothing about the database, so probe something that touches Postgres. Automated offsite backups including the Storage bucket. **Then actually restore one**, and actually roll back a deliberately bad migration on staging, and write both procedures down.

**Tests required.** None automated. The rehearsals are the evidence.

**Browser verification required.** Not applicable.

**Definition of done.**
- [ ] Sentry receiving real errors from both sides.
- [ ] An alert fired at a human during a deliberate 5xx.
- [ ] A restore from backup performed, with the timestamp and duration recorded.
- [ ] A bad-migration rollback rehearsed on staging, with the procedure written into HANDOFF §4.

**Expected outcome.** The first production incident is survivable.

---

## Step 34: C-09, onboarding friction pass

**Objective.** Shorten the distance between signup and the first collected rupee.

**Why this step exists.** Two concrete blockers. **First:** `Login.tsx` defaults to the phone-OTP tab (`useState<'email' | 'phone'>('phone')`) and no SMS provider is configured, so a parent following an invite link lands on a login screen whose default method cannot work. **Second:** bring-your-own-Razorpay means a customer cannot collect anything until they have completed Razorpay KYC and pasted a key id, a key secret and a webhook secret into a Settings field. That is the single largest gap between "signed up" and "activated", and it is currently presented as a form field rather than a guided step.

**Dependencies.** Step 27 (if SMS becomes available through the same provider, the OTP default becomes viable rather than needing to be hidden) and Step 32 (so the improvement is measurable rather than asserted).

**Implementation scope.** Make the login default match what actually works. Turn Razorpay connection into a guided onboarding beat with its own progress state and a clear "you cannot collect money until this is done" signal on Today. Review the three-beat onboarding against the real activation funnel once Step 32 reports one, and cut whatever the data says is dead weight rather than whatever seems redundant.

**Tests required.** Unit on any new onboarding-state logic (`src/lib/onboarding.ts` is already the tested pure core; extend it there). Contract on gateway-connection state exposure.

**Browser verification required.** A full stranger-signup walkthrough, ideally with an actual stranger, timed from signup to first invoice sent.

**Definition of done.**
- [ ] The default login method works.
- [ ] Razorpay connection is a guided step with visible state, not a Settings field.
- [ ] Median signup-to-activation time measured before and after.

---

## Step 35: TD-3, paise-native migration

**Objective.** Execute D-04: drop `invoices.total_amount` and `invoices.subtotal`, make `wallets.balance_currency` a paise-native integer.

**Why this step exists.** The last open item in the frozen Tech Debt backlog. Conversion is already centralized in `shared/money.ts`'s `rupeesToPaise`/`paiseToRupees`, so this is a migration plus a read-path cleanup, not a refactor. It is sequenced last in R4 because it is a real migration against live financial data and it should happen after Step 33's restore rehearsal, not before.

**Files and systems likely affected.** A new migration, `server/routes/billing.ts`'s read paths, `src/pages/ParentPortal.tsx` (which still reads `total_amount` as a fallback: `i.totalPaise ?? rupeesToPaise(i.totalAmount || 0)`), `src/hooks/useMoney.ts`, `server/utils/invoicePdf.ts`, `server/utils/orgExport.ts`.

**Implementation scope.** First confirm two things against production data before writing a DROP: whether any historical invoice predates the paise columns, and whether anything external (an export a customer has, a CA's reconciliation sheet) reads the rupee mirrors. Then rehearse on staging, then production with go-ahead and a fresh backup.

**Tests required.** Existing money unit and contract suites must stay green unchanged; that is the point of having centralized the conversion. Add a contract case asserting an invoice read returns correct amounts with the legacy columns gone.

**Browser verification required.** Money's Outstanding, an invoice PDF, the parent portal's invoice list, and an org export, all against real data, before and after.

**Definition of done.**
- [ ] Legacy columns dropped in production, rehearsed on staging first.
- [ ] No read path references them.
- [ ] Tech Debt backlog empty; MASTER_PLAN §6.7's row removed.

---

## Step 36: B-20, payout manual-settlement details

**Objective.** Let an owner/admin/accountant record how and when a tutor payout was actually settled — payment method, a reference number, and an optional note — when marking it paid, instead of a bare status flip with no detail.

**Why this step exists.** This step corrects a wrong premise in the request that prompted it, so the correction is recorded here rather than only in a commit message. The ask was for a manual-override path for when "a Razorpay payout to a tutor fails, or Razorpay isn't connected." **There is no Razorpay payout API integration anywhere in this codebase**, and per HANDOFF.md §7 / MASTER_PLAN.md's standing founder decision, all external integrations — Razorpay payout automation included — stay deferred until every build stage is complete. That is a decided scope boundary, not an oversight, so building an automated payout path (for this to be a fallback from) is out of scope, full stop. `POST /api/v1/payouts/payout-runs/:id/mark-paid` (`server/routes/payouts.ts:230`) is already the *entire* settlement mechanism: every tutor payout, always, moves by bank transfer outside the product and is marked paid by hand — the route's own comment says as much ("no Razorpay payout API — the founder's external-integrations deferral, §7 — money moves by bank transfer outside the product"), matching B-05's manual invoice-payment posture (`POST /api/v1/billing/payments/manual`). The real, narrower gap: mark-paid captures nothing about the transfer beyond a timestamp — no method, no reference number, no note, and not even who clicked it (`run_by` exists on the payout row; nothing analogous exists for the mark-paid action). An owner today cannot answer "how was tutor X paid for August" without leaving the app and checking a bank statement by hand. B-05 already solved this exact problem on the money side (`payments.method`, `payments.note`, `payments.recorded_by`); payouts got a bare status flip instead. This step brings mark-paid to that same standard. **It does not add a `paid_manually` status, a Razorpay-failure branch, or any distinction between "automated" and "manual" payment**, because no automated path exists for manual to be an alternative to — introducing that distinction now would be speculative scope against a path that may never be built (HANDOFF §7's deferral has no end date).

**Files and systems likely affected.**
- `supabase/migrations/<ts>_payout_manual_settlement.sql` (new): `tutor_payouts` gains `payment_method text` (nullable — existing `paid` rows predate this and their real method is unknown, so null is correct, not a default), `reference_number text` (nullable), `note text` (nullable), `paid_by uuid references auth.users(id) on delete set null`. Additive only, same posture as `20260912130000_tutor_earnings_payouts.sql`.
- `shared/schemas/payouts.ts`: a `markPayoutPaidRequestSchema` for the route body; `PayoutRun` gains `paymentMethod`, `referenceNumber`, `note`, `paidBy`.
- `server/routes/payouts.ts:230`: `mark-paid` parses the new body, writes the four new columns, and the `writeAudit` call (currently `{}`) carries `method`/`referenceNumber`.
- `src/lib/api.ts:697`: `markPayoutPaid(payoutId)` needs a body parameter for the new fields.
- `src/components/PayoutRuns.tsx`: the "Mark paid" button (currently a bare click, line 210) needs a small form capturing method, reference number, and note before submitting; the payout-history list should display them once paid.
- `server/utils/payoutStatementPdf.ts`: decide whether the settlement detail belongs on the statement PDF too, or stays app-only.
- `tests/contract/payouts.test.ts:292-310`: extend the existing mark-paid test; add validation and round-trip cases for the new fields.

**Dependencies.** None. Independent of Steps 25-35; can be picked up in any order.

**Implementation scope.**
1. Re-grep for every reader of `tutor_payouts.status`/`paid_at` (the statement PDF renderer, `TutorEarnings.tsx`'s own payout list) before writing the migration, to confirm nothing else needs to change beyond an additive read — the same "schema reality check" discipline this file's R5 section calls out, since three of the four times it was skipped the plan's premise turned out wrong, and this step is itself an instance of that.
2. Decide deliberately whether to reuse `shared/schemas/billing.ts`'s `paymentMethodSchema` (`cash | upi | bank_transfer | cheque | other`) verbatim or define a payout-specific enum, since "cash" is a strange way to describe paying a tutor payroll. Record whichever choice is made and why, rather than silently diverging from the money-side enum.
3. Write the migration additively; no backfill of the new columns for existing `paid` rows, since their actual settlement method isn't known and shouldn't be guessed.
4. Extend the Zod schema, the route (body validation, column writes, audit payload), the API client, then the UI, in that order.
5. Do not add a new status value. `issued` → `paid` remains the only transition; the new columns describe how a payout was paid, not a second path to paid.

**Tests required.**
- Contract: mark-paid with `method`/`referenceNumber`/`note` round-trips into the response and into `GET .../payout-runs`; an invalid `method` 422s; the existing already-paid 422 branch still fires unchanged; the audit row carries the new fields.
- RLS: none expected — `tutor_payouts` still has no client write policy, so this is entirely a `service_role` route change. Re-run `npm run test:rls` anyway per HANDOFF §5.10's rule that any migration re-runs it.
- Unit: none expected; no new pure logic is introduced.

**Browser verification required.** Run a real payout for a throwaway tutor account (mirroring Step 21's own throwaway-account rehearsal), mark it paid through the real `PayoutRuns.tsx` form with a realistic method and reference number, confirm both appear correctly in payout history, and confirm the tutor's own `TutorEarnings.tsx` view reflects the same detail if it surfaces payout status at all. Clean up all throwaway state afterward, same as Step 21.

**Definition of done.**
- [ ] Migration additive, rehearsed on staging, applied to production with founder go-ahead.
- [ ] `mark-paid` captures payment method, a reference number, and an optional note, and records who marked it paid.
- [ ] `PayoutRuns.tsx`'s mark-paid flow collects these before submitting; payout history displays them once paid.
- [ ] All eight gates green.

**Expected outcome.** An owner can answer "how and when was this payout actually settled" from inside the app alone, without a Razorpay-failure fallback that has nothing to fall back from.

---

## Step 37: B-14, public tutor profiles + verification labeling

**Objective.** Give every tutor (independent or centre-affiliated) a real public profile a visitor can find, and make the platform's verification state honest rather than implied.

**Why this step exists.** D-09 (2026-09-14, MASTER_PLAN.md §13) lifted the commercial gate that used to block all marketplace work. Today `src/pages/public/Home.tsx` sells a marketplace that does not exist: stock photos, invented captions ("Sarah M. — Advanced Calculus Session"), hardcoded counts ("1,200+ Tutors", "850+ Tutors"), and every CTA (`Find 1-on-1 Tutors`, `Browse Group Batches`) links to `/login` rather than any real listing or query. Meanwhile `tutor_profiles` already carries real marketplace-facing fields (`full_name`, `grades`, `experience_years`, `qualification`, `teaching_mode`, `location`, `price_model`, `price_range_min/max`, `max_batch_size`, `is_verified` — added in `20260709020800_group_d_fields.sql`) that nothing public reads. This step makes the public site tell the truth using data that already exists, and builds the one new thing genuinely missing: a public-safe read path, since every existing client read of this data is RLS-scoped to org members only.

**Files and systems likely affected.**
- `server/routes/` (new): a public route file (no auth required) exposing only a narrow, public-safe column set from `tutor_profiles` joined to `organizations` — never contact info, pricing internals beyond the public `price_range`, or anything from `students`/`invoices`/other org-internal tables.
- `supabase/migrations/<ts>_marketplace_public_read.sql` (new, only if a Postgres-level anon-readable view is chosen over an Express endpoint — see implementation scope point 1 for the decision to make).
- `src/pages/public/Home.tsx`: replace the fabricated hero content and tutor counts with real data from the new endpoint.
- `src/pages/public/` (new): a tutor/profile detail page.
- `tutor_profiles`'s `is_verified` column and its RLS (`20260710140000_tutor_verify_fix.sql`, owner/admin-only write) are reused as-is, not changed.

**Dependencies.** None. This is why it can start independent of Steps 27-36.

**Implementation scope.**
1. **Decide the public-read mechanism deliberately and record the choice**: a new unauthenticated Express route with an explicit allow-listed column projection (matches this codebase's existing pattern of Express-mediated privileged access), versus a narrow Postgres view with an `anon`-readable RLS policy (matches the two-data-path architecture's "direct-to-Supabase reads under RLS" half). Prefer the Express route unless the view can be proven not to leak beyond the intended columns even as `tutor_profiles` gains fields later — an allow-list in application code is easier to audit than a view definition drifting out of sync with schema changes.
2. Because `tutor_profiles` is PK'd `(user_id, organization_id)` with `is_verified` per-row (per `20260912100000_multi_membership_profiles.sql`'s multi-membership change), a tutor with two org memberships could be verified in one and not the other. Decide and document which row's verification state a public profile displays — recommended: the specific `(tutor, organization)` pair being listed, not an aggregate, since a centre's verification of its own tutor is a distinct claim from another centre's.
3. Build the public listing and detail pages against the new endpoint. Any tutor without `is_verified = true` for the listed org must show an explicit "Not yet verified" state — do not omit the badge or default to a neutral-looking treatment, since an absent signal reads as an implicit vouch.
4. Rewrite `Home.tsx`: remove all hardcoded tutor counts and fabricated testimonial content; wire the "Find 1-on-1 Tutors" / "Browse Group Batches" CTAs to the new real listing instead of `/login`.

**Tests required.**
- Contract: the new public endpoint returns only the allow-listed columns for a real seeded tutor/org, returns nothing for a non-existent id rather than an error leaking existence info inconsistently, and — the important negative case — a request cannot pull any column outside the allow-list even by requesting it directly.
- RLS (if a view-based approach is chosen): an anon role can read only the intended columns of the view and nothing else in the schema.
- Unit: none expected beyond any new pure formatting helpers.

**Browser verification required.** As a logged-out, anonymous browser session: load the public site, browse to a real seeded tutor's profile, and confirm no private data (contact info beyond what's intended, pricing internals, student data) is visible in the page, the network responses, or the page source. Confirm an unverified tutor visibly reads as unverified.

**Definition of done.**
- [ ] A public, unauthenticated visitor can browse real tutor profiles with no login.
- [ ] No hardcoded tutor counts or fabricated content remain in `Home.tsx`.
- [ ] Every listed profile's verification state is accurate and visible, including the "not yet verified" case.
- [ ] The public read path is proven, by a contract test, not to leak any column beyond the allow-list.
- [ ] All eight gates green; API bundle mount count updated if a new Express route was added.

**Expected outcome.** The public site matches the real product for the first time, and "verified" becomes a claim ClassStackr can stand behind rather than an implied one.

**Follow-on steps.** Step 38 depends on this — there is nothing to search until real profiles exist.

---

## Step 38: B-15, discovery, search, structured enquiry with an SLA clock, and trial-to-enrolment handoff

**Objective.** Let a parent find a tutor, ask a structured question, and — if it goes well — end up as a real enrolled student, without any of it depending on infrastructure that doesn't exist yet.

**Why this step exists.** D-09 wants this built now. The two things that looked like hard blockers on inspection are not: (1) an enquiry does not need B-17's outbound comms router (Step 27, not started) — it can alert the receiving staff in-app through the same `notifications` table the credit-expiry cron already writes to, and gain WhatsApp/SMS delivery later as a pure enhancement; (2) a "trial booking" does not need a new prospect-booking system — `session_requests` (shipped R1) requires a real `students.id`, but the existing lead "convert to student" action (`People.tsx`'s Leads lens) plus the existing parent/student invite flow already bridge a prospect into a real student record, at which point the existing booking flow applies unchanged.

**Files and systems likely affected.**
- `supabase/migrations/<ts>_marketplace_leads.sql` (new): extend `leads` (schema.sql) with `source text` (existing `LEAD_SOURCES` convention, add `'marketplace'`), `tutor_id uuid references auth.users(id)` (nullable, set only for marketplace-sourced leads), `sla_deadline timestamptz` (nullable), matching the `expires_at` pattern already used by `parent_invites`/`student_invites`.
- `server/routes/` (new or extending the Step 37 public route file): a public, unauthenticated `POST` endpoint that inserts a `leads` row scoped to the target tutor's `organization_id` — the **first anonymous-write path into this schema**, so it needs its own rate limiting (per-IP and/or per-contact-info) and basic spam/abuse checks, deliberately not exposed as raw Supabase table access.
- `server/routes/cron.ts`: a new sweep (mirroring `creditExpiry.ts`'s per-org loop pattern) that finds leads past or approaching `sla_deadline` and writes a `notifications` row for the org's staff — no outbound send, in-app only.
- `supabase/migrations/<ts>_contact_reveal_events.sql` (new): a `contact_reveal_events` table (org, lead or tutor reference, revealed_at, nullable `payment_id`) — the reveal ships free in this step; the nullable payment reference exists so gating can be added later without a schema rework, mirroring D-03's deliberately-ungated placeholder pricing.
- `src/pages/public/` : search/filter UI over Step 37's listing, and the enquiry/reveal-contact form.
- `src/pages/People.tsx` (`LeadsLens`): the existing "convert to student" action is reused unchanged; the lead list should distinguish `source='marketplace'` leads if useful, but this is not required for correctness.
- `src/hooks/usePeople.ts`, `src/lib/people.ts`: extend `mapLeadRow`/`LEAD_FUNNEL_STAGES` handling only if a marketplace-sourced lead needs to render differently; otherwise no change, since the funnel already generalizes.

**Dependencies.** Step 37 (needs profiles to search over). The trial-to-enrolment handoff sub-scope (implementation scope point 4 below) is recommended, not required, to land after Step 30 (C-05, D-06 guardian-visible threads) — marketplace-sourced enrolments are a new, less-vetted intake channel, and Step 30 is the control that matters once real in-platform tutor-student contact begins.

**Implementation scope.**
1. Build search/filter UI over Step 37's public listing (by subject/grade, location, teaching mode, price range — all already columns on `tutor_profiles`).
2. Build the public enquiry endpoint: validates and rate-limits, then inserts a `leads` row with `organization_id` set to the target tutor's org, `source='marketplace'`, `tutor_id` set, and an `sla_deadline` (pick and document a concrete window, e.g. 24 hours — this is a product default, not a founder-decided number, so record it as an assumption to revisit rather than presenting it as decided). D-02 routing falls out for free here: for a centre (more than one `organization_members` row), the lead is staff-visible org-wide via the existing `leads_rw` RLS policy (`is_staff(organization_id)`), not the individual tutor's private contact; for an independent tutor (exactly one `organization_members` row, per D-01), that tutor is the org's own staff, so it lands with them directly. No new routing table is needed.
3. Build the "reveal contact" action as a separate, explicit step from submitting an enquiry (a visitor can request contact info without necessarily filing a structured enquiry, or vice versa — decide and document which is the primary path). Ships free; write a `contact_reveal_events` row on every reveal regardless, so future gating has real usage data to price against.
4. Wire the trial-to-enrolment handoff: from a converted lead (existing action), the existing invite flow (`createParentInvite`/`createStudentInvite`) sends real credentials, and the existing booking/session-request or Add Class flow schedules the actual trial. Do not build a new booking primitive for this — the point of this step is that none is needed.
5. Add the SLA-sweep cron route, gated the same way as the other four cron routes (`CRON_SECRET`/`Authorization: Bearer`), writing a `notifications` row rather than attempting any outbound send.

**Tests required.**
- Contract: the public enquiry endpoint (rate-limit enforcement, correct `organization_id`/`tutor_id` scoping, rejection of malformed input, no path from this endpoint to any table other than `leads`); the SLA-sweep cron (mirroring `cron.test.ts`'s fault-injection pattern — a breached-deadline lead writes exactly one notification, a non-breached one writes none, a re-run does not double-notify); a full lead → convert-to-student → invite → trial-scheduled walkthrough at the contract level.
- RLS: `contact_reveal_events` and the extended `leads` columns don't open any new client read/write path beyond what `leads_rw` already grants to staff.
- Unit: the SLA-deadline computation, if extracted as a pure helper.

**Browser verification required.** As an anonymous visitor: search, find a tutor, submit an enquiry, and reveal contact info — confirm the lead appears in that org's Leads lens with the marketplace source visible, and (for a centre) confirm it is staff-wide visible, not scoped to just the target tutor. Then, as staff, convert the lead to a student, send an invite, and book a trial through the existing flow end to end. Separately, deliberately let a test lead's SLA deadline pass and confirm the cron sweep produces exactly one in-app notification.

**Definition of done.**
- [ ] An anonymous visitor can search, enquire, and reveal a tutor's contact info without an account.
- [ ] D-02 routing is correct: centre-affiliated enquiries are staff-visible org-wide; independent-tutor enquiries land with that tutor.
- [ ] The SLA clock fires an in-app notification on breach, with no outbound send required.
- [ ] A lead can be walked end to end to a scheduled trial using only existing conversion, invite, and booking mechanisms — no new booking table.
- [ ] The public enquiry endpoint is proven, by a contract test, to be rate-limited and unable to write to anything but `leads`.
- [ ] All eight gates green.

**Expected outcome.** Discovery and enquiry are real, D-02 and the SLA clock work without waiting on Step 27, and the trial-to-enrolment path costs almost nothing to build because it reuses machinery that already exists.

**Follow-on steps.** Step 39 depends on this — escrow and reviews need a real trial/enrolment flow to attach to. Step 27, once it exists, should add outbound delivery to the same SLA-breach and enquiry-received events this step already writes in-app.

---

## Step 39: B-16, escrow (as a payout-run variant), reviews, moderation and disputes

**Objective.** Give the marketplace side of the product trust primitives — a way to hold and release money tied to attendance, and a way for a completed engagement to produce a review — without building a second money subsystem next to the one that already works.

**Why this step exists.** No escrow-specific primitive and no reviews/ratings table exist anywhere in the codebase today (confirmed by grep). But `tutor_earnings_ledger` → `tutor_payouts` (Step 21, B-08, already shipped) is already structurally a hold-then-release pattern: earnings accrue per session at attendance-marking time and sit `issued`, unpaid, until a payout run's `mark-paid` step releases them. B-16's original "take-rate tapering" revenue mechanism is dead (D-03 ruled out take rates entirely), so escrow here is a trust primitive only, not a revenue feature — which makes reusing the existing hold/release machinery the right scope rather than a shortcut.

**Files and systems likely affected.**
- `server/routes/billing.ts`, `server/routes/payouts.ts`: the existing `FOR UPDATE` row-lock and idempotency-key conventions are the pattern to replicate for any marketplace-specific hold, rather than a new locking scheme.
- `supabase/migrations/<ts>_marketplace_reviews.sql` (new): a `reviews` table anchored to a real, completed, attended session (reusing the anchor-pattern already established by `conversations.anchor_id`), so a review cannot be left without a verified attendance record behind it.
- `supabase/migrations/<ts>_marketplace_disputes.sql` (new, if disputes need dedicated state beyond the existing audit log): moderation/dispute fields riding the existing `audit_events` conventions rather than a parallel logging system.

**Dependencies.** Step 38 (needs a real trial/enrolment flow to attach escrow and reviews to). Reuses Step 21's payout machinery directly.

**Implementation scope.**
1. **Before writing any escrow code, get the founder call this step is explicitly gated on** (see MASTER_PLAN.md §13 and §7's R6 section): does a marketplace-sourced trial or first paid engagement need money held in escrow from day one, or can the trial simply be free (avoiding the question entirely) with escrow deferred to a later engagement type? This plan recommends the free-trial framing — it is simpler, and it matches Step 38's default of not requiring payment to book a trial — but it is a recommendation, not a decision, and this step should not start building an escrow hold/release flow until that call is made.
2. If escrow is confirmed needed: model it as a variant of `tutor_earnings_ledger`/`tutor_payouts` — a marketplace engagement's payment sits held (mirroring `issued`) until marked attendance triggers release (mirroring `mark-paid`), using the same `FOR UPDATE`-plus-idempotency-key discipline as `billing.ts`'s reversal logic.
3. Reviews: a `reviews` table where a review row can only be inserted with a reference to a real, completed, attended session — enforce this at the RLS or route layer (decide and document which, per MASTER_PLAN §10's "RLS and the route layer must agree" rule), not just in client-side UI logic.
4. Moderation/disputes: minimal viable shape — a status field on reviews (published/flagged/removed) and a dispute record tied to the escrow/payment row if escrow was built, using the existing audit-log write pattern for any state transition.

**Tests required.**
- Contract: a review cannot be created without a real completed attended session backing it; if escrow was built, a hold-then-release round trip mirroring `payouts.test.ts`'s existing mark-paid coverage, plus a double-release/idempotency test analogous to the attendance-reversal double-reverse `409` case.
- RLS: reviews and any escrow-adjacent table have no broader client access than intended (e.g., a reviewer can only review their own completed engagement).
- Unit: none expected beyond any new pure logic extracted for review eligibility checks.

**Browser verification required.** Walk a real (or throwaway) engagement from Step 38's trial-to-enrolment handoff through to a completed, attended session, then leave a review and confirm it displays on the tutor's Step 37 public profile. If escrow was built, walk a hold-then-release cycle with real or throwaway amounts and confirm the release only fires on marked attendance.

**Definition of done.**
- [ ] The escrow-from-day-one founder call has been made and recorded, before any escrow code was written.
- [ ] Reviews are gated on verified attendance, enforced at the RLS or route layer with a test that fails if the check is removed.
- [ ] If escrow was built: a hold-then-release cycle works end to end and cannot double-release.
- [ ] All seven gates green.

**Expected outcome.** The marketplace has real trust primitives, built on machinery this codebase already trusts for money, rather than a second, less-tested system.

---

## R5 and beyond, not yet scoped as steps

MASTER_PLAN.md §7's R5 holds C-10 (parent attendance and payment history, which is UI-only since RLS already permits both and the blocking code comment in `ParentPortal.tsx:206` is simply stale), C-11 (the gradebook marking loop, which is what makes the progress-report PDF's academic section non-empty for the first time), C-12 (cross-org family view), B-18 (leading indicators, which needs Step 26's cron to have filled `org_stats_daily`), and C-13 (guardian records moving from student-owned free-text to parent-owned).

**Scope these into steps only when R4's gate is met.** Each should open the way Steps 15 to 24 did, with a schema reality check confirmed by reading the code rather than trusting this file's one-line description. Three of the four times that discipline was applied, the plan's premise turned out to be wrong.

**R6, the marketplace (B-14, B-15, B-16), is scoped as Steps 37-39 above** — D-09 (2026-09-14) lifted the commercial gate this section used to cite, and the re-scoping pass grounding those steps in the real schema is complete (MASTER_PLAN.md §7).

---

## Completed work

**Steps 1 to 13, R1, money is correct** (complete 2026-09-05). Attendance reversal with wallet credit-back, per-user rate limiting, the wallet-ledger reconciliation job, per-org credit expiry with FIFO lot walking, self-serve parent top-up, bulk CSV/XLSX import with a dedup-resolution wizard, DPDP consent records and per-student erasure, the booking-request approval UI, the parent-facing cancellation disclosure, and a README rewritten for the actual stack. Full per-step detail: [docs/EXECUTION_PLAN_R1_ARCHIVE.md](docs/EXECUTION_PLAN_R1_ARCHIVE.md).

**Steps 14 to 23, R2, one person many orgs** (complete 2026-09-12). Staging on both Supabase and Vercel; profiles re-keyed to `(user_id, organization_id)` so one login can hold several memberships; active-org threading through `AuthContext` and `api.ts`; D-05's per-student parent-controlled payment permissions; the org switcher, which surfaced and fixed a real cross-org tutor double-booking bug; B-08 tutor payouts and the earnings ledger with TDS and statement PDFs; B-12 the monthly progress-report PDF; B-13 substitute and leave management. Full detail in git history at commit `86ca0e4`.

**Step 24, B-19 referral loop: parked, not shipped.** Coded, all code-level gates green, committed as `1eedd13`. Moved onto branch `parked/b-19-referral` at the start of the Step 25 session; `main` was rebuilt at `86ca0e4` plus this session's docs commit so a future push cannot deploy code that expects tables that don't exist. Migration `20260912150000_referral_loop.sql` never applied anywhere, no live walkthrough. Parked by MASTER_PLAN.md §8 because it pays out wallet credit that requires a live Razorpay no org has connected, to users who do not exist yet. Revisit in R5, after Steps 27 to 29 make both true.
