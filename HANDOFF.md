# ClassStackr — Engineering Handoff

_Last updated: 2026-07-10. Author: Firebase → self-hosted Supabase/Postgres migration (§11), a full engineering audit + DEV_PLAN.md rewrite + Supabase provisioning status (§12), then the first live deploy to Vercel + Supabase Cloud with migrations applied and the frontend confirmed rendering (§13)._

This document lets anyone (engineer or agent) pick up the build without re-reading the whole history. It records exactly what is done, what is verified, what is blocked on you, and what comes next.

**⚠️ Infrastructure changed since §1–§10 below were written.** Sections 1–10 describe the app as it existed on Firebase/Firestore and are kept as historical record — most of the *product* facts in them (which epics are built, what workflows exist) are still accurate, but every reference to Firestore, `firestore.rules`, Firebase Auth/Storage, and the Java-based rules emulator is **stale infrastructure detail**, superseded by §11. **Read §11 first**, then treat §1–§10 as product history only.

**Read order for a newcomer:** this file (**§11 first**, then §1–§10 as history) → [DEV_PLAN.md](DEV_PLAN.md) (the executable plan, itself Firestore-era — read for product intent, not infra specifics) → [GO_TO_MARKET_BLUEPRINT.md](GO_TO_MARKET_BLUEPRINT.md) (why) → [REDESIGN.md](REDESIGN.md) (product experience). Then [supabase/README.md](supabase/README.md) and `tests/integration/rbac.test.ts`.

---

## 1. Current state in one paragraph (AS OF 2026-07-08, Firestore era — see §11 for current infra)

The repository is a fresh, safe foundation. **Stage 0 of DEV_PLAN.md is complete** (Epics 1–5: security, server money, SQLite removal, query hygiene, and the full design foundation — tokens, shell, palette, component kit, and i18n wrapper), **Stage 1 Epic 6 (Payments) is built server-side** (Razorpay payment links, signature-verified idempotent webhooks, reconciliation poll, gap-free invoice numbering, tax/GST snapshot, manual refunds), **Epic 9 (Today workspace) is built** — the tutor/owner home with the live session Line, one-tap attendance (optimistic + undo), the rules-based attention queue, the three-number Pulse, the attendance-debt counter, and the admin per-tutor lanes; the legacy Dashboard is retired — and **Epic 10 (Parent portal v1) is built**: staff mint a single-use invite from a student's profile, a phone-OTP-verified parent redeems it (with explicit DPDP consent) to get real `parent_links` access and the `parent` custom-claim role, and lands on a mobile-first portal (children overview, invoices with a Razorpay pay button + WhatsApp share, wallet + payment history). **Epics 7 (Outbound comms) and 8 (Real scheduling integrations) are explicitly DEFERRED** — both are blocked on external provider onboarding (WhatsApp/SMS/email; Google Calendar+Meet OAuth verification) that cannot be finished from a dev machine. The four Critical security vulnerabilities (C1–C5) are fixed in `firestore.rules` and codified as an executable test suite (now 38 cases with the Epic 10 addition). SQLite is gone; the app runs on Firestore + a slim stateless Express API. Money and attendance are server-authoritative. The product builds, typechecks clean (0 errors, project-wide — see §10, `@types/react` was missing and has been fixed), unit-tests green (51/51), and boots with all routes wired. It has **not** been deployed to a live Firebase project; the payment loop, the Today workspace, and the parent portal have **not** been exercised in a browser (all three need a live/emulated Firebase project with seeded data + a connected Razorpay account — phone OTP specifically also needs a real Firebase Auth project, since it can't be emulated meaningfully without one). A **Stage 0/1 gap-closing pass** (§10) has since fixed several audit-flagged gaps (server-side enrollment/session-conflict checks, session materialization, soft deletes, Cloud Storage document uploads, Sentry, error boundaries, bounded queries). **All work through this pass is committed and pushed to GitHub `main` (`b28c3a1`).** **This entire paragraph is Firestore-era history — see §11 for what's actually running now.**

---

## 2. Repository & git state

- **Remote:** `https://github.com/Sankaranakshar/Tuition-SaaS.git` (private), branch `main`, upstream tracking set. Working tree is clean — everything below is pushed.
- **History (15 commits):**
  1. `96865ce` Baseline — code as received + planning docs
  2. `0fb8d01` Stage 0 — security, server money, SQLite removal
  3. `7c98726` Epic 5 (partial) — tokens, shell, palette
  4. `e3c04c6` Add engineering handoff document
  5. `b6f5f4d` Epic 5 — component kit + i18n wrapper (Stage 0 complete)
  6. `61620e5` Epic 6 — Razorpay payments (server-authoritative money loop)
  7. `d2e86ca` Epic 9 — Today workspace; defer Epics 7-8
  8. `a94bb0a` Update HANDOFF.md to reflect Epic 6/9 push
  9. `da0d887` Epic 10 — Parent portal v1 (invite-based linking, DPDP consent, mobile portal)
  10. `e7cfaeb` Epic 6.5 — server-side invoice PDF + StudentProfile cleanup
  11. `b28c3a1` Stage 0/1 gap-closing pass — server-side scheduling, storage, hardening (see §10)
  12. `eaa6a5b` Update HANDOFF.md for the Stage 0/1 gap-closing pass
  13. `97e3281` **Migrate from Firebase/Firestore to self-hosted Supabase/Postgres** (see §11)
  14. `7bac7c9` Fix class_sessions id-space bug found post-migration (see §11)
  15. (this commit) Update HANDOFF.md for the Supabase migration
- **⚠️ History note:** the build started from a fresh `git init`, so `main`'s previous AI-Studio commit history (~10 commits) was replaced by this clean history. **No code was lost** — commit 1 is byte-identical to the old remote HEAD plus the planning docs. The old commits likely still exist as unreferenced objects on GitHub for now; ask if you want them grafted back onto a `legacy-history` branch.

---

## 3. What was done, by epic (with file pointers)

### Epic 1 — Repo, environments, CI
- `git init` + baseline commit; pushed to GitHub with upstream tracking.
- Package renamed `react-example` → `classstackr`, v0.1.0 ([package.json](package.json)).
- Removed dead/vulnerable deps: `bcryptjs`, `@google/genai`, `xlsx` (CVEs) → `exceljs`, plus `cookie-parser`, `multer`, `better-sqlite3` once their code was deleted.
- Deleted the duplicate `/components/ui` tree (kept `src/components/ui`).
- CI: [.github/workflows/ci.yml](.github/workflows/ci.yml) — typecheck → unit tests → **Firestore rules tests on emulator** → build.
- [Dockerfile](Dockerfile) — stateless, multi-stage, non-root, Cloud Run-ready.
- [firebase.json](firebase.json) — emulator config (auth 9099, firestore 8080, storage 9199, UI 4000).
- [firestore.indexes.json](firestore.indexes.json) — composite indexes for sessions, invoices, attendance, enrollments, wallet_ledger.

### Epic 2 — Security rewrite (fixes C1–C5)
- [firestore.rules](firestore.rules) fully rewritten, role-aware, matching the RBAC matrix in GO_TO_MARKET_BLUEPRINT.md §9.3.
  - **C1** (privilege escalation): `users` doc update restricted to profile fields; `role`/`organizationId`/`roles` can never be self-assigned. Membership is server-written only.
  - **C2** (client-writable money): `invoices`, `payments`, `wallets`, `wallet_ledger`, `transactions`, `billing_events`, `attendance_records` deny **all** client writes.
  - **C3** (flat privilege): granular roles (owner/admin/tutor/frontdesk/accountant/parent/student) per collection.
  - **C4** (message privacy): `conversations`/`messages` readable only by `participantIds`.
  - **C5** (cross-tenant leak): `tutor_profiles` org-scoped; FindTutors marketplace deleted.
