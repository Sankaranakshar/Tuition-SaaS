# ClassStackr Execution Plan

**What this is:** [MASTER_PLAN.md](MASTER_PLAN.md) §3's current release turned into an ordered sequence of steps small enough to execute one at a time, each with a concrete definition of done. This is the doc to hand a fresh Claude session with "do the next unchecked step."

**Where things stand:** **R1 ("Money is correct") is complete and merged to `main`** (2026-09-05). Its 13 steps, their definitions of done, the premise corrections found mid-step, and the Step 13 gate re-verification are archived in full at [docs/EXECUTION_PLAN_R1_ARCHIVE.md](docs/EXECUTION_PLAN_R1_ARCHIVE.md) — source comments still cite its "Step N" anchors, so it is frozen, not deleted.

**R2 ("identity is org-independent"), Steps 14-19, is complete as of 2026-09-12.** Staging (B-10) completed 2026-09-12 and the R2-gating founder decisions (D-02/D-03/D-05/D-06) were all answered the same day (MASTER_PLAN.md §5). Steps 14-19 closed out B-06 (person-centric identity: multi-membership schema, server auth, client active-org threading, and the D-01 regression proof) and D-05 (per-student payment permissions, which landed as a real feature, not a config flag — see Step 19). Note per Step 17's own record: Step 17's DoD line for a live multi-org browser walkthrough stays deferred ("[~]") — the dev-server `.env` swap to `classstackr-staging` needed to exercise it was explicitly declined again 2026-09-12 (session-scoped call, not a hard blocker); the resolution-order logic is still fully covered at the unit/contract level. **R2 does *not* close MASTER_PLAN.md §3's full gate** ("switches context without logging out") — that's B-07 (org switcher), scoped separately below, not started. B-07/B-08/B-12/B-13 and the "also in R2" IA items stay scaffold-only.

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
| 11 | **Needs you** — B-10 staging environment | ⏸️ Deferred 2026-09-05 (founder: hold) for R1. **Re-opened and completed 2026-09-12** (Supabase + Vercel) as R2's opening move — see Step 14 below. |
| 12 | **Needs you** — external pentest + leaked-password toggle | ⏸️ Both deferred to pre-GTM 2026-09-05 |
| 13 | R1 gate checkpoint (full re-verification) | ✅ 2026-09-05 — all 7 gates green (211/89/252, 200.7 KB, 16 mounts); money flows re-walked live. **R1 COMPLETE.** |

Gate numbers at R1 close: tsc clean · 211 unit · 89 RLS · 252 contract · build `dist/server.js` 184.4 KB · bundle 200.7 KB gzip / 260 KB · API bundle 16/16 mounts.

Two items (B-10 staging, external pentest + leaked-password toggle) were explicitly deferred rather than failing the gate — full reasoning and consequences in the archive's Steps 11-13; current status in MASTER_PLAN.md §3's R1 section and §8's GTM checklist.

---

# R2

