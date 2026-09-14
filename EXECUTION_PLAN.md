# ClassStackr Execution Plan

**Derived from [MASTER_PLAN.md](MASTER_PLAN.md), rewritten 2026-09-12.** The master plan says what to build and why; this file says what to do next, in what order, and how you will know it is done.

## How to use this document

- **Steps are numbered continuously and never renumbered.** Source comments cite `EXECUTION_PLAN.md Step N`; those anchors must stay stable. Steps 1 to 13 (R1) are archived in [docs/EXECUTION_PLAN_R1_ARCHIVE.md](docs/EXECUTION_PLAN_R1_ARCHIVE.md); Steps 14 to 24 (R2) are summarized in §"Completed work" below, with full detail in git history at commit `86ca0e4`.
- **Order is dependency order, not priority order.** Where they conflict, dependency wins.
- **Every step ends the same way:** all seven gates green, a live browser walkthrough against a real environment, this file's tracker and "Start here" section updated, HANDOFF.md's gate line and verification log updated, then commit.
- **Standing rule, do not self-authorize:** no migration is pushed to `classstackr-staging` or production, and nothing is pushed to `main`, without explicit founder go-ahead. Rehearse on staging first, always.

**The seven gates.** `npm run lint` · `npm test` · `npm run test:rls` · `npm run test:contract` · `npm run build` · `npm run check:bundle-size` · `npm run build:api && npm run check:api-bundle`. All seven run in CI; none need Docker, Java or a live database.

**Baseline as of 2026-09-12,** re-run and confirmed in this session: typecheck clean, 249 unit, 106 RLS, 353 contract, bundle 205.4 KB against a 260 KB budget, 19 of 19 API route mounts.

---

## Start here

**Current pick: Step 25 (C-01, the timezone model) — code-complete, all seven gates green, NOT yet pushed anywhere.**