- **The executable constitution:** [tests/rules/rbac.test.ts](tests/rules/rbac.test.ts) — 34 tests, one+ per matrix cell plus explicit C1–C5 regressions. _Any change to `firestore.rules` or a privileged endpoint must keep this green._
- Auth middleware ([server/middleware/auth.ts](server/middleware/auth.ts)): trusts Firebase **custom claims only**, header bearer tokens only (cookie path removed → no CSRF surface), `checkRevoked` so removed members lose access immediately.
- Crypto ([server/utils/crypto.ts](server/utils/crypto.ts)): `v1:` key-version prefix for future rotation; honest error message.
- [storage.rules](storage.rules) — org-isolated file access mirroring Firestore, 5MB cap, MIME allowlist, student submission folders.

### Epic 3 — One data model, server-authoritative money
- **SQLite fully removed.** Express is stateless. Deleted `server/db.ts` and the SQLite-backed routes.
- Google refresh tokens → server-only `google_tokens` collection, AES-256-GCM ([server/routes/settings.ts](server/routes/settings.ts)).
- **New privileged API** ([server/routes/billing.ts](server/routes/billing.ts)):
  - `POST /api/v1/billing/attendance` — **persists attendance_records** (previously never saved) and settles wallet debit / invoice accrual in one **idempotent** Firestore transaction. Idempotency key = `sessionId_studentId`. 7-day backdating window, future sessions blocked, tutors limited to own sessions.
  - `POST /api/v1/billing/payments/manual` — idempotency-keyed, paise integer math, partial-payment aware.
  - `POST /api/v1/billing/invoices/:id/void` — invoices are voided, never deleted.
  - `POST /api/v1/billing/sessions/cancel`.
- **Membership API** ([server/routes/members.ts](server/routes/members.ts)): `bootstrap` (create org + owner claims atomically), `PUT` set role, `DELETE` remove member — all set custom claims and revoke tokens.
- **Audit trail** ([server/utils/audit.ts](server/utils/audit.ts)): every privileged mutation writes an append-only `audit_events` doc.
- Client `ClassManager.markAttendance` deleted; frontend now calls the API via [src/lib/api.ts](src/lib/api.ts).
- Fake `meet.google.com/placeholder-…` links removed (real links come in Epic 8).
- Conflict queries bounded by org + 12h window (were unbounded, growing forever).
- Recurring generation returns `skipped[]` conflicts instead of silently swallowing them; surfaced to the user as a toast in [src/pages/Calendar.tsx](src/pages/Calendar.tsx).

### Epic 4 — Query hygiene & error honesty
- Dashboard listeners bounded (`src/pages/Dashboard.tsx`, since deleted — see Epic 9): rolling session window, 12-month invoices, capped assessments (were four unbounded `onSnapshot`s).
- **All `alert()` / `window.confirm()` removed** (Calendar, Leads, Contact) → `sonner` toasts with undo. Lead delete is now optimistic + 5-second undo.
- INR everywhere via [src/lib/format.ts](src/lib/format.ts) (`formatINR`, `formatPaise`, Indian digit grouping, relative dates). Every `$` render purged.
- `exceljs` loaded dynamically (out of main bundle).
- Server: structured JSON errors, JSON 404 for unknown API routes, graceful shutdown, per-user rate limiting, `/api/v1` prefix.

### Epic 5 — Design foundation & shell (COMPLETE)
- **Tokens & shell:** design tokens in [src/index.css](src/index.css) (slate base, single indigo accent, semantic colors, dark variants, `tabular-nums`). [Layout.tsx](src/components/Layout.tsx) rewritten as the 56px icon rail (5 workspaces + settings; student nav 11→5 items). [CommandPalette.tsx](src/components/CommandPalette.tsx) (cmdk): `Cmd+K` nav, create actions, org-scoped student jump. The fake search box is now a real palette trigger. Page title fixed (was "My Google AI Studio App").
- **Component kit** ([src/components/kit/](src/components/kit)): `EmptyState`, `Skeleton`/`SkeletonText`/`SkeletonRow`/`SkeletonCard`, `StatChip`, `StatusChip`, `AgedBadge` (escalating temperature by days overdue), `PersonRow` (the shared People row schema), `ContextCard` (Inbox anchor), `CapacityMeter`, `Popover` + `PopoverEdit` (the dependency-free inline-edit primitive). All token-driven, colour-never-sole-signal. Barrel export in [src/components/kit/index.ts](src/components/kit/index.ts).
- **Demo route** ([src/pages/Kit.tsx](src/pages/Kit.tsx)): every kit component in every state, at `/app/kit` and via the palette ("Component kit"). This is the E5.4 acceptance artifact.
- **i18n wrapper** ([src/lib/i18n.ts](src/lib/i18n.ts) + [src/locales/en.json](src/locales/en.json)): react-i18next initialised in [main.tsx](src/main.tsx), English-only at launch. Shell strings (rail labels, search, logout, settings, notifications, switch-portal) now go through `t()`; new surfaces must too.
- **Note on types (UPDATED 2026-07-08):** `@types/react`/`@types/react-dom` are now installed (were missing entirely — see §10 below). `tsc` now really typechecks JSX/class components; two pre-existing real bugs surfaced immediately and are fixed (see §10).

---

### Epic 6 — Payments / Razorpay (Stage 1, BUILT, not e2e-verified)
The money loop's server backbone. Each org connects **its own** Razorpay account so fees land in the center's bank, not ours; keys are AES-GCM-encrypted in the server-only `payment_gateways` collection (mirrors `google_tokens`).
- **Pure, unit-tested core** (`npm test`, 12 new cases): [server/utils/invoiceStatus.ts](server/utils/invoiceStatus.ts) (the invoice status machine `applyPayment` — caps paid at total, reports overpayment, refuses void/paid, integer-paise only; **shared by the manual-payment route and the webhook** so both settle identically), [server/utils/invoiceNumber.ts](server/utils/invoiceNumber.ts) (`INV-{ORG}-{YYYY}-{seq}` + transactional counter), [server/utils/razorpay.ts](server/utils/razorpay.ts) (`verifyWebhookSignature` HMAC timing-safe, `createPaymentLink`, `fetchPaymentLink`, per-org creds).
- **Billing endpoints** ([server/routes/billing.ts](server/routes/billing.ts)): `POST /invoices/:id/finalize` (assign number + GST snapshot, idempotent), `POST /invoices/:id/payment-link` (create/reuse Razorpay UPI link for the outstanding amount), `POST /refunds` (idempotency-keyed, audited), `POST /reconcile` (hourly poll for missed webhooks, idempotent by link id).
- **Webhook receiver** ([server/routes/webhooks.ts](server/routes/webhooks.ts)): `POST /api/webhooks/razorpay/:orgId`, mounted with a **raw body parser before JSON + rate limiting** (see server.ts). Verifies the org's webhook secret, then settles idempotently by gateway payment id (`payments/rzp_<id>`); overpayment becomes wallet-ledger credit.
- **Gateway settings** ([server/routes/gateway.ts](server/routes/gateway.ts)): `GET /api/v1/gateway`, `PUT/DELETE /gateway/razorpay`, `PUT /gateway/tax`. Secrets are write-only from the client's perspective — never returned.
- **Client API** ([src/lib/api.ts](src/lib/api.ts)): `finalizeInvoice`, `createInvoicePaymentLink`, `refundPayment`, `reconcilePayments`, `voidInvoice`, `getGatewaySettings`, `connectRazorpay`, `disconnectRazorpay`, `saveTaxSettings`.
- **Rules regressions** added to [tests/rules/rbac.test.ts](tests/rules/rbac.test.ts): clients (even the owner) cannot read/write `payment_gateways`, `counters`, or `refunds` (default-deny; run in CI).
- **E6.5 server-side PDF receipt/invoice (BUILT 2026-07-08):** [server/utils/invoicePdf.ts](server/utils/invoicePdf.ts) — pure Node composer (`renderInvoicePdf`) using jsPDF + jspdf-autotable; A4 layout with org header, bill-to block, line items, subtotal/tax/discount/total/paid/outstanding math, tolerant of legacy rupee-only invoices via `resolveInvoiceTotals`. Money renders as `Rs. 1,234` (Helvetica has no ₹ glyph, and jsPDF splits it into a broken 2-byte sequence — standard Indian invoice fallback). Endpoint `GET /api/v1/billing/invoices/:invoiceId/pdf` in [server/routes/billing.ts](server/routes/billing.ts): owner/admin/frontdesk/accountant get any invoice; tutors get only their own; **parents get an invoice for a student they're linked to via `parent_links`** (mirrors the `/pay` route's auth check); students → 403. Streams `application/pdf` with `Content-Disposition: attachment` and `Cache-Control: private, no-store`. Client helper `downloadInvoicePdf` in [src/lib/api.ts](src/lib/api.ts); wired into [ParentPortal.tsx](src/pages/ParentPortal.tsx) invoice cards (Pay / Share / Download when payable; Download-only when paid/void). Unit tests in [tests/unit/invoicePdf.test.ts](tests/unit/invoicePdf.test.ts) — 7 cases, all green.
- **Not done in Epic 6:** UI surfaces on the staff side (the Money workspace that calls these is Epic 12 / Stage 2 — wire a Download button onto the legacy Invoices page sooner if a pilot needs it), and initiating gateway refunds via Razorpay API (E6.6 records the ledger side only; refund is issued from the Razorpay dashboard for now).