**R2 thesis (from MASTER_PLAN.md §3):** make identity org-independent — one login, many memberships. Gate: one human account teaches independently on Tuesdays and at a centre on Thursdays, switches context without logging out, neither org can book over the other; a parent with children at two centres sees one home screen; a centre runs a payout cycle in-product. **Steps 14-19 below do not close this gate on their own** — the "switches context without logging out" half needs B-07 (org switcher), scoped separately after B-06 ships. What Steps 14-19 close: staging exists (R2-0), a person can hold more than one org membership without the schema forking (B-06, D-01's shape), and a parent controls whether/how much a student can pay for themselves (D-05).

**Schema reality check, done while scoping this (the founder's own flag going in):** `tutor_profiles`/`parent_profiles`/`student_profiles` are PK'd on bare `user_id` with `organization_id not null` — confirmed by reading `supabase/migrations/20260709020100_schema.sql:44-64`. But the bigger finding is that this is a *narrower* blocker than it looks: `organization_members` is already PK'd `(organization_id, user_id)` (same file, line 18-24) and `server/middleware/auth.ts`'s `loadMembership()` already has a comment acknowledging a user can hold more than one row there — it just deterministically picks the earliest-created one today, "no org-switcher UI yet" (`server/middleware/auth.ts:104-113`). The actual hard blockers to "one login, many memberships" are four concrete spots, not a schema-wide fork:
1. `tutor_profiles`/`parent_profiles`/`student_profiles`'s single-row-per-user PK (Step 15).
2. `POST /api/v1/members/bootstrap` 409s `already_member` if the caller has *any* membership, anywhere (`server/routes/members.ts:35-37`).
3. All three invite-redeem routes — staff (`members.ts:154-157`), parent (`parents.ts:98-101`), student (`students.ts:113-116`) — 409 `org_conflict` if the caller already belongs to a *different* org.
4. `setMembership()` unconditionally overwrites `profiles.organization_id` on every join (`members.ts:27`), and that column is today's only "which org am I in" pointer on both sides — `Today.tsx` reads it server-side, `AuthContext.tsx` picks `membership[0]` client-side, no switcher.

(2)-(4) are Step 16. `parent_profiles`/`student_profiles` turn out to be almost dead code, by the way — grepped the whole tree, no route or component reads either table; only `tutor_profiles` is live (Settings, People's tutor directory). That narrows Step 15's blast radius.

**D-05 doesn't fit inside B-06** — it's a parent/student payment-permissions feature, orthogonal to the multi-org identity plumbing above. Scoped as its own step (19), sequenced after Step 15 (it reuses the same migration window) but not blocked on Steps 16-18.

## Progress tracker

| # | Step | Depends on | Status |
|---|---|---|---|
| 14 | R2-0: staging environment (B-10) — retroactive write-up | — | ✅ Done 2026-09-12 (already shipped; this closes the paperwork loop) |
| 15 | B-06a: migration — multi-membership profile schema | 14 | ✅ Done 2026-09-12 |
| 16 | B-06b: server — multi-membership auth & org-context resolution | 15 | ✅ Done 2026-09-12 |
| 17 | B-06c: client — thread active-org through AuthContext/api.ts | 16 | ✅ Done 2026-09-12 (multi-org browser walkthrough deferred — see step detail) |
| 18 | B-06d: D-01 verification — independent tutor stays a clean single-member org | 16 | ✅ Done 2026-09-12 |
| 19 | D-05: per-student parent-controlled payment-permissions model | 15 | ✅ Done 2026-09-12 |

**Gate baseline after Step 19, R2 closed out** (HANDOFF.md §2, re-run 2026-09-12): tsc clean · 220 unit · 93 RLS · 280 contract · build `dist/server.js` 191.8 KB · bundle 204.0 KB gzip / 260 KB budget · API bundle 16/16 mounts.

**Not scoped in this pass, stays on the backlog:**

| ID | Item | ed | Blocked on |
|---|---|---|---|
| B-07 | Org switcher + cross-org conflict checking | 5 | Step 17 (B-06 must ship first — B-07 is the UI on top of the plumbing Steps 16-17 lay down) |
| B-08 | Tutor payouts & earnings ledger (serves org payroll now, marketplace payouts in R3) | 6 | Step 15; partly D-02 |
| B-12 | Monthly progress-report PDF | 3 | — (could pull forward) |
| B-13 | Substitute & leave management | 4 | Step 15 |

**Also in R2, from the spec v2 IA tabs, not scoped here:** the assignment-marking loop into the gradebook (upload works, marking doesn't, both sides); guardian records moving from student-owned to parent-owned; cross-org family view for parents (needs B-07's switcher first).

---

## Step 14 — R2-0: staging environment (B-10)

**Status: complete 2026-09-12.** This step is a retroactive write-up, not new engineering — B-10 shipped as R1's deferred item, reopened and finished before this scoping pass per MASTER_PLAN.md §10 item 2. Recorded here as a numbered step because everything downstream (Step 15's migration rehearsal) cites it as a dependency, and this doc's own convention (Step 8/Step 11 in the R1 archive) is to give a founder-facing or infra-facing milestone its own step even when no code was written in this session.

**What exists:** second Supabase project `classstackr-staging` (ref `fcshxorkxsaerwnuqrjh`, ap-south-1, same org as prod). All 33 migrations pushed from an empty database with zero errors — the first real from-zero test of the set. Seeded via `scripts/seed.ts` (demo parent + student included, unlike prod's demo org). A real Storage upload → signed URL → fetch → delete round trip verified against its `documents` bucket. `supabase_realtime` publication confirmed to carry all 21 expected tables. The `tuition-saas` Vercel project's Preview environment (Production untouched) carries staging's env vars — any push to a non-`main` branch auto-deploys against it, verified end to end (signed in as the seeded demo tutor, JWT verified via staging's JWKS, a query executed against staging Postgres via the pooler). `supabase/README.md` and `.env.example` document targeting it locally, including the pooler-host gotcha (HANDOFF.md §4). Credentials live in a local, gitignored `.env.staging`.

**Definition of done:**
- [x] `supabase db push` against `classstackr-staging` from empty, zero errors, all 33 migrations applied.
- [x] Seed script run, demo parent + student exist (the two roles prod's demo org lacks, per HANDOFF.md §9).
- [x] Storage round trip (upload/signed-URL/fetch/delete) verified against staging's bucket.
- [x] `supabase_realtime` publication carries all 21 expected tables.
- [x] A Vercel Preview deployment on a non-`main` branch resolves against staging end to end (auth JWKS, Postgres via pooler), Production untouched.
- [x] `supabase/README.md` / `.env.example` document the local-targeting workflow.

---

## Step 15 — B-06a: migration — multi-membership profile schema

**Goal:** make it possible for `tutor_profiles`/`parent_profiles`/`student_profiles` to hold one row per `(user, org)` instead of one row per user, so a person who joins a second org doesn't collide with (or silently overwrite) their profile at the first.

**Why:** MASTER_PLAN.md §3 R2, B-06, "independent tutor modelled as a single-member org so the schema never forks." These three tables are the literal fork point today — confirmed by reading `supabase/migrations/20260709020100_schema.sql:44-64`: each is `primary key (user_id)` with `organization_id uuid not null`. `organization_members` already supports multi-org membership at the row level (composite PK), so this migration is the one piece of the schema that's actually single-org-locked.

**Scope:**
1. **New migration** `supabase/migrations/20260912100000_multi_membership_profiles.sql` — rehearse on `classstackr-staging` first (per MASTER_PLAN.md §3 R2's own instruction, same discipline as the B-10 hold was meant to protect), then push to production:
   ```sql
   -- B-06a: a tutor/parent/student profile row is keyed per (user, org), not
   -- per user, so one person can hold a role-profile at more than one
   -- organization. organization_members already allows this (PK
   -- (organization_id, user_id)); these three tables were the holdout.
   -- Additive only — every existing row already has exactly one
   -- (user_id, organization_id) pair, so no backfill/dedup is needed.

   alter table tutor_profiles drop constraint tutor_profiles_pkey;
   alter table tutor_profiles add primary key (user_id, organization_id);

   alter table parent_profiles drop constraint parent_profiles_pkey;
   alter table parent_profiles add primary key (user_id, organization_id);

   alter table student_profiles drop constraint student_profiles_pkey;
   alter table student_profiles add primary key (user_id, organization_id);
   ```
   No other table has an FK referencing `tutor_profiles(user_id)` etc. (grepped `supabase/migrations/` for `references tutor_profiles` / `parent_profiles` / `student_profiles` — zero hits), and the RLS policies on all three (`tutor_profiles_rw` / `parent_profiles_rw` / `student_profiles_rw`, `20260709020200_rls.sql:78-85`) already key off `user_id = auth.uid() or is_staff(organization_id)` — row-level, not PK-shape-dependent — so **no RLS change is needed.**
2. **Fix the one real cross-org bug this migration would otherwise introduce:** `src/pages/People.tsx`'s `setVerified()` (around line 828) does `supabase.from("tutor_profiles").update({ is_verified }).eq("user_id", userId)` with **no organization_id filter**. Once a tutor can hold two rows, this update hits every org that tutor belongs to, not just the org whose People page the staff member is looking at — the same bug shape as the B-09 `tutor_id` cross-org leak MASTER_PLAN.md §3 already documents. Fix: add `.eq("organization_id", user.organizationId)`.
3. **Update the two other call sites that assume one row per user_id:**
   - `src/components/TutorProfileSettings.tsx`: the `select` at line ~39 (`.eq("user_id", user.id).maybeSingle()`) needs `.eq("organization_id", user.organizationId)` added, or a user with two tutor profiles will get whichever row Postgres returns first. The `upsert` at line ~90 needs `onConflict: "user_id,organization_id"` (currently `"user_id"`) — the payload already includes `organization_id` (line ~68), so this is a one-line change.
   - `src/hooks/usePeople.ts`'s `useTutorsList()` (line ~244) already filters `.eq("organization_id", orgId)` — no change needed, confirmed by reading it. Listed here so the audit is complete, not because it's broken.

**Definition of done:**
- [x] Migration applied clean against `classstackr-staging` from its current (post-Step-14) state, then against production.
- [x] `tests/integration/` RLS suite re-run green with no new failures. No fixture needed updating — the existing seed inserts already specify both `user_id` and `organization_id`, they just relied on `user_id` alone being unique before.
- [x] A **permanent** integration test (kept in the suite, not deleted after — this is exactly the regression a future change could reintroduce): `tests/integration/rbac.test.ts`'s new C5 case inserts a second `tutor_profiles` row for the same `user_id` under `OTHER_ORG`, confirms both rows persist and the original org's row is untouched. Deviates from the plan's "throwaway, delete afterward" instruction deliberately — that convention is for cron routes excluded from the permanent suite; this is core RLS coverage that should stay.
- [x] `People.tsx`'s verify-toggle fix and the two `TutorProfileSettings.tsx` line changes landed in the same pass as the migration.
- [x] All seven gates green: tsc clean, 211 unit, **90 RLS** (89 + 1 new), 252 contract, build 184.4 KB, bundle 203.6 KB/260 KB, API bundle 16/16 mounts, `api/index.js` byte-identical.

**Shipped 2026-09-12:** migration `20260912100000_multi_membership_profiles.sql` — `tutor_profiles`/`parent_profiles`/`student_profiles` re-keyed `primary key (user_id, organization_id)`, additive only (confirmed no FK anywhere references any of the three by `user_id`, and every existing row already had exactly one org). Rehearsed on `classstackr-staging` (`supabase db push --db-url ... --dry-run` showed only this one file pending, then applied clean; constraint shape and row counts re-checked directly via `psql` afterward), then the identical dry-run-then-push sequence against production, same re-check afterward — no data loss on either (production: 3 tutor_profiles rows survived untouched; parent_profiles/student_profiles were and remain empty — confirmed dead, no app code reads either table). `People.tsx`'s `setVerified` and both `TutorProfileSettings.tsx` call sites updated per the scope above.

---

## Step 16 — B-06b: server — multi-membership auth & org-context resolution

**Goal:** let a user actually acquire a second membership (today's code refuses it outright), and give every authenticated request a real, validated way to say which of the user's orgs it's acting in — replacing "always the earliest-created membership."

**Why:** MASTER_PLAN.md §3 R2, B-06's "one login, many memberships" half. Step 15 made the data model capable of holding two profiles; this step is what actually lets a second membership be created and used.

**Scope:**
1. **Relax the two outright blockers, without removing the same-org duplicate guard:**
   - `server/routes/members.ts:34-51` (`POST /bootstrap`): leave this guard as-is. Bootstrap is about *creating* a new org, not joining an existing one — a tutor who already has an independent org-of-one and later wants to work at a centre does that through invite-redeem, not a second bootstrap. The real relaxation belongs entirely in the invite-redeem checks below. Step 18 adds an explicit test proving this leaves D-01's single-member-org shape untouched, precisely because this step touches the neighboring code (`setMembership()`) without touching bootstrap's own guard.
   - `server/routes/members.ts:154-157` (staff invite redeem), `server/routes/parents.ts:98-101` (parent invite redeem), `server/routes/students.ts:113-116` (student invite redeem): all three currently read `req.user!.organizationId && req.user!.organizationId !== invite.organization_id → 409 org_conflict`. `req.user!.organizationId` is `loadMembership()`'s single earliest-org pick, so this literally means "you may only ever belong to the org you joined first." Change the check in all three to query `organization_members` directly for a row matching `(invite.organization_id, uid)` — 409 only if a membership *in that specific org* already exists (a real duplicate-redeem guard, which is still correct to keep), not merely because the user belongs to a different org already.
2. **`loadMembership()` gains an org-preference parameter** (`server/middleware/auth.ts:104-124`): `loadMembership(userId, preferredOrgId?)`. When `preferredOrgId` is supplied, validate it's a real row in `organization_members` for that user (`where organization_id = $2 and user_id = $1`); if found, return that membership instead of the earliest-created one. If not supplied, or supplied but invalid (removed member, typo, someone else's org id), fall back to today's deterministic earliest-row behavior unchanged — this makes the change backward-compatible for every existing single-org caller with zero client changes required.
3. **`authenticateToken` reads an `X-Organization-Id` header** (`server/middleware/auth.ts:161-192`) and passes it as `preferredOrgId` to `loadMembership()`. No header present → unchanged behavior.
4. **`setMembership()` stops silently overwriting `profiles.organization_id` as a side effect of joining any org** (`server/routes/members.ts:16-29`). Split into two operations: `setMembership()` keeps writing `organization_members` only; a new explicit `PUT /api/v1/members/me/active-organization` route (body: `{ organizationId }`, validated against the caller's own `organization_members` rows, 403 if not a member of that org) does the `profiles.organization_id` write. Call the new route from bootstrap and from each invite-redeem's success path (so today's single-org UX — you join, you're "in" that org — keeps working unchanged), but a *second* join no longer silently reassigns an existing member's home org out from under them the way `setMembership()` does today.
5. **New `GET /api/v1/members/me/organizations`** — returns every `(organization_id, organization name, role)` the caller belongs to, via a join on `organization_members`/`organizations`. Not consumed by any UI in this step (that's Step 17/B-07's job) but needed so a client can know a second membership exists at all, and so this step is independently testable.

**Definition of done:**
- [x] Contract tests: redeeming a second, different org's staff/parent/student invite while already a member of org A now succeeds (previously 409'd) and creates a second `organization_members` row without touching the first; redeeming an invite for an org the user is *already* a member of still 409s (`org_conflict` semantics preserved for the real duplicate case).
- [x] Contract test: `authenticateToken` with a valid `X-Organization-Id` header for an org the caller belongs to resolves `req.user.organizationId` to that org, not the earliest one; with no header, or a header naming an org the caller doesn't belong to, behavior is unchanged from today.
- [x] Contract test: `PUT /me/active-organization` 403s for an org the caller isn't a member of; 200s and updates `profiles.organization_id` for one they are.
- [x] Contract test: `GET /me/organizations` returns all memberships for a multi-org user, ordered consistently.
- [x] RLS suite re-run green (no policy changes in this step, but it's a privileged-route change — same rule HANDOFF.md §5 states).
- [x] All seven gates green.

**Shipped 2026-09-12:** all three invite-redeem routes (`members.ts`, `parents.ts`, `students.ts`) now guard on a direct `organization_members` lookup for the specific invite's org (`hasMembership()`, new shared helper) instead of comparing against `req.user!.organizationId` — a real duplicate-org redeem still 409s `org_conflict`, a different org's redeem now succeeds and adds a second membership row. `loadMembership()` takes an optional `preferredOrgId`, validated against a real membership row before use, with the cache bypassed on that path (org preference is per-request); `authenticateToken` reads it from a new `X-Organization-Id` header, guarded by a UUID-format regex so a malformed value degrades to "no header" instead of erroring. `setMembership()` no longer writes `profiles.organization_id` as a side effect — split into a new exported `setActiveOrganization()`, called explicitly from bootstrap and each invite-redeem's own success path only (deliberately **not** from `PUT /api/v1/members`'s role-change/direct-add path — confirmed via grep that no client code calls that route at all today; the product's only real onboarding path is invite-create-then-redeem, so this is a no-op in practice, not a regression). New routes `GET /api/v1/members/me/organizations` and `PUT /api/v1/members/me/active-organization` added, both via raw `pool` queries (the join + explicit ordering needed isn't expressible in the test harness's `supabaseAdmin` shim). One test-harness gap found and fixed along the way: `tests/contract/pgliteBackend.ts` never actually ran queries as the `service_role` Postgres role, so the pre-existing `profiles_org_immutable` trigger's `current_setting('role') = 'service_role'` bypass check was never really exercised by any contract test — surfaced by the new active-organization test, fixed by having `setBackend()` run `set role service_role` (the role `supabase/test/auth_shim.sql` already creates with `bypassrls` for the RLS suite), matching the file's own documented trust boundary. All seven gates green: 211 unit, 90 RLS (unchanged, no schema/policy change), **267 contract** (+15), build `dist/server.js` 186.8 KB, bundle 203.6 KB (unchanged, no client change yet), API bundle 16/16 mounts, `api/index.js` regenerated.

---

## Step 17 — B-06c: client — thread active-org through AuthContext/api.ts

**Goal:** stop the client from silently picking `membership[0]` as gospel, without building the switcher UI itself (that's B-07) — this step must be a no-op for every user who still has exactly one org.

**Why:** `src/context/AuthContext.tsx:159-194` mirrors the server's old "earliest membership wins" logic and has no concept of "which org is active" beyond that. Once Step 16 lets a person hold two memberships, the client needs to (a) know both exist and (b) send the active one on every request — even with no switcher UI yet, a multi-org user's session shouldn't silently and unpredictably flip which org they're acting in.

**Scope:**
1. `AuthContext.tsx`'s `loadUser()`: replace the single `.limit(1).maybeSingle()` membership query (`:163-169`) with the new `GET /api/v1/members/me/organizations` from Step 16, store the full list on `User` as `organizations: { organizationId, organizationName, role }[]`.
2. Persist the active choice the same way `currentRole` already is (`localStorage.getItem('currentRole')` pattern, `:71-83`): a new `activeOrganizationId` key. Resolution order: persisted choice if it's still in the fetched `organizations` list → else the earliest-created membership (today's behavior, so a single-org user sees zero change) → else the bootstrap flow if the list is empty (unchanged).
3. `src/lib/api.ts`'s `api()` helper (the shared fetch wrapper, `:37-...`) sends the active org as an `X-Organization-Id` header on every call. The three other raw-`fetch` call sites in the same file (PDF download `:141`, document upload `:179`, and the two more at `:473`/`:513`) are lower-priority — they hit routes that are already scoped to whatever `req.user.organizationId` resolves to server-side, and no switcher exists yet for a user to have picked a *different* org than their default — flag them in the PR description as needing the same header once B-07 ships a real switcher, but don't block this step on updating all four.

**Definition of done:**
- [x] A single-org user's session is unchanged: same active org resolved, same header sent (matches server default when header is absent/matches earliest row) — verified by browser walkthrough against the demo tutor account, single membership, confirmed no behavior change anywhere in the app.
- [~] A throwaway multi-membership test account (create via Step 16's now-unblocked second invite-redeem) loads with both orgs in `user.organizations`, and the persisted `activeOrganizationId` survives a page reload. **Not live-walked** — switching the local dev server to `classstackr-staging` to do this was blocked by the session's own permission classifier (restarting the dev server against a different Supabase project got refused mid-session); reverted `.env` back to production immediately, no half-applied state left behind. The underlying logic is covered without the browser: `tests/unit/activeOrganization.test.ts` proves the resolution order directly (persisted-valid → earliest → empty, plus the "single-org user, anything persisted, still resolves to their one org" case), and `tests/contract/members.test.ts`'s new `GET /me/organizations` tests prove a multi-org user gets both memberships back, earliest-first. Founder/future-session note: re-run this specific walkthrough against staging once the dev-server-switch permission is available, before B-07's switcher UI ships on top of this.
- [x] Unit test for the resolution order (persisted-valid → earliest → empty) in `tests/unit/` (a pure function extracted for this, not inlined in the component, per this repo's `shared/*.ts`-pure-logic convention) — `shared/activeOrganization.ts` + `tests/unit/activeOrganization.test.ts`.
- [x] All seven gates green.

**Shipped 2026-09-12:** `AuthContext.tsx`'s `loadUser()` now fetches the caller's full membership list via `GET /api/v1/members/me/organizations` (Step 16) instead of a single `.limit(1)` Supabase query, storing it on `User.organizations`. The active choice persists under a new `activeOrganizationId` localStorage key (same pattern as `currentRole`), resolved by a new pure `resolveActiveOrganizationId()` (`shared/activeOrganization.ts`, Zod-free per the client-bundle rule): persisted-and-still-valid → earliest membership → `null` if the list is empty (unchanged bootstrap fallback still fires off the empty-list case). `src/lib/api.ts`'s `api()` helper reads `activeOrganizationId` from localStorage directly (a plain function, not a React consumer — same reasoning `api()` already reads the Supabase session directly rather than through context) and sends it as `X-Organization-Id` on every call; absent for a signed-out/cleared-storage caller, which the server treats identically to today. The three lower-priority raw-`fetch` call sites (PDF download, document upload, the two `downloadBlob`/`multipartRequest` helpers) deliberately still don't send it, per this step's own scope — flagged here again for whoever picks up B-07's switcher. All seven gates green: **216 unit** (+5, the new resolution-order tests), 90 RLS, 267 contract (both unchanged — no server-side change this step), build `dist/server.js` 186.8 KB (unchanged, `api/index.js` byte-identical — confirmed no server code touched), bundle 203.7 KB (+0.1 KB from the new shared module and AuthContext changes, still well under the 260 KB budget), API bundle 16/16 mounts.

---

## Step 18 — B-06d: D-01 verification — independent tutor stays a clean single-member org

**Goal:** prove that relaxing the single-org guards in Step 16 didn't quietly change what an independent tutor's own org looks like — D-01 (MASTER_PLAN.md §5) decided this must stay "one shape, N memberships," never a schema fork, and this step is the regression test for that promise, not new engineering.

**Why:** Step 16 touches the exact code path (`/bootstrap`, `setMembership()`) that D-01's decision constrains. Without an explicit test, a future change could silently reintroduce a fork (e.g. someone "fixing" bootstrap to allow multiple orgs-of-one per user in a way that stops looking like a normal single-member org).

**Scope:** no new schema, no new route. One contract test suite:
1. Bootstrap a fresh user → assert exactly one `organization_members` row (role `owner`), exactly one `organizations` row, and that row has no distinguishing "independent" flag or parallel table — it's the same `organizations`/`organization_members` shape a centre gets, just with one member.
2. That same user then redeems a *second* org's staff invite (now possible per Step 16) → assert their original org-of-one is untouched (still exactly one member, still owner) while a second `organization_members` row now links them to the new org — proving Step 16's relaxation didn't retroactively change the first org's shape.

**Definition of done:**
- [x] Both assertions above land as contract tests (new file or appended to `tests/contract/members.test.ts`).
- [x] All seven gates green.

**Shipped 2026-09-12:** two new tests in `tests/contract/members.test.ts`'s new "D-01 regression" describe block. First: bootstrap a fresh user, assert exactly one `organization_members` row (role `owner`) and exactly one `organizations` row whose column shape (`Object.keys` diffed directly against the existing multi-member fixture org `ORG`, not a hardcoded list — avoids the test going stale as the schema gains columns) is identical to a centre's — no "independent"/"solo" flag, no parallel table. Second: that same user redeems a second org's staff invite (Step 16) and the original org-of-one is proven untouched (still exactly one member, still owner) while a second `organization_members` row now links them to the new org. No new schema, no new route — pure regression coverage per this step's own scope. All seven gates green: tsc clean, 216 unit (unchanged), 90 RLS (unchanged), **269 contract** (+2), build `dist/server.js` 186.8 KB (unchanged, no server code touched), bundle 203.7 KB (unchanged), API bundle 16/16 mounts, `api/index.js` byte-identical.

---

## Step 19 — D-05: per-student parent-controlled payment-permissions model

**Goal:** give each parent a per-student settings surface controlling whether that student can pay for themselves, a spending limit, and which payment methods are allowed — then enforce it on every self-serve student-initiated booking/payment path that exists today.

**Why:** MASTER_PLAN.md §5, D-05, decided 2026-09-12 — explicitly "a real permissions model to design and build... not a single boolean," narrower than the original age-threshold recommendation. No platform-wide age cutoff; per-student, parent-set, defaults closed (no row = no self-pay, matching "no platform-wide default" the way D-07's credit-expiry opt-in works).

**Scope, checked against what self-serve student paths actually exist today** (there is exactly one — confirmed by grepping every route for a `student`-role-reachable write): `POST /api/v1/session-requests` (`server/routes/sessionRequests.ts:58`) has no `requireRole` gate at all today — any org member, including a `student`-role account, can create a booking request with no parent involved. There is **no** existing student-facing payment/top-up route to retrofit — `/wallets/topup-link` (`billing.ts:721`) is already parent-only (403s any non-parent). So this step's enforcement surface is the session-request path; a genuinely new student self-pay *payment* route isn't being built here because there's nothing for it to gate today — flagging that explicitly rather than inventing a payment surface speculatively.

1. **Migration** `supabase/migrations/20260912110000_student_payment_permissions.sql` (rehearse on `classstackr-staging` first, same as Step 15):
   ```sql
   create table student_payment_permissions (
     student_id uuid primary key references students(id) on delete cascade,
     organization_id uuid not null references organizations(id) on delete cascade,
     self_pay_allowed boolean not null default false,
     spending_limit_paise integer,                    -- null = no limit
     allowed_payment_methods text[] not null default '{}', -- subset of {'wallet','razorpay_link'}
     updated_by uuid references auth.users(id) on delete set null,
     updated_at timestamptz not null default now()
   );
   -- Select-only client policy, same "server writes, staff/parent/self read"
   -- shape as consent_records (20260905130000) — no insert/update/delete
   -- policy; every write goes through the route below on service_role, so a
   -- spending limit can't be edited by anyone the route itself doesn't allow.
   alter table student_payment_permissions enable row level security;
   create policy student_payment_permissions_select on student_payment_permissions for select
     using (is_staff(organization_id) or is_parent_of(student_id) or is_student_self(student_id));
   ```
   Add to the realtime publication only if a live settings UI needs it to update without a manual refetch (check during implementation; `organizations.settings`-style jsonb settings elsewhere in this codebase are not realtime, so default to not adding it unless the UI pattern chosen needs it).
2. **`shared/schemas/students.ts`**: new `setPaymentPermissionsRequestSchema` (`selfPayAllowed: z.boolean()`, `spendingLimitPaise: z.number().int().positive().nullable()`, `allowedPaymentMethods: z.array(z.enum(["wallet","razorpay_link"]))`), mirroring the file's existing pattern (`eraseStudentRequestSchema` etc.).
3. **`server/utils/paymentPermissions.ts`** (new, Zod-free pure resolve + DB read — same convention as `server/utils/cancellationPolicy.ts`/`creditExpiry.ts`): `DEFAULT_PAYMENT_PERMISSIONS` (`selfPayAllowed: false, spendingLimitPaise: null, allowedPaymentMethods: []`) and `getPaymentPermissions(studentId)`, returning the defaults when no row exists — the "closed by default" behavior D-05 requires.
4. **New route** `PUT /api/v1/students/:studentId/payment-permissions` in `server/routes/students.ts`: staff (`owner`/`admin`) or a parent linked to that student — mirror `billing.ts:729-734`'s exact `parent_links` lookup pattern (`.from("parent_links").select("parent_user_id").eq("parent_user_id", req.user!.id).eq("student_id", ...).maybeSingle()`, 403 `Not linked to this student` if absent). Upserts the row, stamps `updated_by`/`updated_at`, writes an `audit_events` row (`student.payment_permissions.update`).
5. **Enforcement on `POST /api/v1/session-requests`** (`server/routes/sessionRequests.ts:58-...`): when the requester's `organizationRole` is `student`, read `getPaymentPermissions(body.studentId)` before inserting. If `selfPayAllowed` is false (the default), the request is created but flagged `requires_parent_approval = true` (new column on `session_requests`, same migration as (1)) and cannot be accepted by staff (Step 19's `/accept` route gets a check) until a parent clears it. Add `POST /api/v1/session-requests/:id/parent-approve` (parent-of-the-student only, mirrors the `parent_links` check again) that flips `requires_parent_approval` to false. If `selfPayAllowed` is true, the existing flow is unchanged — no parent step, straight to staff review, same as today.
6. **Settings UI**: a new `src/components/StudentPaymentPermissions.tsx`, surfaced from wherever a parent already manages a specific student today (check `ParentPortal.tsx` during implementation for the right per-student anchor point — likely alongside the existing per-child tabs/cards) — three controls: self-pay toggle, spending-limit number input (empty = no limit), payment-method checkboxes. Calls the new route via `src/lib/api.ts`.

**Definition of done:**
- [x] Contract tests: a student-initiated session request with no permissions row set is created but `requires_parent_approval = true` and staff `/accept` 403s until a parent approves it; the same request with `selfPayAllowed: true` set skips the approval gate entirely, matching today's ungated behavior exactly.
- [x] Contract tests for the permissions route: 403 for a parent not linked to the student, 403 for a non-owner/admin staff role, 200 for a linked parent and for owner/admin, response reflects `DEFAULT_PAYMENT_PERMISSIONS` when no row has ever been written.
- [x] RLS test: a parent not linked to the student cannot select another family's `student_payment_permissions` row.
- [x] Browser walkthrough — against production's real demo parent/student pair (`demo.parent@classstackr.dev` / `demo.student@classstackr.dev`, HANDOFF.md §9), not a throwaway: set a limit via the real Settings-tab UI, confirmed it round-trips across a fresh page load; submitted a student session-request with self-pay off (via the app's own authenticated `api()` client in the browser console — no create-request UI exists yet, same standing gap `listBookingRequests`'s own history notes), confirmed staff `/accept` 403s `parent_approval_required`; approved as the linked parent, confirmed staff could then accept (`200`, real enrollment created). Found and fixed a real bug live: the settings panel's description string rendered the literal `{{name}}` placeholder instead of the child's name (missing interpolation argument on the second `t()` call). All throwaway state (the enrollment, the session request, the payment-permissions row) was deleted afterward via direct `psql` against production — clean end state, no residue.
- [x] All seven gates green.

**Shipped 2026-09-12:** migration `20260912110000_student_payment_permissions.sql` — new `student_payment_permissions` table (one row per student, select-only RLS policy mirroring `consent_records`'s server-writes-only posture) and `session_requests.requires_parent_approval`, rehearsed on `classstackr-staging` then applied to production, both re-checked directly afterward (0 existing rows affected, no data loss). `shared/paymentPermissions.ts` (new, Zod-free pure resolve + defaults, same convention as `shared/cancellationPolicy.ts`) plus `server/utils/paymentPermissions.ts`'s DB-touching read. New routes in `server/routes/students.ts`: `GET`/`PUT /:studentId/payment-permissions`, gated by a shared `assertCanManagePaymentPermissions()` helper (owner/admin, or a parent linked to that specific student via the same `parent_links` lookup pattern as `billing.ts`'s wallet top-up route). Enforcement lives in `server/routes/sessionRequests.ts`: `POST /` reads the requester's payment permissions when their org role is `student` and stamps `requires_parent_approval` on the insert; `POST /:id/accept` 403s `parent_approval_required` while that flag is set; a new `POST /:id/parent-approve` (parent-of-the-student only) clears it. Client: a new `src/components/StudentPaymentPermissions.tsx` (self-pay toggle, spending-limit input, payment-method checkboxes) surfaced as a fourth "Settings" tab in `ParentPortal.tsx`, alongside the existing per-child selector; two new `src/lib/api.ts` functions. One test-harness gap found and fixed along the way: the contract-test `supabaseAdmin` shim's `toParam()` JSON-stringified every plain array (since a JS array is typeof "object"), producing invalid Postgres array-literal syntax for the new `allowed_payment_methods text[]` column — fixed by excluding arrays from that branch, letting PGlite encode them natively (the same thing the direct `pool`/`withTransaction` path — e.g. `class_sessions.student_ids` writes — already relied on). All seven gates green: 220 unit (+4), 93 RLS (+3), 280 contract (+11), build `dist/server.js` 191.8 KB (+5 KB, new routes/utils), bundle 204.0 KB/260 KB (+0.3 KB, new settings component), API bundle 16/16 mounts, `api/index.js` regenerated (190.9 KB).

---
