# ClassStackr Optimization Audit

_Performed 2026-07-25 against commit `ab79d69`, working tree clean. Every finding below was verified by running the code, building the bundle, or reading the exact lines cited. Measured numbers are labelled **measured**; anything else is labelled an estimate._

**Baseline:** 19,904 lines across `src/`, `server/`, and `shared/`. All six gates green (typecheck, 158 unit, 80 RLS, 165 contract, build, bundle 224.6 KB gzip).

**Headline:** the architecture is genuinely good. Module boundaries are clean, money is server-authoritative, SQL is fully parameterized, route splitting is already done, and the test pyramid is real. The problems are concentrated in five places: a deployment artifact that CI never validates, TypeScript strict mode being off, 29 KB of dead weight in the main bundle, a drag handler that re-renders a 997-line component every pointer frame, and modals with no dialog semantics.

---

## Critical

### C1. CI validates a build artifact that is not the one deployed

**File:** `vercel.json:3`, `package.json:8`, `api/index.js`
**Severity:** Critical

**Problem.** Two different server bundles exist. `npm run build` (used locally and by CI) bundles `server.ts` into `dist/server.js`. Vercel's `buildCommand` bundles a *different* entry point, `server/vercelHandler.ts`, into `api/index.js`. CI never builds the artifact that production actually runs.

The committed `api/index.js` is from commit `c921d88` (2026-07-10) while `server/` last changed 2026-07-25. Verified: it is missing 7 of the 14 mounted route groups.

| Route group | In committed `api/index.js` |
|---|---|
| `/api/v1/inbox` | MISSING |
| `/api/v1/subscription` | MISSING |
| `/api/v1/admin` | MISSING |
| `/api/v1/org-export` | MISSING |
| `/api/v1/audit-log` | MISSING |
| impersonation, offboarding | MISSING |

**Why it matters.** Production is correct today only because Vercel regenerates the file. But the committed fallback is a working, half-featured API from before Inbox, subscription billing, super-admin, org export, and the audit log existed. If the `buildCommand` is ever changed, fails partially, or the framework preset is altered, Vercel serves that stale bundle and every affected route returns 404 with no error anywhere. Nothing in CI would catch it. Separately, a syntax or import error in `server/vercelHandler.ts` is undetectable until deploy, since no gate compiles that entry point.