### Epics 7 & 8 — DEFERRED (2026-07-07)
Both skipped ahead of Epic 9 on purpose; each is blocked on onboarding that can't complete from a dev machine, and neither gates the wedge demo (a pilot can send UPI links by hand and run sessions with "link pending" until they land). Marked deferred in [DEV_PLAN.md](DEV_PLAN.md).
- **Epic 7 (Outbound comms):** blocked on WhatsApp Business API template approval, SMS DLT registration, Resend/SES domain verification.
- **Epic 8 (Real scheduling / Meet links):** blocked on Google Cloud OAuth consent-screen verification + Calendar API `conferenceData` scopes. The safe placeholder-link removal already shipped in Epic 3, so there's no regression from waiting — the Today Join action degrades to "Link pending" when a session has no real `meetingLink`.

### Epic 9 — Today workspace (BUILT, not browser-verified)
The tutor/owner home, replacing the old Dashboard. All logic that decides *what* to show lives in one pure, unit-tested module so the clock is injectable and every rule is testable.
- **Pure core** ([src/lib/today.ts](src/lib/today.ts), 26 unit tests): session phase machine (`upcoming → live → unmarked → done`), now-cursor index, attendance-debt / markable window (mirrors the server's 7-day rule), paise-canonical + legacy-tolerant invoice money helpers, `buildPulse` (collected-this-month / outstanding / sessions-this-week-vs-last), and the five attention-queue builders (overdue invoices, unmarked sessions, absence streaks, quiet leads, schedule conflicts).
- **The page** ([src/pages/Today.tsx](src/pages/Today.tsx)): built entirely on the E5 component kit + tokens.
  - **E9.1 The Line** — today's sessions with a minute-ticking now-cursor; state-aware action per block (Join when online & near start → Mark attendance → "Marked").
  - **E9.2 One-tap attendance** — roster popover, all-present default, tap-to-cycle exceptions, **optimistic with a 5-second Undo**. The undo model *is* the safety on billing: the real `markAttendance` API call is deferred 5s and cancelled on undo, so nothing bills unless the mark stands. Navigating away within the window **flushes** (does not drop) the write; the API is idempotent so a double-flush is safe.
  - **E9.3 Attention queue** — rules-based, each item with an inline action (Collect / Mark / Call / Follow up / Resolve) plus snooze (1 day) and dismiss (30 days), persisted in `localStorage` per org.
  - **E9.4 The Pulse** — three `StatChip`s, no charts.
  - **E9.5 Attendance-debt counter** — header badge counting unmarked sessions across the 7-day window; those sessions also surface as queue items with a Mark action.
  - **E9.6 Admin variant** — owner/admin see one stacked lane per tutor (names from `tutor_profiles`); a single-tutor day collapses back to one lane.
  - **E9.7** — legacy `Dashboard.tsx` and its `utils/analytics.ts` **deleted**; the `/app` index route now renders `Today`. `recharts` is no longer imported by any route (still in `package.json`; drop it in a dep-cleanup pass).
- **Security:** attendance still mutates **only** through `POST /api/v1/billing/attendance` (via [src/lib/api.ts](src/lib/api.ts)); the page reads live and writes nothing to Firestore directly. All listeners are org-scoped + bounded + capped (E4.1).
- **Not verified:** no browser walkthrough — needs a live/emulated Firebase project with seeded sessions/invoices/leads to render. Student role still delegates to the existing `StudentDashboard`.

### Epic 10 — Parent portal v1 (BUILT, not browser-verified)
Dependencies were E6 (payable invoices, already built) and E2.5/parent rules (already in place from Epic 2's `isParentOf()` helper). The real gap this epic closed: `parent_links` existed in `firestore.rules` from day one but had **no creation path at all** — nothing minted them. Parent onboarding in `Onboarding.tsx` also previously wrote to `parent_profiles`/`student_profiles`, a parallel legacy model the rules and billing code never consult; that dead flow has been replaced.
- **Invite + redeem** ([server/routes/parents.ts](server/routes/parents.ts), new): `POST /invites` (staff: owner/admin/frontdesk) mints a random 7-day token scoped to one student, stored in `parent_invites/{token}`. `GET /invites/:token/preview` lets a phone-verified user see who/what they're about to link to before consenting. `POST /redeem` (body: `{token, consent: true}` — consent is a Zod literal, not optional) atomically creates the `parent_links/{parentUid}_{studentId}` doc with `consentGivenAt`/`consentVersion` fields (the DPDP capture) and burns the invite in one Firestore transaction, then calls the same `setMembership()` helper `members.ts` bootstrap uses (now exported) to grant the `parent` custom claim + `organization_members` doc + token revocation. An org-conflict check blocks redeeming a second org's invite onto an already-claimed account, mirroring the tutor/admin bootstrap guard.
- **`firestore.rules`**: `parent_invites` is default-deny for all client read/write — the redeem screen's "preview" comes from the server endpoint above, never a direct Firestore read. New rbac test: `parent_invites has no client read or write path at all` (staff included).
- **Parent-facing payment** ([server/routes/billing.ts](server/routes/billing.ts)): the existing staff-only `payment-link` route's core logic was extracted into `resolveInvoicePaymentLink()` and reused by a new `POST /invoices/:invoiceId/pay`, authorized by checking `parent_links/{uid}_{studentId}` exists for the invoice's student (Admin SDK read — rules aren't consulted server-side, same posture as the tutor-owns-session check in the attendance route) rather than a staff role.
- **Client API** ([src/lib/api.ts](src/lib/api.ts)): `createParentInvite`, `previewParentInvite`, `redeemParentInvite`, `payInvoiceAsParent`.
- **Onboarding** ([src/pages/Onboarding.tsx](src/pages/Onboarding.tsx)): the parent branch is now invite-token entry → server preview → DPDP consent checkbox → redeem → forced ID-token refresh (`getIdToken(true)`, mirroring the tutor bootstrap refresh) so the very next API call carries the new claims. A `?invite=TOKEN` deep link pre-fills the token. Because `/login` and the `/app` redirect chain drop query strings, [src/App.tsx](src/App.tsx) stashes the token into `sessionStorage` at module load (before any redirect fires) so it survives a logged-out parent's login hop.
- **The portal** ([src/pages/ParentPortal.tsx](src/pages/ParentPortal.tsx), new; wired into [src/pages/Today.tsx](src/pages/Today.tsx) and [src/components/Layout.tsx](src/components/Layout.tsx) behind `currentRole === 'parent'`): one page, mobile-first (max-w-md, tested at 375px), built on the E5 kit. A horizontal child-chip selector when there's more than one linked child; three tabs — **Overview** (upcoming sessions via the existing `parentUserIds` array-contains rule), **Invoices** (status chip, Pay Now → `payInvoiceAsParent` → redirect straight to the Razorpay-hosted payment-link page — no Checkout.js integration needed since Payment Links are already a hosted page; a Share-via-WhatsApp button opens a `wa.me` deep link with the same URL, no WhatsApp Business API required since it's a plain share intent, not Epic 7's automated messaging), **Wallet** (credits/currency balance + payment history from `payments`).
- **Staff side** ([src/pages/StudentProfile.tsx](src/pages/StudentProfile.tsx)): a new "Parent Portal Access" card generates the invite link, with copy and WhatsApp-share buttons. This is additive and sits beside the pre-existing "Link Parent Account" box, which is **dead code that predates this epic** — it writes `students.parentId` directly (including one path that calls `addDoc` on `users` with a fabricated document, which `firestore.rules` would reject) and is never consulted by rules, billing, or the new portal. Not removed in this pass; flagged here as tech debt.
- **Not done in Epic 10:** phone OTP itself was already wired up in `Login.tsx`/`AuthContext.tsx` from before this epic — nothing new was needed there beyond the claims-refresh fix above. E10.2's "flawless at 375px" and E10.3's "real UPI payment on a phone completes and reconciles" acceptance criteria are unverified — both need a live Firebase project (phone OTP needs a real project; it doesn't meaningfully emulate) and a connected Razorpay account, same gap Epic 6 already carries.



## 4. Dev commands (STALE — see §11 for the current set)

The block below is Firestore-era (`npm run test:rules` no longer exists). Current commands are in §11.4.

```bash
npm install
cp .env.example .env          # fill Firebase + Google OAuth + secrets
npm run dev                    # Express + Vite (PORT env respected, default 3000)

npm run lint                   # tsc --noEmit
npm test                       # unit tests (format/money math) — 6 passing
npm run test:rules             # Firestore rules suite — REQUIRES Java + firebase-tools
npm run build                  # vite build + esbuild server bundle
```

**Secrets:** generate `JWT_SECRET` and `ENCRYPTION_KEY` with `openssl rand -hex 32`. Production → Google Secret Manager, never a file.

**Deploy rules/indexes:** ~~`firebase deploy --only firestore:rules,firestore:indexes,storage`~~ — obsolete, see §11.

---

## 5. Verification status (STALE, Firestore era — see §11.6 for current)

| Check | Status |
|---|---|
| `npm run lint` (typecheck) | ✅ clean |
| `npm run build` | ✅ passes (server bundle 60.5kb after E6.5; SPA route-split) |
| `npm test` (unit) | ✅ 51/51 (money math, invoice numbering, webhook signature, 26 Today-workspace derivations, + 7 invoice-PDF composer) |
| Server boots with Epic 6 routes, `/api/health` ok | ✅ verified on :3199 |
| Unauth billing / gateway calls rejected | ✅ structured 401 JSON before any Firestore touch |
| Payment webhook / reconcile e2e | ⚠️ **not run** — needs live/emulated Firestore + a connected Razorpay account |
| Today workspace build (route-split) | ✅ `Today` chunk compiles (~32kb / 9.5kb gzip); old Dashboard chunk gone |
| Unknown API route → JSON 404 | ✅ |
| `npm run test:rules` | ⚠️ **NOT run locally** — this machine has no Java. Written to run in CI. **First action for whoever has Java: run it and confirm 38/38 green** (35 pre-Epic-10 + 3 new `parent_invites` deny assertions in one `it`). |
| Browser UI walkthrough (any workspace, incl. Today, Parent portal) | ⚠️ not done — needs a live/emulated Firebase project with seeded data; parent phone OTP specifically needs a real project, not just an emulator |
| Parent invite → redeem → portal, end to end | ⚠️ **not run** — same live-Firebase gap; typecheck/build/unit-test green (see Epic 10 above) |

---

## 6. Blocked on you (STALE, Firestore era — see §11.5 for the current list)

1. **Firebase projects** for `dev`/`staging`/`prod` (separate projects), then `firebase deploy` the new rules. **The currently-live rules still contain C1–C5.** Deploying the new rules is the single most urgent real-world action. — *Obsolete: there is no Firebase project anymore. See §11.5.*
2. **Existing-user migration:** users created before this change have **no custom claims**. After deploy, each org owner must pass through `POST /api/v1/members/bootstrap` once (or run a one-off backfill script — ask and I'll write it). Until then they won't resolve an `organizationId`. — *Obsolete: no existing users, pre-launch, this concern doesn't apply to the Supabase model (see §11.2).*
3. **Stage 1 long-lead items** (start now, they take weeks): Razorpay live KYC, WhatsApp Business API onboarding + template approval, SMS DLT registration, CA review of GST invoice format, privacy policy + ToS. — *Still applies, unrelated to infra.*
4. Confirm CI is green on GitHub Actions (needs the repo's Actions enabled; the workflow provisions Java itself). — *Stale detail: CI no longer needs Java (see §11.7); still confirm Actions is enabled and green.*
5. **Wire the Epic 6 payment loop to real infrastructure** (cannot be finished from a dev machine): per pilot org, connect its Razorpay keys via `PUT /api/v1/gateway/razorpay` (key id + secret + webhook secret); in the Razorpay dashboard, register the webhook URL `${APP_URL}/api/webhooks/razorpay/{orgId}` for the `payment_link.paid` and `payment.captured` events using that same webhook secret; schedule the reconciliation poll (Cloud Scheduler → authenticated `POST /api/v1/billing/reconcile` hourly). Then run the wedge demo end-to-end on staging with a real ₹ payment. — *Still applies as written, on top of §11.5's new item 1 (stand up Supabase first).*

---

## 7. Next steps (in order)

1. **Run `npm run test:rules` on a Java-equipped machine / CI**; fix any red before anything else. This suite is the safety net for all future rules work.
2. ~~Finish Epic 5~~ **done** (kit + i18n + shell). Remaining Epic 5 polish that is deferred into the workspace rebuilds (Stage 1–3): restyling the *legacy* pages to tokens happens when each is retired per DEV_PLAN §"Delete on replace", not in place.
3. ~~Epic 6 (Payments)~~ **built** (server-side; see §3). ~~Epic 9 (Today workspace)~~ **built** (see §3). ~~Epic 10 (Parent portal)~~ **built** (see §3). All three need the same thing next: a **browser walkthrough on a seeded, live/emulated Firebase project** — confirm the Line renders today's sessions with a live cursor and one-tap attendance persists after undo; confirm a staff-generated parent invite redeems end to end (phone OTP → preview → consent → portal) and the Pay Now button reaches a real Razorpay-hosted page.
4. **Epics 7 & 8 are DEFERRED** (see §3) — resume once the founder's provider accounts clear (WhatsApp/SMS/email onboarding for 7; Google OAuth verification for 8).
5. Stage 1 exit gate: the wedge demo — mark attendance (now via Today) → invoice → UPI link (now reachable via staff *or* the parent portal) → real payment → self-reconciled ledger, in one take. Until Epic 7 lands, sending the link is manual: staff copies it from the Invoices page, or the parent portal's own Share-via-WhatsApp button opens it pre-filled.
6. ~~**Tech debt from Epic 10:** `StudentProfile.tsx`'s pre-existing "Link Parent Account" box~~ **done (2026-07-08).** Removed: the "Link Parent Account" / "Unlink Account" buttons, the parent-select-or-create modal, the `parentUser`/`availableParents`/`isLinkParentModalOpen`/`selectedParentId`/`newParent*`/`isCreatingParent` state, the two `useEffect`s that fed them, and the three legacy handlers (`handleLinkExistingParent`, `handleCreateAndLinkParent`, `handleUnlinkParent`). Only the display fields `parentName`/`parentPhone`/`parentEmail` on the student doc remain, plus the real Epic 10 "Parent Portal Access" invite card. Typecheck green; no other file referenced `student.parentId`.

---

## 8. Security invariants — do not regress (UPDATED for Supabase, §11)

1. Roles set **only** via `/api/v1/members` — a plain upsert/delete on `organization_members` via `server/supabaseAdmin.ts` (service_role, bypasses RLS). No more custom claims/token revocation: role is read fresh from `organization_members` on every request by `server/middleware/auth.ts`, so a role change or removal takes effect on the *next* API call, not after a token refresh.
2. Money mutations **only** via `/api/v1/billing`, idempotency-keyed (unique constraint on `(organization_id, idempotency_key)`), each writing an `audit_events` record. `invoices`/`payments`/`wallets`/`wallet_ledger`/`refunds` have no client INSERT/UPDATE/DELETE RLS policy at all — see `supabase/migrations/0002_rls.sql`.
3. Attendance = one real Postgres transaction (`server/db.ts`'s `withTransaction`) covering attendance records + wallet debit + invoice accrual — PostgREST can't hold a lock across a read-then-write, which is why this route uses a direct `pg` connection (`DATABASE_URL`) instead of the Supabase REST client.
4. Amounts are **integer paise** columns (`total_paise`, `paid_paise`, `subtotal_paise`, `tax_paise`, `discount_paise`, `amount_paise`); `total_amount`/`subtotal` rupee columns are legacy display mirrors only.
5. `google_tokens`, `audit_events`, `payment_gateways`, `refunds`, `invoice_counters`, `parent_invites` have **no** client access path — Postgres RLS is enabled on every `public` table (`0002_rls.sql`'s enable-RLS loop) and these simply have no policy, which means default-deny for every role except `service_role`. Do not add a client SELECT/INSERT/UPDATE/DELETE policy to any of these without a specific reason.
6. Never fabricate meeting links, invoice numbers, or payment confirmations client-side.
7. Gateway secrets (`payment_gateways`) are AES-GCM-encrypted, server-only, and never returned to the client — the API exposes connection state and the public key id only.
8. Every inbound webhook is HMAC-signature-verified against the org's stored secret **before** its body is trusted, and settled idempotently by gateway payment id (unique constraint, not a doc-id trick). The raw-body mount in `server.ts` (before JSON parsing) is load-bearing for this — do not reorder it.
9. **New (§11):** `class_sessions.student_ids` holds student RECORD ids; `student_user_ids`/`parent_user_ids` hold the auth uids RLS actually matches against. Never write a user id into `student_ids` or a record id into `student_user_ids`/`parent_user_ids` — that exact confusion caused the bug fixed in commit `7bac7c9` (empty student/parent schedules). Any new code path that creates a `class_sessions` row must populate all three via `resolveUserIds()` in `server/routes/scheduling.ts` (or its equivalent), not just `student_ids`.
10. **New (§11):** RLS policy/trigger changes must keep `tests/integration/rbac.test.ts` green — see §11.3. This is the enforceable version of "do not regress" for this whole section; a PR that touches `supabase/migrations/*.sql` or a privileged server route should run `npm run test:rls` before merge.

---

## 9. Known tech debt carried forward

- Old pages (StudentProfile 1,289 lines, Calendar, Students, Invoices) still exist and function but are slated for rebuild in Stages 2–3 (REDESIGN.md). They work inside the new shell but are not token-styled.
- Legacy rupee fields coexist with new paise fields on invoices/wallets; a cleanup pass removes the floats once all readers use paise.
- ~~No Sentry wired yet~~ **done (2026-07-08)** — see §10.
- Data migration script for Timestamp-vs-ISO-string on existing session docs — **moot now**, there's no existing data to migrate (pre-launch, fresh Postgres DB).
- ~~**Wallet top-up flow is dead**~~ **Resolved differently in §11, not "fixed" as originally scoped.** Self-service top-up was deliberately *not* wired to a real endpoint — instantly crediting your own wallet with no payment behind it is a fraud vector. Instead: (a) a real staff-only `POST /api/v1/billing/wallets/topup` endpoint now exists (manual-payment-style, idempotency-keyed, credits `wallets.balance_currency`), and (b) [Transactions.tsx](src/pages/Transactions.tsx)'s self-service button now shows an explanatory message directing the user to contact the tuition center, instead of silently failing. If self-serve top-up becomes a real product requirement, it needs a Razorpay-payment-link flow like invoices have, not a bare balance increment.
- ~~Rules test suite not run locally~~ **Resolved in §11.3**: the whole Firestore rules-testing approach (Firebase emulator + Java) is gone. `npm run test:rls` runs a real, executable Postgres RLS suite locally with zero external dependencies (PGlite, no Docker/Java) — see §11.3 for what it covers and how it was verified to actually catch regressions (not just pass vacuously).
- **New in §11:** nothing in the Supabase migration has been runtime-verified against a live Supabase instance, a browser, or real GoTrue auth — only `tsc`, unit tests, the RLS suite (against PGlite, not the real Postgres image), and a production build. See §11.6.
- **New in §11:** `profiles.organization_id` is a vestigial column — nothing in the app trusts it for authorization (real membership lives in `organization_members`), and it's now write-protected by a trigger (`0012_profiles_org_immutable.sql`) rather than removed. Consider dropping the column entirely in a later cleanup pass rather than leaving an unused-but-guarded field around.

---

## 10. Stage 0/1 gap-closing pass (2026-07-08)

A user-requested audit compared the actual codebase against every task ID in DEV_PLAN.md Stages 0–1 (Epics 1–10). Most of Epic 2 (security rules), Epic 5 (design shell), and Epic 9 (Today workspace) checked out clean. Real gaps found and fixed in this pass:

- **`@types/react`/`@types/react-dom` were missing from `package.json` entirely.** `tsc` was silently typing all of React as `any` project-wide — the CI "tsc must pass" gate (E1.6) wasn't really checking JSX/component code. Installed both; only 2 real errors surfaced across the whole repo, both fixed (see below and `ErrorBoundary.tsx`'s `ErrorBoundary` class needed an explicit constructor instead of a class-field initializer once React's `Component<Props, State>` typed properly).
- **Fixed a real TS2367 dead-code bug** in [src/pages/Onboarding.tsx](src/pages/Onboarding.tsx): the local `role` state was typed `'tutor' | 'parent' | 'student' | null`, one value short of the `User` type's `role`/`role_type` (which includes `'admin'`, used throughout `Admin.tsx`/`OrganizationSettings.tsx`/etc.). An account with `role_type: 'admin'` landing on Onboarding hit an unreachable branch and rendered nothing. Widened the state type to include `'admin'`.
- **Money formatting cleanup**: [Wallet.tsx](src/pages/Wallet.tsx), [Transactions.tsx](src/pages/Transactions.tsx), [StudentDashboard.tsx](src/pages/StudentDashboard.tsx) still had `$` + `.toFixed(2)` money renders (E3.3's own acceptance criterion — "grep for `$\{` returns zero hits" — was failing). Now route through `formatINR`/`formatPaise`.
- **Error boundaries per route** (E4.2, previously missing entirely): new [src/components/ErrorBoundary.tsx](src/components/ErrorBoundary.tsx) wraps the `<Outlet/>` in [Layout.tsx](src/components/Layout.tsx), keyed by route path so a crash on one page doesn't linger into the next. Reports to Sentry.
- **Sentry wired** (E1.7, previously not wired at all): `@sentry/react` in [src/main.tsx](src/main.tsx) (`VITE_SENTRY_DSN`) and `@sentry/node` in [server.ts](server.ts) (`SENTRY_DSN`), both no-ops when the DSN env var is unset. The central Express error handler and the new `ErrorBoundary` both report.
- **Bounded 14 previously-unbounded `onSnapshot` listeners** (E4.1's own acceptance criterion — "no unbounded query in `src/`" — was failing on ~40 call sites across AcademicProgress, Documents, Invoices, Calendar, Messaging, ParentPortal, StudentProfile, StudentDashboard, Leads, StudyMaterial, Timetable, Wallet, Transactions, Students). Added `limit()`/`orderBy()` per query, plus 6 missing composite indexes in [firestore.indexes.json](firestore.indexes.json) that the new `orderBy`+`where` combos need (`invoices` org+tutor+createdAt, `leads` org+createdAt, `messages` org+sender/receiver+createdAt, `class_sessions` org+tutor+status+startTime).
- **Server-side enrollment capacity + tutor double-booking checks** (E3.6 — was still a client read-then-write race in [src/services/ClassManager.ts](src/services/ClassManager.ts), exactly the bug the plan warns about). New [server/routes/scheduling.ts](server/routes/scheduling.ts): `POST /api/v1/scheduling/enrollments` and `POST /api/v1/scheduling/sessions` run the capacity/conflict check inside a Firestore transaction. `firestore.rules` now denies direct client `create` on `enrollments`/`class_sessions` (mirrors the money-collections deny-all pattern) — creation only happens via the Admin SDK, which bypasses rules. Two new rbac regression tests added.
- **Session materialization job** (E3.7, was entirely missing — batches got 3 months of sessions bulk-generated once at template-creation time, going stale the moment the template changed). Templates now persist their schedule (`daysOfWeek`/`startHour`/`startMinute`/`durationMinutes`/`isOnline`/`roomNumber`) as the source of truth. `materializeTemplate()` in `scheduling.ts` fills a rolling 8-week window, idempotent via deterministic `{templateId}_{date}` session IDs, conflicts returned in the response (never swallowed). `POST /api/v1/scheduling/materialize` (staff-triggered, own org) and `POST /api/cron/materialize-sessions` (new [server/routes/cron.ts](server/routes/cron.ts), shared-secret-gated via `CRON_SECRET` header for Cloud Scheduler — **you still need to actually create the Cloud Scheduler job**, same as the existing `/billing/reconcile` hourly poll from Epic 6).
- **Soft deletes** (E3.10 — `firestore.rules` already denied hard deletes on `students`, but nothing implemented the archive alternative, so the "Delete Student" button in [Students.tsx](src/pages/Students.tsx) was silently failing with permission-denied). Now sets `archivedAt` via `updateDoc`; the student list query filters archived students out.
- **Documents moved off base64-in-Firestore onto Cloud Storage** (E3.9 — the old flow FileReader'd the file into a data-URI Firestore field, never touching Storage at all despite `storage.rules` already existing for it). New [server/routes/documents.ts](server/routes/documents.ts): multipart upload (multer, in-memory) → server-side magic-byte sniff (rejects a mismatched/spoofed declared MIME type) → filename sanitization → `orgs/{orgId}/documents/{studentId}/...` in Cloud Storage → Firestore doc gets `storagePath`, not `fileUrl`. `GET /:id/url` mints a 15-minute signed URL after an authorization check; `DELETE /:id` (admin/owner) removes both the Storage object and the Firestore doc. `storage.rules` now denies direct client read/write under `orgs/{orgId}/documents/**` — access is server-mediated only. [Documents.tsx](src/pages/Documents.tsx) rewritten to call `uploadDocument`/`getDocumentUrl`/`deleteDocument` from [src/lib/api.ts](src/lib/api.ts).
- **Not fixed, flagged separately**: the wallet top-up dead-button (see above) and re-verifying the rules test suite on a Java-equipped machine.

**Verification this pass:** `npx tsc --noEmit` clean project-wide (0 errors), `npm test` 51/51 green throughout every step. No browser/emulator verification was done (same constraint as every prior pass — no live Firebase project, no Java for the rules emulator in this environment).

---

## 11. Firebase/Firestore → self-hosted Supabase/Postgres migration (2026-07-10)

**Why:** eliminate Google-platform lock-in and make the whole stack (app + auth + DB + storage) movable between hosting providers without an application rewrite. Self-hosted Supabase (Postgres + GoTrue auth + Realtime + Storage, all Docker containers) was chosen over a Neon+Vercel-style roll-your-own stack because it's close to a 1:1 replacement for what Firebase provided (Firestore → Postgres+RLS, Firebase Auth → GoTrue, Firebase Storage → Supabase Storage, `onSnapshot` → Realtime `postgres_changes`), rather than requiring auth/storage/realtime to be built from scratch. Full commit: `97e3281`; a real bug found immediately after (`7bac7c9`) is covered in §11.4.

### 11.1 What moved where

| Firebase concept | Supabase/Postgres equivalent |
|---|---|
| Firestore collections | Postgres tables, `supabase/migrations/0001_schema.sql` (~30 tables) |
| `firestore.rules` | Postgres RLS policies, `0002_rls.sql`, `0009_rls_fixes.sql`, `0011_rls_role_matrix_fixes.sql`, `0012_profiles_org_immutable.sql`, `0013_class_sessions_id_space_fix.sql` |
| Firebase custom claims + `organization_members` doc | **Collapsed into one**: `organization_members` table, read fresh by RLS + `server/middleware/auth.ts` on every request — no token-refresh staleness |
| Firebase Auth (email/password, Google OAuth, phone/OTP) | Supabase Auth (GoTrue) — same three methods; phone OTP needs an SMS provider configured in self-hosted GoTrue (Twilio etc., see `supabase/README.md`) |
| Firebase Storage | Supabase Storage, private bucket, signed URLs — `server/routes/documents.ts`, bucket created in `0004_storage.sql` |
| `db.runTransaction()` | Two paths: simple CRUD → `supabaseAdmin`/PostgREST (`server/supabaseAdmin.ts`); multi-statement transactions needing row locks (billing, scheduling) → a real `pg` connection + `BEGIN/COMMIT` (`server/db.ts`'s `withTransaction`), because PostgREST is one request per call and can't hold a lock across a read-then-write |
| `onSnapshot` (63 call sites, 16 files) | `.select()` + `.channel(...).on('postgres_changes', ...)` — refetch-on-any-change pattern, not diff-reconciliation |

`googleapis`/`google-auth-library` (the Google Calendar OAuth integration in `server/routes/settings.ts`) was **out of scope** — isolated product feature, not infrastructure. It was still touched, because its token storage (`google_tokens`) was on Firestore via `firebaseAdmin.ts` and needed the same infra swap.

### 11.2 Auth model change (read this before touching `server/middleware/auth.ts`)

The old model: Firebase custom claims (`role`, `organizationId`) embedded in the ID token, set via `adminAuth.setCustomUserClaims()` + `revokeRefreshTokens()`. Removing a member required revoking their tokens for the removal to take effect, and granting a role required the client to force a token refresh.

The new model: **no claims at all.** `organization_members(organization_id, user_id, role)` is the single source of truth. `authenticateToken` middleware verifies the Supabase JWT to get just the user's identity (`sub`), then does a fresh `organization_members` lookup on *every request* to get role/org. A role change or member removal takes effect on the very next API call — no revocation step, no client-side refresh dance. This is strictly simpler and was verified via the RLS suite's `organization_members` tests (§11.3).

**JWT verification updated 2026-07-10 (§12.6) — read this.** New Supabase projects (including this one) default to **asymmetric JWT signing keys (ES256/RS256)**, not the legacy HS256 shared secret. The middleware originally verified HS256-only, which would have 401'd every real login. It now verifies via `jose`: asymmetric tokens against Supabase's public JWKS (`${SUPABASE_URL}/auth/v1/.well-known/jwks.json`, cached), falling back to HS256 with `SUPABASE_JWT_SECRET` for any legacy tokens still in circulation. Consequence: **`SUPABASE_URL` must be set for auth to work** (it drives the JWKS URL); `SUPABASE_JWT_SECRET` is now optional (HS256 fallback only). Don't revert this to HS256-only.

### 11.3 The RLS test suite (`tests/integration/`) — read this before touching any migration file

The old `tests/rules/rbac.test.ts` (Firestore rules, run against the Firebase emulator via `@firebase/rules-unit-testing`) was deleted with the rest of the Firestore infra. It was rebuilt as `tests/integration/rbac.test.ts` — **not a re-audit, an actual running test suite**, using `@electric-sql/pglite` (real Postgres compiled to WASM, not an emulation or a mock). `npm run test:rls` boots a fresh in-memory Postgres, applies `supabase/test/auth_shim.sql` (a minimal `auth.uid()`/`auth.users`/role shim matching real Supabase behavior) + every real `supabase/migrations/*.sql` file, then runs 40 assertions ported 1:1 from the old suite (organization role escalation, financial-table write denial, the leads/audit_events role matrix, conversation privacy, org-scoped tutor profiles, parent/student self-access, every server-only table). No Docker, no Java, no external services — it's a devDependency and runs in plain CI.

**This is load-bearing, not decorative** — while building it, it caught two real gaps that had shipped silently:
1. `profiles.organization_id` was self-writable with no column-level protection (nothing currently trusts that column for authorization, but it's exactly the kind of landmine that becomes exploitable the moment someone adds a policy that does). Fixed with a `BEFORE UPDATE` trigger (`0012_profiles_org_immutable.sql`) — RLS's `WITH CHECK` genuinely cannot express "this column is immutable" via a self-referential subquery (verified empirically: it silently doesn't work, the subquery sees the row as already updated).
2. The `class_sessions` id-space bug (§11.4).

Both fixes were verified with a **deliberate regression check**: temporarily re-break the policy/trigger, confirm the suite fails exactly the expected test (not more, not fewer, not vacuously green), then restore. Do this again for any future RLS change you're not 100% sure about — it's cheap (`npm run test:rls` runs in ~2s) and it's the only way to know the suite isn't just passing by accident.

**Two Postgres RLS behaviors that differ from Firestore rules and will surprise you:**
- A table with RLS enabled and **no policy** for a role doesn't error — `SELECT` silently returns zero rows, `INSERT`/`UPDATE`/`DELETE` silently affect zero rows (or error, for `INSERT` without a matching `WITH CHECK`... actually behavior varies — read the actual test assertions in `rbac.test.ts` rather than assuming). Firestore rules deny by throwing; Postgres denies by filtering.
- Postgres **aborts the whole transaction** after any single error until `ROLLBACK` (or `ROLLBACK TO SAVEPOINT`). If a test needs to assert two separate "this should be denied" operations in one scenario, wrap each in `expectDenied()` (in `tests/integration/db.ts`) — it uses a `SAVEPOINT` internally so the transaction can keep going afterward. Forgetting this produces a confusing `"current transaction is aborted, commands ignored until end of transaction block"` error on the *next* unrelated query, not on the one that actually failed.

### 11.4 Bug found and fixed post-migration: `class_sessions` id-space confusion (commit `7bac7c9`)

The original Firestore `class_sessions` doc kept **three** separate arrays — `studentIds` (student record ids), `studentUserIds` (student auth uids), `parentUserIds` (parent auth uids) — specifically so record-id lookups (staff UI) and `auth.uid()`-based RLS checks never collided. The Postgres migration collapsed `studentIds`/`studentUserIds` into one `student_ids` column. Consequence: the booking UI (`Calendar.tsx`) populates `student_ids` with student *record* ids, but the RLS policy and `Timetable.tsx`/`StudentDashboard.tsx` compared it against `auth.uid()` — the wrong id space — so **a student's own timetable and dashboard silently showed zero sessions**, and `parent_user_ids` was never written at all so **the parent portal always showed zero upcoming sessions.**

Fixed by restoring the three-array shape: `0013_class_sessions_id_space_fix.sql` adds `student_user_ids` and repoints the RLS policy at it; `server/routes/scheduling.ts` gained a `resolveUserIds()` helper that populates `student_user_ids`/`parent_user_ids` at session-creation time (both the direct booking route and the recurring-session `materializeTemplate`) by resolving each student's `student_user_id` and linked `parent_links`. **If you add any new code path that inserts a `class_sessions` row, it must go through this resolver (or populate all three arrays itself) — see security invariant #9 in §8.**

### 11.5 Blocked on you (current, replaces the stale §6)

1. ~~Stand up a Supabase instance and apply the migrations~~ **DONE — see §13.1.** Migrations applied via `supabase db push` to the Cloud project (`cwugpiernnwrhcximjwh`); the schema is live.
2. Configure Google OAuth for GoTrue (reuse the existing Google OAuth client, add the new redirect URI) if "Sign in with Google" needs to keep working.
3. Configure an SMS provider (Twilio etc.) in self-hosted GoTrue for phone/OTP login — Firebase Auth's phone OTP had this bundled; GoTrue doesn't.
4. Set the new env vars app-wide: `SUPABASE_URL`, `SUPABASE_ANON_KEY`/`VITE_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `DATABASE_URL` — see `.env.example`.
5. **Run an actual end-to-end pass once Supabase is live** — this migration has never been runtime-verified against real infra (see §11.6). Priority walkthrough: signup → org bootstrap → student enrollment → session booking → Today workspace (does a student see their own upcoming session now? — this is exactly what §11.4 broke) → attendance → invoice → payment webhook.
6. Everything in the old §6 items 3 and 5 (Razorpay live KYC, WhatsApp/SMS/email onboarding, wiring the payment loop to a real gateway) still applies, on top of item 1 above.

### 11.6 Verification status (current, replaces the stale §5)

| Check | Status |
|---|---|
| `npx tsc --noEmit` | ✅ clean, project-wide |
| `npm test` (unit) | ✅ 51/51 |
| `npm run test:rls` (RLS/RBAC integration, PGlite) | ✅ 40/40 — verified to actually catch regressions via deliberate revert-and-check (§11.3) |
| `npm run build` | ✅ clean (frontend + server bundle) |
| Runtime against a live Supabase instance | ✅ **as of 2026-07-10 — migrations applied, app deployed and rendering; see §13** for the current, more granular status |
| Browser walkthrough (any workspace) | ⚠️ not yet run — see §13.4 next action |
| Real GoTrue auth (email/password, Google OAuth, phone/OTP) | ⚠️ JWT verification fixed for the live project's key type (§11.7a/§13.2); actual login flow not yet exercised end to end |
| Supabase Realtime (`postgres_changes` subscriptions, 63 call sites) | ⚠️ **never done** — written correctly per the API, never connected to a live Realtime server |
| Supabase Storage (signed URLs, document upload/download) | ⚠️ **never done** |
| Razorpay webhook / reconcile against the new Postgres transaction code | ⚠️ **never done** (same gap as the original Firestore-era item, now on new infra) |

### 11.7a JWT signing-keys fix (2026-07-10, §12.6)

Verifying the real project's dashboard showed it uses the new asymmetric JWT signing keys (Current key ECC P-256), with the legacy HS256 secret rotated to "previous". `server/middleware/auth.ts` was updated to verify asymmetric tokens via the Supabase JWKS endpoint (`jose`), HS256 as fallback — see §11.2. Without this, every authenticated request would have 401'd on the real project. Added `jose` dependency.

### 11.7 CI change

`.github/workflows/ci.yml` dropped the Java + Firebase-emulator step (`actions/setup-java` + `firebase-tools emulators:exec`) and added `npm run test:rls` as a plain step — no external dependencies, since PGlite runs embedded in Node. CI is now simpler and faster than the Firestore-era pipeline, not just different.

---

## 12. Engineering audit + DEV_PLAN rewrite + Supabase provisioning status (2026-07-10)

A user-requested Lead-Staff-Engineer audit re-verified the whole repo against the docs and rewrote [DEV_PLAN.md](DEV_PLAN.md) from scratch for the Supabase era (the old plan was Firestore-era; its product intent lives on in REDESIGN.md / GO_TO_MARKET_BLUEPRINT.md). This section records what the audit re-confirmed, what it newly found, and the current provisioning reality.

### 12.1 Re-verified green (static + test-suite level)

All HANDOFF claims that can be checked without live infra hold: `tsc --noEmit` clean project-wide, `npm test` 51/51, `npm run test:rls` 40/40 (PGlite), `npm run build` passing. Zero Firebase deps in `package.json`; only explanatory comments reference Firebase/Firestore. The server-authoritative money model, HMAC-verified raw-body webhooks, per-request `organization_members` auth, and the three-array `class_sessions` id-space fix are all present as described.

### 12.2 Supabase provisioning reality — NOT stood up

The migration has **never been applied to any live database.** A Supabase Cloud project (`cwugpiernnwrhcximjwh`) exists but is empty (dashboard still shows the "run your first migration" onboarding). This is now Blocker 1 in DEV_PLAN.md and the first item of §11.5 above. Two mismatches gate it: the hosted-vs-self-hosted direction decision (repo assumes self-hosted `localhost:8000`), and CLI setup (no `config.toml`, never linked, migration filenames `0001_*.sql` are not `supabase db push`-compatible — the CLI wants 14-digit-timestamp prefixes). Details and fix steps in DEV_PLAN.md Blocker 1 + Tech Debt #11/#12.

### 12.3 New defects found (were not in §1–§11)

1. **Live legacy document-upload bypass — FIXED (§12.5).** [Students.tsx](src/pages/Students.tsx) `handleUploadDoc` used to `FileReader`-base64 files straight into `documents.file_url` via a direct client `supabase.from("documents").insert(...)`, bypassing the Epic 3.9 server storage route and writing megabyte base64 blobs into Postgres; its download link and delete handler were also direct-client (and delete would have silently no-op'd — no client delete RLS policy). All three now route through the server storage API (`uploadDocument`/`getDocumentUrl`/`deleteDocument`). The Documents.tsx flow had been migrated earlier; this second, older path in Students.tsx was missed until the audit.
2. **Client-side jsPDF duplicates the server invoice** — [Invoices.tsx](src/pages/Invoices.tsx), [StudentProfile.tsx](src/pages/StudentProfile.tsx), [AcademicProgress.tsx](src/pages/AcademicProgress.tsx) each statically import `jspdf` + `jspdf-autotable` and render their own PDFs, diverging from the server's GST-snapshot invoice ([server/utils/invoicePdf.ts](server/utils/invoicePdf.ts)) and pulling ~620KB of chunks into the client bundle. Invoices.tsx should call `downloadInvoicePdf`. DEV_PLAN Tech Debt #2.
3. **`recharts` is a dead dependency** — imported by no route since the Dashboard was deleted in Epic 9, still in `package.json`. Main client chunk is ~678KB raw with no size gate in CI (the old plan's 200KB-gzip budget was never enforced). DEV_PLAN Tech Debt #6.

None of these are regressions from the migration; all three predate it and survived because the legacy pages haven't been rebuilt yet (Stage 2). #1 was fixed in this pass (§12.5); #2 and #3 are logged in DEV_PLAN.md with effort/priority.

### 12.4 Audit scores (0–100)

Repo health 78 · Production readiness 40 · Security 82 · Technical debt 68 · Performance 70 · Maintainability 76 · Architecture 85. **Launchable in ~2–4 weeks of turning-on work** (Blockers 1–4 + the base64 fix + a rehearsed backup restore + the wedge demo on real infra) — the engineering foundation is sound; it has simply never been run.

### 12.5 Hosting-prep changes committed alongside this audit

The working directory `~/Downloads/Tuition-SaaS-main/` **is** the real clone (remote `Sankaranakshar/Tuition-SaaS`, branch `main`) — an earlier note here mistakenly called it a git-less snapshot; that was wrong. The audit + the following hosting-prep changes were committed and pushed together:

- **Supabase direction set to hosted (Cloud).** `supabase/README.md` now leads with the hosted-Cloud path (project ref `cwugpiernnwrhcximjwh`); self-hosted Docker demoted to Option B. `.env.example` updated for hosted values (was `localhost:8000` + a stale AI-Studio `APP_URL` header).
- **Migrations renamed to CLI format.** `0001_*.sql … 0013_*.sql` → `<14-digit-timestamp>_name.sql` (order preserved), so `supabase db push` tracks them. Added `supabase/config.toml` (needed by `supabase link`/`db push`). The RLS harness (`tests/integration/db.ts`) now skips the storage migration by `_storage.sql` suffix instead of the old hardcoded `0004_storage.sql`; `npm run test:rls` re-verified 40/40 after the rename.
- **Base64 upload bypass fixed** (was §12.3 defect #1): `Students.tsx` document upload/download/delete now route through the server storage API (`uploadDocument`/`getDocumentUrl`/`deleteDocument`), not direct client inserts/deletes. Typecheck clean.

**Hosting model set: Vercel (app) + Supabase Cloud (backend).** The Express server was refactored so it can run both ways without duplication: `server/app.ts` exports `createApp()` (all middleware + routes + error handler, no listener); `server.ts` wraps it with Vite/static + `app.listen()` for local dev and traditional hosts; `api/index.ts` exports the same app as a Vercel serverless function. `vercel.json` builds the SPA (`vite build` → `dist`, served statically) and rewrites `/api/*` into the function. `server/db.ts` caps the pg pool (`max` 3) for serverless. **On Vercel, `DATABASE_URL` must point at Supabase's transaction pooler (port 6543)**, and env vars live in Vercel project settings, not a local `.env`. Verified locally (`/api/health` + JSON 404 boot clean; tsc/build green); the serverless path itself is unvalidated until a real Vercel deploy.

Still not done as of §12: applying the migrations to the Cloud DB, setting the real env values in Vercel, configuring Google/Phone auth providers, and the first end-to-end runtime walkthrough. **All of the migration/env/first-boot items are now done — see §13.**

---

## 13. First live deploy: Vercel + Supabase Cloud (2026-07-10)

The app is now live on Vercel against the real Supabase project (`cwugpiernnwrhcximjwh`) for the first time. This section captures what actually happened standing it up, since two real issues surfaced that aren't obvious from the code and are worth knowing before touching auth or env config again.

### 13.1 Migrations applied

`supabase db push` (after `supabase login` + `supabase link --project-ref cwugpiernnwrhcximjwh`) applied all 13 renamed migrations successfully. The database is no longer empty — confirmed via the Table Editor showing the full ~37-table schema. **§11.5 item 1 / §12.2 is resolved: the migration has been applied to a live database.**

### 13.2 JWT signing keys — real finding, already fixed in code (§11.7a)

Checking the live project's **Settings → JWT Keys** showed it defaults to the **new asymmetric signing keys** (current key: ECC P-256), with the legacy HS256 shared secret demoted to "previous key, verify-only." This is Supabase's new default for projects created via the Vercel integration, not something this repo's migrations control. Confirmed the JWKS-based fix (§11.7a, commit `c690306`) matches reality before deploying — had the code still been HS256-only, every login on this project would have 401'd. **Lesson for future projects on this stack: check JWT Keys in the dashboard before assuming HS256.**

### 13.3 Vercel-Supabase integration env var naming — the actual deploy blocker

The Supabase project was created *through Vercel's Supabase integration*, which auto-injects env vars under **Next.js-style names**: `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, `SUPABASE_JWT_SECRET`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY`, plus `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`. **It does not know this is a Vite app and never sets the `VITE_*`-prefixed vars Vite requires to expose anything to client code** (`import.meta.env.VITE_*`). Symptom on first deploy: a blank page with `Error: supabaseUrl is required.` in the console (src/supabase.ts:5 — `import.meta.env.VITE_SUPABASE_URL` was `undefined`), then after adding that one, `Error: supabaseKey is required.` (same gap for `VITE_SUPABASE_ANON_KEY`).

**Fix (manual, in Vercel dashboard, not a code change):** add these two vars explicitly, copying values from the integration-provided ones —
- `VITE_SUPABASE_URL` = same value as `SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY` = same value as `SUPABASE_ANON_KEY` / `NEXT_PUBLIC_SUPABASE_ANON_KEY` (use the **legacy** `anon`/`public` JWT-format key from API Keys → Legacy tab, not the new `sb_publishable_...` key — `@supabase/supabase-js` on this version expects the JWT-format key)

Also confirm `DATABASE_URL` is set — **the Vercel-Supabase integration does not add this one at all**, and without it every billing/scheduling route (anything using `server/db.ts`'s transactional `pg` connection) 500s. Use the **transaction pooler** URI (port 6543), not the direct 5432 connection.

Then redeploy — Vite bakes `VITE_*` vars in at **build** time, so saving the env var alone does not fix an already-built deployment.

**Takeaway for next time / other projects on this integration:** don't assume the integration's auto-added vars are sufficient for a Vite app. Audit for `VITE_*` names specifically, and manually add `DATABASE_URL`.

### 13.4 Status after this pass

| Check | Status |
|---|---|
| Migrations applied to live Supabase | ✅ done (§13.1) |
| Vercel deploy live, frontend renders | ✅ confirmed — blank-page error cleared after adding `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` |
| `/api/health` reachable on the deployed URL | ⚠️ not yet confirmed by the user |
| Signup → org bootstrap → student → session → attendance → invoice walkthrough | ⚠️ not yet run — this is the next step, and the first real test of the JWKS auth fix, RLS policies, and `DATABASE_URL` against live traffic |
| Google OAuth / Phone OTP providers configured | ⚠️ not yet done |
| Razorpay live keys / webhook registered | ⚠️ not yet done |

Next action: run the walkthrough in 13.4's third row and report what happens (screenshot the Network tab on any failure — most informative signal for a live-infra bug).