**Why that and not Step 24.** Step 24 (B-19, the referral loop) is fully coded. It was committed to local `main` as `1eedd13` during the 2026-09-12 planning session, but was **parked before this session started work on Step 25**: the commit now lives on branch `parked/b-19-referral`, and `main` was rebuilt at `86ca0e4` (plus this session's docs commit). Its migration `20260912150000_referral_loop.sql` has never been applied to staging or production and it has never been walked live. MASTER_PLAN.md §8 parks it: it pays out wallet credit, wallet credit needs a live Razorpay that no org has connected, and there are no users to refer anyone. **Do not push `parked/b-19-referral` and do not apply its migration.** Revisit in R5, after Steps 27 to 29.

**Why Step 25 is first.** It is a live correctness defect in the feature everything else hangs off, it needs nothing external, and every later step that touches scheduling inherits it if it is not fixed now.

**Step 25's remaining work, in order:** (1) run `scripts/backfillSessionTimezones.sql`'s diagnostic `SELECT` against production — read-only, safe, tells you the actual blast radius; (2) rehearse the migration (and the corrective `UPDATE`, if the diagnostic found mismatches) on `classstackr-staging`; (3) a live browser walkthrough creating a real recurring class through a **Vercel preview deployment** specifically, not local dev (HANDOFF.md §8's new trap entry explains why local dev can't reproduce this bug); (4) push the migration to production with founder go-ahead; (5) check off Step 25's DoD below and move its tracker row to done. See HANDOFF.md §9's 2026-09-14 entry for exactly what's verified so far and what isn't.

**Run in parallel with Step 25, starting today, because they are procurement and not engineering** (MASTER_PLAN.md §12): WhatsApp Business API onboarding and template approval, SMS DLT registration, Razorpay live KYC for both the platform account and the pilot org, and booking an external pentest vendor. These have multi-week lead times and they gate Steps 27, 28 and 34.

**Founder decisions that block steps below:** D-10 blocks Step 27, D-11 blocks Step 32, D-03's actual tier numbers block Step 28. See MASTER_PLAN.md §13.

---

## Progress tracker

| Step | Item | Release | Status |
|---|---|---|---|
| 1-13 | R1, money is correct | R1 | ✅ Complete 2026-09-05 |
| 14-20 | Staging, multi-membership identity, org switcher | R2 | ✅ Complete 2026-09-12 |
| 21 | B-08 tutor payouts and earnings ledger | R2 | ✅ Complete 2026-09-12 |
| 22 | B-12 monthly progress-report PDF | R2 | ✅ Complete 2026-09-12 |
| 23 | B-13 substitute and leave management | R2 | ✅ Complete 2026-09-12, one gap (see below) |
| 24 | B-19 referral loop | — | ⏸ **Parked.** Moved to branch `parked/b-19-referral` (commit `1eedd13`), `main` rebuilt at `86ca0e4`. Migration unpushed, never deployed or walked live. Do not push. |
| **25** | **C-01 timezone model** | **R3** | **Code complete, gates green — pending staging rehearsal, Vercel preview walkthrough, and production go-ahead (see "Start here")** |
| 26 | C-02 wire the scheduler | R3 | Not started |
| 27 | B-17 outbound comms router | R3 | Blocked on D-10 + provider onboarding |
| 28 | C-03 platform billing switch-on | R3 | Blocked on D-03 numbers + platform KYC |
| 29 | C-04 Razorpay live rehearsal | R3 | Blocked on pilot-org KYC |
| 30 | C-05 parent-visible tutor-student threads | R4 | Not started |
| 31 | C-06 Playwright golden journeys | R4 | Not started |
| 32 | C-07 activation analytics | R4 | Blocked on D-11 |
| 33 | C-08 operational floor | R4 | Not started |
| 34 | C-09 onboarding friction pass | R4 | Not started |
| 35 | TD-3 paise-native migration | R4 | Not started |
| 36+ | R5 (C-10, C-11, C-12, B-18, C-13) | R5 | Not scoped as steps yet |

**Carried gap from Step 23:** the "Assign to all" substitute-reassignment mutation has never been clicked live. It needs a second real tutor account in the demo org, created through the app's own Team-tab invite link rather than a backend script. Fold this into Step 31's Playwright coverage rather than doing it by hand.

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
- [ ] `organizations.timezone` exists, rehearsed on staging, pushed to production with go-ahead. *(Migration written — `20260914120000_org_timezone.sql` — not yet rehearsed or pushed anywhere; needs go-ahead.)*
- [x] No function in the scheduling path reads the ambient process timezone. *(`shared/timezone.ts`; `materializeTemplate()`, `/gaps`, `PATCH /templates/:id`'s rematerialization cutoff, and the new `PATCH /organization-timezone` all take the zone as an explicit argument.)*
- [x] The unit suite passes identically under `TZ=UTC` and `TZ=Asia/Kolkata`. *(Also checked under `TZ=America/New_York` — a DST zone — for good measure. `tests/unit/timezone.test.ts`, 12 tests.)*
- [ ] A recurring class created through a Vercel preview deployment lands at the correct wall-clock time. *(Not yet done — needs a preview deployment, which needs a push; see "Start here.")*
- [ ] The production backfill has either been run with counts recorded, or been shown to be unnecessary with the query that proved it. *(Query written and verified correct against a real Postgres engine (PGlite) — `scripts/backfillSessionTimezones.sql` — but not yet run against production; its own diagnostic `SELECT` is read-only and safe to run first.)*
- [x] All seven gates green; HANDOFF.md §8 gains a trap entry for the local-dev false pass. *(256 unit, 104 RLS, 341 contract, build, bundle 205.0 KB/260 KB, API 18/18 — see HANDOFF.md §9's 2026-09-14 entry for the exact deltas.)*

**Expected outcome.** Recurring classes are correct everywhere, and the defect cannot silently return, because the tests fail if the ambient timezone ever matters again.

**Status as of 2026-09-14: code-complete and gate-verified, held at the two items above that need a push or a founder go-ahead — see "Start here" for the exact next actions.**

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
- [ ] Four cron entries live in `vercel.json`, deployed, and each has fired at least once on schedule.
- [ ] `org_stats_daily` has real rows.
- [ ] `/reconcile-wallets` has run against production with real wallet data and reported no mismatch. (It has never run against real drift; production had zero wallets at last check.)
- [ ] A deliberately failed run writes a discoverable audit row.
- [ ] All seven gates green.

**Expected outcome.** The product runs itself between sessions. B-18 gains a data source. Money drift becomes detectable rather than theoretical.

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
- [ ] A real invoice reaches a real parent's real phone, unassisted, and the link works.
- [ ] Delivery and read state visible in Money's reminder surface.
- [ ] A replayed provider webhook does not double-credit or double-message.
- [ ] The clipboard-paste bulk reminder flow is deleted, not left alongside. (HANDOFF §6: no parallel implementations.)
- [ ] Preferences actually suppress a send.
- [ ] All seven gates green; API bundle mount count updated.

**Expected outcome.** The wedge is true for the first time.

**Follow-on steps.** Step 29's live rupee is much easier once links are delivered automatically. Step 32's funnel gains its most important event.

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
- [ ] All seven gates green.

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
- [ ] A tutor cannot message a student without that student's guardian being able to read it.
- [ ] Enforced at the RLS layer, with tests that fail if the policy is reverted.
- [ ] Both sides see a disclosure.
- [ ] The reply-or-read-only decision is recorded in this step and in MASTER_PLAN §13.
- [ ] All seven gates green.

**Expected outcome.** A decided safety policy becomes a real one, and R6's compliance stage inherits it instead of starting from zero.

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
- [ ] Five journeys green in CI against staging, on every PR.
- [ ] Axe automated on the main surfaces.
- [ ] Deliberately break one assertion and confirm CI fails, so the gate is known to be real. (HANDOFF §5.10's discipline, applied to a new layer.)
- [ ] Step 23's substitute-reassignment gap closed.
- [ ] All eight gates green; README and HANDOFF updated to say eight.

**Expected outcome.** The bug class that has cost the most time stops recurring silently.

---

## Step 32: C-07, activation analytics

**Objective.** Be able to answer "is anyone actually using this, and are they getting to money" without asking them.

**Why this step exists.** There is no product analytics of any kind. `@vercel/analytics` gives anonymous pageviews; there is no event instrumentation, no signup attribution, no funnel, no cohort. The next twelve months are a search for product-market fit and the search is currently unobservable.

**Blocked on.** **D-11** (build or buy). DPDP posture with minors' data is the deciding factor, not cost.

**Files and systems likely affected.** Depends entirely on D-11. If self-hosted on the existing Postgres: a `product_events` table with an org-scoped, server-written append-only shape, plus an aggregation job riding Step 26's scheduler. If SaaS: a client SDK and a server-side event helper, plus a DPDP review of what leaves the country.

**Implementation scope.** Instrument in the order MASTER_PLAN §11 gives: the signup-to-activation funnel with per-beat drop-off; the weekly per-org loop (sessions, attendance, invoices, messages delivered, rupees collected); retention cohorts by signup week measured on the loop rather than on login; parent-side engagement; feature usage last. **Activation is defined as: 10 or more sessions with attendance marked, and at least one rupee collected through ClassStackr, within 14 days of signup.** Instrument to that definition rather than inventing a new one.

**Tests required.** Unit on the funnel and cohort computation. Contract on the event-write endpoint's auth and org scoping, if one exists. RLS if the events table is client-readable at all, which it should not be.

**Browser verification required.** Walk a full signup to activation on staging and confirm every event lands with the right org attribution.

**Definition of done.**
- [ ] The funnel reports a real number for at least one real org.
- [ ] Rupees collected per org per month is visible without a manual query.
- [ ] No minor's personal data leaves the DPDP boundary the D-11 decision set.
- [ ] All gates green.

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

## R5 and beyond, not yet scoped as steps

MASTER_PLAN.md §7's R5 holds C-10 (parent attendance and payment history, which is UI-only since RLS already permits both and the blocking code comment in `ParentPortal.tsx:206` is simply stale), C-11 (the gradebook marking loop, which is what makes the progress-report PDF's academic section non-empty for the first time), C-12 (cross-org family view), B-18 (leading indicators, which needs Step 26's cron to have filled `org_stats_daily`), and C-13 (guardian records moving from student-owned free-text to parent-owned).

**Scope these into steps only when R4's gate is met.** Each should open the way Steps 15 to 24 did, with a schema reality check confirmed by reading the code rather than trusting this file's one-line description. Three of the four times that discipline was applied, the plan's premise turned out to be wrong.

**R6, the marketplace (B-14, B-15, B-16),** stays unscoped behind MASTER_PLAN §7's commercial gate: 10 or more paying orgs, week-4 retention above 80%, ₹10L or more per month collected. Do not write steps for it before the gate opens; D-03 already invalidated its original pricing mechanism once, and scoping it early would only invalidate more.

---

## Completed work

**Steps 1 to 13, R1, money is correct** (complete 2026-09-05). Attendance reversal with wallet credit-back, per-user rate limiting, the wallet-ledger reconciliation job, per-org credit expiry with FIFO lot walking, self-serve parent top-up, bulk CSV/XLSX import with a dedup-resolution wizard, DPDP consent records and per-student erasure, the booking-request approval UI, the parent-facing cancellation disclosure, and a README rewritten for the actual stack. Full per-step detail: [docs/EXECUTION_PLAN_R1_ARCHIVE.md](docs/EXECUTION_PLAN_R1_ARCHIVE.md).

**Steps 14 to 23, R2, one person many orgs** (complete 2026-09-12). Staging on both Supabase and Vercel; profiles re-keyed to `(user_id, organization_id)` so one login can hold several memberships; active-org threading through `AuthContext` and `api.ts`; D-05's per-student parent-controlled payment permissions; the org switcher, which surfaced and fixed a real cross-org tutor double-booking bug; B-08 tutor payouts and the earnings ledger with TDS and statement PDFs; B-12 the monthly progress-report PDF; B-13 substitute and leave management. Full detail in git history at commit `86ca0e4`.

**Step 24, B-19 referral loop: parked, not shipped.** Coded, all code-level gates green, committed as `1eedd13`. Moved onto branch `parked/b-19-referral` at the start of the Step 25 session; `main` was rebuilt at `86ca0e4` plus this session's docs commit so a future push cannot deploy code that expects tables that don't exist. Migration `20260912150000_referral_loop.sql` never applied anywhere, no live walkthrough. Parked by MASTER_PLAN.md §8 because it pays out wallet credit that requires a live Razorpay no org has connected, to users who do not exist yet. Revisit in R5, after Steps 27 to 29 make both true.