**Recommended solution.**
1. Add the real bundle step to CI so the deployed artifact is verified: `esbuild server/vercelHandler.ts --bundle --platform=node --target=node22 --format=esm --packages=external --outfile=api/index.js`.
2. Add a post-build assertion that the produced bundle contains every route group mounted in `server/app.ts`.
3. Keep the file committed (HANDOFF §8 explains why Vercel's git scan needs it), but regenerate it on every commit that touches `server/` so the checked-in copy is never stale.

**Expected impact.** Closes a silent, total-feature-loss failure mode. No runtime change.

**Behavioural risk.** None. Regenerating the artifact makes the committed copy match source, which is what deploys today anyway.

---

## High

### H2. `useRealtimeList` dispatches Realtime refetches through a stale closure

**File:** `src/hooks/useRealtimeList.ts:51-73` (the effect), `59-66` (the subscription)
**Severity:** High

**Problem.** `refetch` is a `useCallback` keyed on `[load]`, so it gets a new identity whenever `load` changes. The subscribing effect has dependencies `[orgId, table]`, so it runs once and its Realtime callback (`() => refetch()`, line 64) permanently captures the mount-time `refetch`, and therefore the mount-time `load` closure.

Concretely, in `useScheduleSessions` (`src/hooks/useSchedule.ts:28-55`) `load` closes over `weekStartIso` / `weekEndIso`. Paging to a different week is handled by an explicit compensating `refetch()` (`useSchedule.ts:60-64`), so navigation is correct. But a Realtime event still calls the mount-time closure and refetches **the original week**, then commits it via `setData`. The sequence guard at line 40 does not help, because the stale call increments the same counter and is therefore treated as current.

**Why it matters.** A user viewing week 3 who receives any `class_sessions` change event silently gets week 1's sessions rendered into the week 3 grid. The same pattern applies to any consumer whose `load` closes over changing state. This is invisible to all six gates: typecheck, unit, RLS, and contract tests never mount the hook, and the previous session's live walkthrough would only surface it if a second user edited a session while the first was on a different week.

**Recommended solution.** Keep the latest `load` in a ref and have both the subscription and `refetch` read through it, so the subscription never needs to be torn down:

```ts
const loadRef = useRef(load);
useEffect(() => { loadRef.current = load; }, [load]);

const refetch = useCallback(async () => {
  const seq = ++requestSeq.current;
  try {
    const rows = await loadRef.current();
    ...
  }
}, []); // stable identity, always calls the current load
```

This also lets `useScheduleSessions` and `useMyScheduleSessions` drop their compensating `refetch()` effects, removing a duplicated request on every week change.

**Expected impact.** Fixes a real data-correctness bug and removes one redundant network round trip per week navigation.

**Behavioural risk: this is the one finding where "preserve behaviour exactly" and "fix the bug" conflict.** Today, a Realtime event on a paged view replaces correct data with stale data. After the fix it replaces it with correct data. That is a behaviour change, and it is the point. It needs a browser walkthrough to confirm: page to a future week, mutate a session from a second session, and confirm the grid keeps showing the correct week.

---

### H3. Drag handler re-renders a 997-line component on every pointer frame and rebinds listeners each time

**File:** `src/pages/Schedule.tsx:178-189` (effect), `235-266` (`handlePointerMove`)
**Severity:** High

**Problem.** `handlePointerMove` calls `setDrag(prev => ({ ...prev, ... }))` on every `pointermove`, always returning a new object, so every pointer event re-renders the entire `Schedule` component: the full week grid, all session blocks, and every `useMemo` whose dependencies changed.

Worse, the listener effect at line 178 has dependency `[drag]`. Since `drag` changes on every pointer frame, the effect tears down and re-adds both `window` listeners on **every single frame** of every drag.

**Why it matters.** At 60 to 120 pointer events per second this is roughly 60 to 120 full component renders per second plus 240 to 480 `addEventListener` / `removeEventListener` calls per second, for the entire duration of a drag. On the mid-range Android device DEV_PLAN targets, this is the single most expensive interaction in the product.

**Recommended solution.**
1. Change the effect dependency to a boolean so listeners bind once per drag, not once per frame:
   ```ts
   const isDragging = drag !== null;
   useEffect(() => { if (!isDragging) return; /* bind */ }, [isDragging]);
   ```
   Route the handler through a ref so the listener never holds a stale closure.
2. For the per-frame render: keep the live drag geometry in a ref and drive the preview block with a direct style write (or a `transform` on a single positioned element), committing to React state only on `pointerup`. The preview is one absolutely-positioned block, so it does not need a full grid re-render to move.

**Expected impact.** Reduces drag-time renders from roughly 60 to 120 per second to 1 (on drop), and eliminates listener churn entirely. Estimated: near-elimination of jank on the primary scheduling interaction. Worth measuring with a React Profiler trace before and after.

**Behavioural risk.** Step 1 is behaviour-preserving and safe. Step 2 changes how the preview is painted and needs the drag walkthrough (create, move across days, resize, conflict rejection) re-run, since HANDOFF §8 records that this exact code path already produced four bugs invisible to automated gates.

---

### H4. TypeScript strict mode is off, and turning it on costs 3 errors

**File:** `tsconfig.json`
**Severity:** High

**Problem.** `tsconfig.json` sets no `strict`, `strictNullChecks`, `noImplicitAny`, `noUnusedLocals`, or `noImplicitReturns`. The project has been described as type-safe; it is type-checked, which is not the same thing.

**Measured cost of enabling each flag:**

| Flag | Errors introduced | Verdict |
|---|---|---|
| `strict` | **3** | Enable now |
| `noFallthroughCasesInSwitch` | **0** | Enable now, free |
| `noUncheckedIndexedAccess` | **0** | Enable now, free |
| `noUnusedParameters` | 2 | Enable now |
| `noUnusedLocals` | 19 | Enable, all 19 are dead code (see M8) |
| `noImplicitReturns` | 49 | Defer, mostly Express handler style |
| `exactOptionalPropertyTypes` | ~30 | Do not enable, high noise and low value here |

**Why it matters.** Three errors is essentially free for the largest single type-safety improvement available. Two of the three are genuine null-safety holes, not ceremony:
- `src/pages/Money.tsx:125` parameter `studentId` is implicitly `any`.
- `src/pages/Money.tsx:865` a `string | undefined` is passed where `string` is required, twice.

Without `strictNullChecks` every `T | undefined` in this codebase is silently treated as `T`, which is exactly the class of bug that produces blank pages and `undefined` in a template string.

**Recommended solution.** Enable `strict`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, `noUnusedParameters`, and `noUnusedLocals` in one commit; fix the 3 strict errors and delete the 19 dead bindings. Leave `noImplicitReturns` and `exactOptionalPropertyTypes` off with a comment saying why.

**Expected impact.** Large, permanent reduction in the null-safety bug class, at a one-commit cost. No runtime change.

**Behavioural risk.** None if the three fixes are genuine narrowing (an explicit type annotation and two guards) rather than `!` assertions. Do not use `!` to silence them, since that reintroduces exactly the hole being closed.

---

### H5. Sentry ships to every user and costs 29.2 KB gzip while doing nothing

**File:** `src/main.tsx:3`, `src/components/ErrorBoundary.tsx:3`
**Severity:** High

**Problem.** `import * as Sentry from '@sentry/react'` is a static top-level import in both `main.tsx` and `ErrorBoundary.tsx`. `ErrorBoundary` is eagerly imported by `App.tsx`, so Sentry lands in the main entry chunk unconditionally. The `if (dsn)` guard at `main.tsx:9` gates *initialisation*, not download, and `VITE_SENTRY_DSN` is unset until go-to-market (HANDOFF §7).

**Measured:** main entry chunk is **224.6 KB gzip** with Sentry and **195.4 KB gzip** with it stubbed out. Sentry costs **29.2 KB gzip, 13% of the chunk**, for zero current functionality.

**Why it matters.** This is the single largest measured, removable item in the bundle, and it is on the critical path for first paint for every user on every visit.

**Recommended solution.** Make both call sites lazy and DSN-gated:

```ts
// main.tsx
const dsn = import.meta.env.VITE_SENTRY_DSN;
if (dsn) {
  import('@sentry/react').then((S) => S.init({ dsn, environment: import.meta.env.MODE, tracesSampleRate: 0.1 }));
}
```

In `ErrorBoundary`, replace the static import with a dynamic one inside `componentDidCatch`. An error boundary firing is already an exceptional path, so a dynamic import there costs nothing in the normal case, and reporting still works once the DSN exists.

**Expected impact.** Measured 224.6 KB to 195.4 KB gzip, a 29.2 KB (13%) reduction, and it grows the headroom under the 260 KB budget from 35 KB to 65 KB. Full error-reporting behaviour is preserved for the day the DSN is set.

**Behavioural risk.** Low, with one caveat worth stating: with a dynamic import there is a brief window during startup where Sentry is not yet initialised and a very early crash could go unreported. Given the DSN is unset today this costs nothing now, and at go-live the window is a few milliseconds. If that is unacceptable later, keep `main.tsx` eager and lazy-load only `ErrorBoundary`'s usage.

---

### H6. Modals have no dialog semantics, focus management, or Escape handling

**Files:** `src/pages/Schedule.tsx` (5 modals), `src/pages/Inbox.tsx:~449`, `src/pages/Documents.tsx` (2), `src/components/kit/Popover.tsx:37`
**Severity:** High (accessibility)

**Problem.** Verified: there are **zero** occurrences of `role="dialog"` or `aria-modal` anywhere in `src/`. Every modal is a plain `<div>` overlay. Escape handling exists in only three components (`CommandPalette`, `Popover`, `PopoverEdit`); none of the eight modal overlays handle it. There is no focus trap and no focus restoration on close.

Separately, `Popover.tsx:37` renders its trigger as `<div onClick={...}>{trigger}</div>`. This is not focusable, cannot be activated by keyboard, and exposes no `aria-expanded`. Popover is described in its own header comment as "the primitive behind all inline editing", so this one line makes inline editing keyboard-inaccessible across every workspace.

**Why it matters.** A keyboard or screen-reader user cannot open an inline editor at all, and cannot escape a modal once in it. The axe pass recorded in HANDOFF §35 fixed five violations, but static axe scans do not reliably detect missing focus traps, missing focus restoration, or custom non-focusable triggers, so these are net-new and are the more serious class.

**Recommended solution.**
1. `Popover.tsx`: render the trigger as a `<button type="button">` with `aria-expanded={open}` and `aria-haspopup="dialog"`. This is a one-line structural change to a shared primitive that fixes every workspace at once.
2. Extract one `<Modal>` primitive into `src/components/kit/` providing `role="dialog"`, `aria-modal="true"`, an `aria-labelledby` wired to the title, Escape-to-close, focus trap, and focus restoration to the trigger. Migrate the eight overlays to it.

**Expected impact.** Moves the app from "mostly inaccessible by keyboard for editing and modals" to WCAG 2.1 AA conformant on those flows. Accessibility score improvement is the largest single-category gain available.

**Behavioural risk.** Low for the Popover change (button styling may need `display: inline-flex` and a reset to match current appearance exactly, since the UI must not visibly change). Medium for the modal migration, which touches eight call sites and should be done one at a time with a visual check on each.

---

## Medium

### M7. `api()` has no timeout, no retry, and no deduplication

**File:** `src/lib/api.ts:34-57`
**Severity:** Medium

**Problem.** The shared API client calls `fetch` with no `AbortController` and no timeout, so a hung request pends forever with the UI stuck in a loading state. There is no retry for transient network or 5xx failures, and no in-flight deduplication, so two components requesting the same resource issue two requests. Lines 53 and 54 use `any` casts to reach into the error body.

**Why it matters.** On the flaky mobile connections this product targets, a stalled request is a permanently stuck screen with no recovery other than a reload.

**Recommended solution.** Add an `AbortController` with a default 30 second timeout (configurable per call, higher for PDF and export routes). Add one bounded retry with jittered backoff for network errors and 502/503/504 only. **Never retry non-idempotent money mutations** unless the call carries an idempotency key, which `/billing` routes already support. Type the error body with a small `ApiErrorBody` interface instead of `any`.

**Expected impact.** Eliminates the stuck-forever failure mode; modest resilience gain on poor connections.

**Behavioural risk.** Medium and worth stating plainly: adding retries to money endpoints without respecting idempotency keys could double-charge. Retry must be opt-in per call site, defaulting to off for anything under `/billing`.

---

### M8. Nineteen dead bindings, verified by the compiler

**Severity:** Medium

Verified via `noUnusedLocals` / `noUnusedParameters`. This is the complete list, not a sample:

| File | Line | Unused |
|---|---|---|
| `server/utils/crypto.ts` | 23 | `AUTH_TAG_LENGTH` |
| `src/components/LoadingSpinner.tsx` | 1 | `React` |
| `src/components/OrganizationSettings.tsx` | 4 | `Plus`, `Trash2` |
| `src/components/PublicLayout.tsx` | 1 | `React` |
| `src/hooks/usePeople.ts` | 1 | `useState` |
| `src/pages/Inbox.tsx` | 277 | `currentUserId` |
| `src/pages/Money.tsx` | 22, 52 | `agingBucket`, `t` |
| `src/pages/public/Features.tsx` | 1, 3 | `React`, `MessageSquare` |
| `src/pages/public/Home.tsx` | 1 | `React` |
| `src/pages/public/HowItWorks.tsx` | 1 | `React` |
| `src/pages/public/Pricing.tsx` | 1 | `React` |
| `src/pages/RoleSelection.tsx` | 1 | `React` |
| `src/pages/Schedule.tsx` | 14, 704 | `ClassType`, `PricingModel`, `tutorAvailability` |
| `src/pages/Settings.tsx` | 15, 80 | `checkAuth`, `popup` |
| `tests/contract/parents.test.ts` | 6 | `OTHER_ORG` |

Two deserve a second look rather than blind deletion: `Schedule.tsx:704` `tutorAvailability` is fetched and never used, so either the availability overlay silently lost a feature or the fetch is a wasted query. `Settings.tsx:80` `popup` is the return value of a `window.open`, and discarding it usually means a popup-blocked branch was intended.

**Recommended solution.** Delete the unambiguous ones with `noUnusedLocals` enabled to prevent regrowth. Investigate the two above before touching them.

**Expected impact.** Small bundle win, meaningful clarity win. No runtime change.

---

### M9. Four unused dependencies, one of them notable

**File:** `package.json`
**Severity:** Medium

Verified by scanning every import, require, dynamic import, and CSS `@import` across `src`, `server`, `shared`, `scripts`, `tests`, `api`, and the root config files:

| Package | Status |
|---|---|
| `motion` | Zero references anywhere. Dead. |
| `@fontsource-variable/geist` | Zero references. Dead (the font is not imported). |
| `google-auth-library` | Zero direct references; available transitively via `googleapis`. Remove as a direct dependency. |
| `autoprefixer` (dev) | Zero references. Tailwind 4 handles vendor prefixing. Dead. |

Two more worth noting rather than removing. `shadcn` is a runtime dependency used only for `@import "shadcn/tailwind.css"` in `src/index.css`, which is unusual but real. `jose` and `jsonwebtoken` are both used in `server/middleware/auth.ts` deliberately (`jose` for async JWKS, `jsonwebtoken` for the sync HS256 fallback); consolidating on `jose` alone would drop one dependency but touches the auth path and is not worth the risk right now.

**Expected impact.** Smaller install and lockfile, less audit surface. `motion` and the font package are not in the client bundle today (they are never imported), so removing them does not change bundle size, only install weight. Stating that explicitly because it would be easy to overclaim here.

---

### M10. Realtime refetches the entire list on every row change

**File:** `src/hooks/useRealtimeList.ts:61-65`
**Severity:** Medium

**Problem.** Every `postgres_changes` event triggers `refetch()`, a full re-query of up to 500 rows, regardless of which row changed. Verified 14 `.channel()` subscriptions across 11 files. A single attendance mark on a busy org fans out into a full reload of sessions, invoices, and notifications for every connected client.

**Why it matters.** This is the Monday-6pm attendance burst that DEV_PLAN §2.1's k6 scenario exists to measure. Cost scales with connected clients times rows, not with the size of the change.

**Recommended solution.** The payload already contains `eventType` and the new/old row. Merge targeted changes into local state (insert, update by id, delete by id) and reserve full refetch for the cases where a merge is not safe (a row moving out of the query's bound, or a filtered query whose predicate the payload cannot evaluate). Because all six workspace hooks now share `useRealtimeList`, this is a single-file change.

**Behavioural risk.** Medium. A merge must reproduce the query's ordering and bounding exactly, or lists will drift out of order. Do this after H2 (the stale-closure fix), since both touch the same subscription callback, and add unit tests for the merge reducer.

---

### M11. Broad `select("*")` on the client, 20 call sites

**Severity:** Medium

Twenty client queries fetch every column, including `students`, `invoices`, `wallets`, `wallet_ledger`, `conversations`, `notifications`, `tutor_profiles`, and `inbox_state`. The rebuilt Schedule hook is the counter-example and does it right (`useSchedule.ts:31` selects nine named columns).

**Why it matters.** Over-fetching costs bandwidth and parse time on mobile, and it silently widens the data surface reaching the browser. RLS still governs row access, so this is not an authorization hole, but a `students` row carries parent contact details that most screens do not render.

**Recommended solution.** Replace `select("*")` with explicit column lists in the six workspace hooks first, where the row shapes are already typed. Leave the legacy pages until they are rebuilt.

**Behavioural risk.** Low but real: if any consumer reads a field not in the new list it becomes `undefined` silently. Narrow one hook per commit and lean on the mapper functions, which already name every field they use.

---

## Low

### L12. `target="_blank"` without `rel="noopener noreferrer"`
`src/pages/Today.tsx:682`, `src/pages/StudentDashboard.tsx:200`. Modern browsers imply `noopener` for `target="_blank"`, so exposure is minimal, but it costs one attribute to be explicit.

### L13. One `<img>` without `alt`
`src/pages/public/Home.tsx:222`. Add `alt` text, or `alt=""` plus `role="presentation"` if decorative.

### L14. `currentRole` is trusted from `localStorage`
`src/context/AuthContext.tsx:67-76, 137-140`. The value is read back and used to pick the UI shell. It is validated against the server-derived `roles` array at line 140, and RLS plus `requireOrg` are the real authorization boundary, so this is not privilege escalation. Worth a comment saying so explicitly, because the pattern reads like an authorization decision and a future reader may treat it as one.

### L15. Wizard component holds 17 `useState` calls
`src/pages/Schedule.tsx:713-729`. A `useReducer` with one typed action union would make the multi-step flow easier to follow and easier to reset between opens. Pure refactor, no behaviour change.

### L16. Component-level memoization is absent
Zero `React.memo` in the codebase, and zero `useCallback` in `Money.tsx`, `People.tsx`, `Schedule.tsx`, and `Inbox.tsx`. This is not automatically a problem, and adding memoization everywhere would be premature. It becomes worth doing for list rows specifically (`PersonRow`, session blocks, invoice rows) once H3 is fixed, and only with profiler evidence.

---

## Scores

| Category | Score | Basis |
|---|---|---|
| **Overall health** | **72 / 100** | Strong architecture and tests, undermined by a deploy-artifact gap and strict mode being off |
| Performance | 68 / 100 | Route splitting already excellent; drag path, Realtime fan-out, and 29 KB dead bundle weight pull it down |
| Maintainability | 74 / 100 | Clean pure-core pattern, real test pyramid; 900 to 1,000 line pages and a stale committed artifact hurt |
| Security | 84 / 100 | Genuinely strong: parameterized SQL, server-only money, HMAC webhooks, encrypted secrets, no XSS sinks, RLS enforced and tested. Loses points for strict mode off and no `npm audit` gate |
| Accessibility | 58 / 100 | Recent axe pass helped, but zero dialog semantics and a keyboard-inaccessible shared editing primitive dominate |
| Type safety | 65 / 100 | Compiles clean, but `strictNullChecks` off means every optional is silently non-optional |

## Technical debt summary

The debt is not spread evenly. It sits in three buckets:

1. **Build and deploy integrity (C1).** One issue, highest consequence, roughly half a day to fix. CI does not build what production runs.
2. **Foundational type and correctness gaps (H2, H4).** The stale-closure bug and strict mode are both cheap to fix and both prevent whole categories of future bugs.
3. **Polish debt that scales badly (H3, H6, M10, M11).** Drag performance, dialog accessibility, Realtime fan-out, and over-fetching all get worse as orgs grow, which means they are cheapest to fix now.

Pre-existing tracked debt in DEV_PLAN §4 (unreachable admin tier, blank `profiles.name`, dual money columns) is unaffected by this audit and remains accurate.

## Estimated bundle improvement

| Change | Effect | Confidence |
|---|---|---|
| Lazy-load Sentry (H5) | **224.6 to 195.4 KB gzip, minus 29.2 KB** | **Measured** |
| Remove 19 dead bindings (M8) | under 1 KB | Measured as negligible |
| Remove unused deps (M9) | 0 KB bundle, smaller install only | Verified, stated to avoid overclaiming |
| Lazy-load `Onboarding` (585 lines, used once per user) | 5 to 10 KB | Estimate |
| Drop `i18next` for a single-locale build | 10 to 15 KB | Estimate, needs a spike; only if multi-locale is off the roadmap |

**Realistic target: 224.6 KB to roughly 185 to 195 KB gzip, a 13 to 18% reduction.** The measured floor of 195.4 KB is achievable from the Sentry change alone.

## Estimated performance improvement

- **Drag interaction (H3):** roughly 60 to 120 renders per second down to 1, plus elimination of about 240 to 480 listener bind/unbind calls per second. Largest interactive win available. Verify with a React Profiler trace.
- **First paint:** 13% smaller main chunk (measured), which matters most on the mid-range Android and 3G targets in DEV_PLAN §6.
- **Realtime fan-out (M10):** changes cost from O(rows in every subscribed list) to O(1) per event. The real gain shows up under the k6 attendance burst, and this should be measured there rather than asserted.
- **Week navigation (H2):** removes one duplicate query per navigation.

## Risk assessment

| Change | Risk | Notes |
|---|---|---|
| C1 CI builds the real artifact | **Very low** | Additive, no runtime change |
| H4 strict mode | **Very low** | 3 compile errors; fix by narrowing, never with `!` |
| M8 dead bindings | **Very low** | Compiler-verified, except the 2 flagged for investigation |
| M9 remove unused deps | **Low** | Verified zero references; run a full build after |
| H5 lazy Sentry | **Low** | Small unreported window at startup; nil today with no DSN |
| H6 Popover as a button | **Low** | Must confirm styling is pixel-identical |
| M11 narrow `select("*")` | **Low to medium** | Missing columns fail silently; one hook per commit |
| H3 drag optimization | **Medium** | This exact path already produced 4 gate-invisible bugs; needs a browser walkthrough |
| H6 modal primitive | **Medium** | Eight call sites; migrate individually with a visual check |
| M7 retry logic | **Medium** | Must not retry non-idempotent money calls |
| H2 stale-closure fix | **Medium** | Genuinely changes behaviour, in the correct direction; needs two-session verification |

**The general risk note for all of it:** the six gates cannot see UI interaction bugs. HANDOFF §8 records that the four worst Schedule bugs were all invisible to typecheck, unit, RLS, and contract tests. Anything touching Schedule, modals, or Realtime needs a real browser walkthrough, not a green suite.

## Prioritised roadmap

**Batch 1, zero behavioural risk (about 1 day).** C1 CI builds the deployed artifact; H4 strict mode plus the 3 fixes; M8 delete 19 dead bindings; M9 remove 4 unused dependencies; L12 and L13. Add `npm audit` and `npm run test:contract` to CI while in there (already tracked as DEV_PLAN Tech Debt #10). Verify with all six gates.

**Batch 2, measurable performance (about 1 day).** H5 lazy Sentry (measured 29.2 KB); H3 step 1, the listener-churn fix, which is behaviour-preserving on its own. Re-measure the bundle and take a profiler trace.

**Batch 3, correctness (about 1 to 2 days).** H2 stale-closure fix plus removal of the two compensating effects. Requires a two-session browser walkthrough. Do this before M10, since they touch the same callback.

**Batch 4, accessibility (about 2 to 3 days).** H6 part 1, Popover as a real button, which fixes every workspace at once; then the shared `Modal` primitive and eight migrations. Re-run axe afterwards and wire it into CI.

**Batch 5, scale (about 3 to 4 days).** M10 targeted Realtime merges with unit tests; M11 narrow `select("*")` in the six workspace hooks; H3 step 2, the ref-driven drag preview. Validate under the k6 attendance burst once DEV_PLAN §2.1 is unblocked, since that is the scenario these changes are for.

**Deliberately not recommended.** `exactOptionalPropertyTypes` (about 30 errors, low value here). `noImplicitReturns` (49 errors, almost all Express handler style). Blanket `React.memo` or `useCallback` without profiler evidence. Consolidating `jose` and `jsonwebtoken`, since both are used deliberately in the auth path and the risk outweighs dropping one dependency.
