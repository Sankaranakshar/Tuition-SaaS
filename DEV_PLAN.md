# ClassStackr Unified Development Plan
## One executable plan merging REDESIGN.md (experience) and GO_TO_MARKET_BLUEPRINT.md (foundation, security, GTM)

**How this document works.** REDESIGN.md defines what the product should feel like (phases R0-R6). GO_TO_MARKET_BLUEPRINT.md defines what must be true underneath it (phases 1-5, security findings C1-C5, the money loop). This plan interleaves both into a single 24-week schedule of epics with tasks, owners, dependencies, and acceptance criteria, so nothing is built twice and nothing insecure ships under a beautiful surface.

**Team assumption:** Engineer A (backend/infra lead), Engineer B (frontend/product lead), Founder (design decisions, GTM, pilot management). Adjust week counts proportionally for a different team.

**Two non-negotiable sequencing rules:**
1. **No feature work ships to any external user before Epics 1-4 are complete** (the security and data-integrity epics). A polished UI on top of client-writable money is a liability, not a product.
2. **Every new surface is built on the new shell and design tokens from Epic 5 onward.** No screen gets built twice: old pages are retired when their replacement workspace lands, never restyled in place.

**Ticket ID convention used below:** `E<epic>.<task>`. Each epic lists its blocking dependencies.

---

# Stage 0: Foundation and Safety (Weeks 1-4)
*Blueprint Phase 1 + REDESIGN Phase 0. Nothing here is user-visible except the shell. Everything here is load-bearing.*

## Epic 1: Repository, environments, CI (Week 1) — Engineer A
Dependencies: none. This is day one.

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| E1.1 | `git init`, push to GitHub, branch protection on `main` | Repo exists; PRs required |
| E1.2 | Rename package (`react-example` → `classstackr`), set version 0.1.0, remove dead deps (`bcryptjs`, `jsonwebtoken`, `@google/genai`, `xlsx` → `exceljs`) | `npm ls` clean; build passes |
| E1.3 | Delete duplicate `/components/ui` tree; single source in `src/components/ui` | One ui directory; imports fixed |
| E1.4 | Firebase emulator suite config (auth, firestore, storage) + seed script with demo org | `npm run dev:emulators` boots a working local app |
| E1.5 | Three Firebase projects: dev/staging/prod; per-env `.env`; separate OAuth clients | Staging deploy reachable; prod empty |
| E1.6 | GitHub Actions: lint (`tsc` + eslint) → unit tests → rules tests → build; deploy to staging on merge | Red PR cannot merge |
| E1.7 | Sentry (frontend + Express), pino → Cloud Logging with request IDs | A thrown test error appears in Sentry from staging |
| E1.8 | Dockerfile for Express API, Cloud Run deploy, Firebase Hosting for SPA, `/api/v1` prefix | One-command deploy documented and rehearsed |

## Epic 2: Security rules rewrite, spec-first (Weeks 1-2) — Engineer A
Dependencies: E1.4 (emulators), E1.6 (CI). Fixes blueprint findings C1-C5.

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| E2.1 | Encode the RBAC matrix (blueprint 9.3) as a Firestore rules test suite with `@firebase/rules-unit-testing`; one test per matrix cell plus explicit regression tests for C1-C5 | Suite runs in CI; fails against current rules (proving it tests the real vulns) |
| E2.2 | Roles move to custom claims + `organization_members`, set only by a server endpoint; `users` doc update rule restricted to `hasOnlyAllowedFields(['name','phone','timezone','photoUrl'])` | C1 test green: self-role-escalation write is denied |
| E2.3 | Deny ALL client writes to `wallets`, `invoices`, `payments`, `transactions`, `attendance_records`, `wallet_ledger`, `billing_events` | C2 tests green |
| E2.4 | Role-aware rules per the matrix for students, sessions, templates, leads, programs, courses (replace flat `isOrgMember`) | C3 tests green |
| E2.5 | `conversations`/`messages` readable only by `participantIds`; fix parent→student read path (map through `parent_links`, not auth-UID-in-studentIds) | C4 tests green; parent can read own child's sessions, not others |
| E2.6 | Remove `tutor_profiles` world-read (FindTutors is cut); delete FindTutors page and route | C5 test green; route gone |
| E2.7 | Auth middleware: role from verified custom claims only; `requireRole` accepts a role set, not string-equals-admin; revoke refresh tokens on role change/member removal | Middleware unit tests green |
| E2.8 | Drop cookie-token path in API auth (header only); fix crypto error message; add key-version prefix to ciphertext format | No `req.cookies.token` reads; decrypt handles both formats |

## Epic 3: One data model, server-authoritative money (Weeks 2-4) — Engineer A
Dependencies: E2 (rules must exist before privileged endpoints trust them).

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| E3.1 | Kill SQLite: migrate `google_refresh_token` (AES-GCM encrypted) to a server-only Firestore collection; delete `server/db.ts`, all SQLite tables, the user-sync block in auth middleware, and SQLite-backed routes (students, invoices, messages, dashboard) | `better-sqlite3` removed from package.json; API stateless; app still works via Firestore |
| E3.2 | New collections per blueprint 8.1: `attendance_records`, `payments`, `wallet_ledger` (append-only), `billing_events`, `parent_links`, `audit_events`; typed Firestore converters in `src/lib/firestore.ts` for every collection | Types compile; no raw `doc.data() as X` casts in new code |
| E3.3 | Money as integer paise everywhere; single `lib/format.ts` (₹ Indian grouping, relative dates); purge every `$` render | grep for `$$\{` and `toFixed(2)` on money returns zero hits |
| E3.4 | Server endpoint `POST /api/v1/billing/attendance`: transaction that writes attendance_records + wallet_ledger debit or billing_event invoice line, idempotent on (sessionId, studentId), audit-logged | Marking twice bills once; attendance persists; ClassManager client-side billing deleted |
| E3.5 | Server endpoints: record manual payment, adjust wallet, void invoice, approve invoice batch; all idempotency-keyed and audit-logged | Rules tests + supertest integration tests green |
| E3.6 | Move conflict detection + capacity check server-side: bounded query (orgId + tutorId + time window), capacity checked inside the enrollment transaction, applies to all class types | Race test (two parallel enrollments at capacity 1) admits exactly one |
| E3.7 | Session materialization: template as source of truth; Cloud Scheduler job materializes 8 weeks rolling; conflict skips surface as `conflicts[]` in the API response, never silent console.warn | Editing a template reshapes future sessions; skipped dates visible |
| E3.8 | Firestore Timestamps replace ISO strings on new writes; `firestore.indexes.json` committed (sessions, invoices, attendance, enrollments composites); migration script for existing data | Indexed queries verified in emulator; deploy includes indexes |
| E3.9 | Documents to Cloud Storage: storage rules mirroring org isolation, signed URLs, magic-byte MIME sniffing, filename sanitization; delete local-disk upload path | Upload/download works on staging; server has no `uploads/` dir |
| E3.10 | Soft deletes: `archivedAt` on students/enrollments; deny hard deletes of anything with financial history | Rules test green |

## Epic 4: Query hygiene and error honesty (Week 3, parallel) — Engineer B
Dependencies: E1.

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| E4.1 | Every Firestore listener gets `limit()` + date bounds; Dashboard's four unbounded `onSnapshot`s replaced with one bounded hook pattern (TanStack Query + listener hooks) | No unbounded query in `src/`; dashboard reads this-week data only |
| E4.2 | Error boundaries per route; Firestore errors surface as visible retry states, not console.error + silent zeros | Killing emulator mid-session shows error UI, not fake zeros |
| E4.3 | Purge `alert()` / `window.confirm()` (5 call sites: Calendar ×3, Leads, Contact); toast + undo pattern component (`UndoToast`) | grep returns zero; undo works on lead delete |
| E4.4 | Route-level code splitting; recharts/jspdf/exceljs dynamic imports | Initial bundle <200KB gzipped, enforced by size-limit in CI |

## Epic 5: Design foundation and app shell (Weeks 3-4) — Engineer B + Founder
Dependencies: E1.3. This is REDESIGN Phase 0.

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| E5.1 | `tokens.css`: type scale (12/13/14/16/20/28, weights 450/600, tabular-nums), color system (slate base + single indigo accent + semantic amber/red/green), 4px spacing grid, radii (6/10), dark theme variables | No raw hex or arbitrary Tailwind values in new components; dark mode toggles |
| E5.2 | Shell rewrite replacing `Layout.tsx`: 56px icon rail (5 workspaces + settings, badge dots), topbar, role-adaptive menus | Old sidebar deleted; fake search input gone |
| E5.3 | Command palette (`Cmd+K`, shadcn Command): navigation + entity jump (people, invoices) + create actions; `/` focuses list filter; `?` shortcut map | Palette reaches every route and every person by name |
| E5.4 | Core component kit: `EmptyState`, `Skeleton` patterns, `StatChip`, `PersonRow`, `AgedBadge`, `ContextCard`, popover-edit primitive | Storybook-style demo route renders all states |
| E5.5 | i18n wrapper (react-i18next) on all new strings; en locale file | New components have zero hardcoded user-facing strings |
| E5.6 | Old pages mounted inside new shell unchanged (temporary) | App fully navigable; nothing lost |

**Stage 0 exit gate:** rules test suite green in CI proving the RBAC matrix; no client can write money; attendance persists; SQLite gone; one-command deploy to staging; app runs inside the new shell. *Founder demo: log in as a student in the console, attempt to self-promote and edit an invoice, show both denied.*

---

# Stage 1: The Money Loop and Today (Weeks 5-10)
*Blueprint Phase 2 + REDESIGN Phase 1. The wedge becomes real: attendance → invoice → WhatsApp UPI link → self-reconciling payment, driven from the new Today surface.*

**Week 5, day 1, Founder tasks (long lead times, start immediately):** Razorpay live KYC application; WhatsApp Business API onboarding (Interakt/Gupshup) + template approvals; SMS DLT registration; engage CA for GST invoice format review; draft privacy policy + ToS with DPDP parental-consent language.

## Epic 6: Payments (Weeks 5-7) — Engineer A
Dependencies: E3.5 (money endpoints), E2.3.

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| E6.1 | Razorpay integration: payment link per invoice, order creation, test-mode e2e | Test payment marks invoice paid |
| E6.2 | Webhook endpoint: signature verification, idempotency by gateway payment id, reconciliation to `payments` + invoice status machine (draft→sent→partially_paid→paid|void) | Duplicate webhook delivery processed once; partial payments accumulate correctly |
| E6.3 | Hourly reconciliation poll for missed webhooks | Kill webhook delivery in test; invoice still reconciles within the hour |
| E6.4 | Invoice numbering (INV-{org}-{YYYY}-{seq}, transactional counter), GST fields, org tax settings | CA-reviewed sample invoice approved |
| E6.5 | PDF receipt/invoice generation endpoint (server-side, org logo) | Parent-quality PDF downloads from staging |
| E6.6 | Refund and void flows (manual, audit-logged) | Void leaves immutable record; ledger balances |

## Epic 7: Outbound communications (Weeks 6-8) — Engineer A
Dependencies: E6.1 (payment links to send), founder's provider onboarding.

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| E7.1 | Channel router: notification event → WhatsApp template / SMS fallback / email (Resend or SES), per-user channel prefs, Cloud Tasks queue with retry | Failed sends retry; delivery status stored |
| E7.2 | Templates: fee reminder (with payment link), payment receipt, schedule change, session reminder | All approved by WhatsApp; rendered with real data on staging |
| E7.3 | Anti-spam: max 2 WhatsApp/day per parent, digest batching, quiet hours | Config enforced in router tests |
| E7.4 | Bulk fee-reminder endpoint: select N invoices → N personalized sends, one audit event | 30 reminders send in one action from the API |

## Epic 8: Real scheduling integrations (Week 8) — Engineer A
Dependencies: E3.7.

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| E8.1 | Google Calendar event creation on session create/update/cancel; real Meet links via Calendar API conferenceData; placeholder-link code deleted | Joining the link from a session opens a real Meet |
| E8.2 | Token revocation handling: expired/revoked refresh token → user-visible reconnect prompt, sessions still function without sync | Revoking access in Google account does not break scheduling |
| E8.3 | Timezone correctness: org IANA zone + user zone, UTC storage, viewer-local render | A session created in Kolkata renders correctly for a viewer in Dubai |

## Epic 9: Today workspace (Weeks 6-9) — Engineer B
Dependencies: E5 (shell), E3.4 (attendance endpoint), E4.1 (bounded queries). REDESIGN sections 5 and 6.1-partial.

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| E9.1 | The Line: today's session timeline with real-time now-cursor; state-aware action per block (Join → Mark attendance → "N unmarked") | State transitions happen live as clock passes session boundaries |
| E9.2 | One-tap attendance: roster popover, all-present default + exception taps, optimistic with undo, calls E3.4 | Marking a 12-student batch takes under 10 seconds; undo reverses billing event |
| E9.3 | Attention queue v1, rules-based: overdue invoices (aged), unmarked past sessions, absence streaks (3+), quiet leads (6+ days), schedule conflicts; each item has inline action + snooze/dismiss | Every item type renders with a working action; queue empties to the rewarding empty state |
| E9.4 | The Pulse: collected ₹ this month, outstanding ₹, sessions this week vs last; links into Money/Schedule | Three numbers, no charts, correct against ledger |
| E9.5 | Attendance debt counter + backdated marking (7-day window, audit-logged) | Unmarked sessions from yesterday appear and clear |
| E9.6 | Admin variant: stacked tutor timelines | Org owner sees all tutors' days |
| E9.7 | Retire old Dashboard page | Route removed |

## Epic 10: Parent portal v1, mobile-web-first (Weeks 8-10) — Engineer B
Dependencies: E6 (payable invoices), E2.5 (parent read rules), E5.

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| E10.1 | Parent onboarding: phone OTP verification, `parent_links` creation, DPDP consent capture | Consent record stored with timestamp |
| E10.2 | Children overview: schedule, attendance, outstanding balance per child | Flawless at 375px |
| E10.3 | Invoice view + pay: Razorpay checkout from the portal and from WhatsApp deep link | Real UPI payment on a phone completes and reconciles |
| E10.4 | Receipt history + wallet balance view | Matches ledger exactly |

**Stage 1 exit gate (the wedge demo):** on staging with live-mode Razorpay: tutor marks attendance from Today → invoice auto-drafts → WhatsApp reminder with UPI link hits a real phone → parent pays → invoice self-marks paid → Pulse updates. One unbroken take, no manual steps.

---

# Stage 2: The Lovable Product (Weeks 11-16)
*REDESIGN Phases 2-3 + blueprint Phase 3. The surfaces that sell.*

## Epic 11: Student Story + People (Weeks 11-13) — Engineer B
Dependencies: E3.2 (attendance/payments data to render), E5. REDESIGN 6.2-6.3. Retires StudentProfile (1,289 lines), Students, Leads pages.

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| E11.1 | Timeline component: reverse-chron interleave of sessions/attendance, homework, payments/invoices, messages, notes, milestones; filter chips; virtualized | 2 years of history scrolls at 60fps |
| E11.2 | Pinned header: batches, parent contact (tap to call/message), wallet, outstanding, attendance rate | Parent-call prep under 10 seconds |
| E11.3 | Inline composers: note, homework assignment, record payment (via E3.5) | No modals for the three common cases |
| E11.4 | Permission-lensed variants: parent view (no private notes), student view; replaces AcademicProgress + StudyMaterial pages | Same component, three roles, rules-verified |
| E11.5 | People directory: four lenses (Students/Leads/Parents/Tutors), needs-attention default sort, hover actions, bulk select + bulk message/invoice | Keyboard navigable end to end |
| E11.6 | Lead funnel strip + going-cold list; `lastTouchedAt`/`nextActionAt`; one-action convert (atomic student + enrollment + notes carry-over); public per-org inquiry form feeding leads | Kanban deleted; convert is one click; form submission appears in funnel |
| E11.7 | CSV student import with dry-run preview and phone dedup | A 200-row messy CSV imports with a comprehensible error report |

## Epic 12: Money workspace (Weeks 13-15) — Engineer B (front) + A (batch drafting)
Dependencies: E6 complete. REDESIGN 6.4. Retires Invoices, Wallet, Transactions pages.

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| E12.1 | Outstanding segment: grouped by payer, aging buckets (0-7/8-30/30+) with escalating temperature, sticky selection-total footer, bulk remind (E7.4) | Select-all-30+-days → one click → reminders sent |
| E12.2 | Monthly batch drafting job (Cloud Scheduler) + one-screen approval flow | Month-end for 30 students under 10 minutes, measured |
| E12.3 | Inline record-payment popover (two fields, optimistic, undo) | Cash payment recorded in under 5 seconds, receipt auto-sent |
| E12.4 | Wallets segment: balances, depletion projection ("covers 3 more sessions"), threshold alerts feeding the Today queue | Projection matches template pricing |
| E12.5 | Invoice detail as document: Stripe-style activity trail (sent→viewed→reminded→paid), PDF download | Trail complete for a full lifecycle |
| E12.6 | Insights segment: revenue trend, collection rate, aging, revenue per class type, all from nightly `org_stats_daily` aggregates + XLSX/CSV export | Zero unbounded queries; charts load <500ms |

## Epic 13: Inbox + homework loop (Weeks 14-16) — Engineer B
Dependencies: E2.5, E7. REDESIGN 6.5. Retires Messaging + Notifications pages.

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| E13.1 | Threads with context anchors (student/session/invoice/homework) rendering `ContextCard` with inline actions | "Record payment" works from inside a fee thread |
| E13.2 | Class broadcast channels with delivery/read state | Batch announcement reaches all parents via router |
| E13.3 | Notifications become actionable inbox items; deep links; triage keys (unread-first, `E` archive, snooze) | No dead-end notification exists |
| E13.4 | Homework loop: assign (files + due date) → student submits (upload to Storage) → grade (points + comment) → parent visibility; feeds Student Story and the queue ("2 submissions waiting") | Full loop demo across three roles |

## Epic 14: Onboarding + settings (Week 16) — Engineer B
Dependencies: E11.7. REDESIGN 6.6-6.7.

| ID | Task | Acceptance criteria |
|----|------|---------------------|
| E14.1 | Three-beat setup (solo/center → first class from template gallery → add students/import) + demo-data workspace with one-click wipe | New center reaches a booked calendar in 3 minutes |
| E14.2 | Checklist aha: "send yourself a test fee reminder" | Test WhatsApp arrives during onboarding |
| E14.3 | Unified Settings (merges Settings/Profile/Preferences + org/billing/availability components), palette-searchable sections | Three old routes retired |

**Stage 2 exit gate:** the three REDESIGN journey benchmarks measured and passing (parent-call prep <10s; month-end billing 30 students <10min; self-onboarding <30min), all legacy pages for replaced surfaces deleted, E2E suite covers the five golden journeys.

---

# Stage 3: Pilot Hardening (Weeks 17-20)
*Blueprint Phase 4 + REDESIGN Phase 4. Five paying pilot centers using it daily.*

## Epic 15: Schedule workspace rebuild — Engineer B (Weeks 17-19)
Dependencies: E3.6/E3.7/E8. REDESIGN 6.1. Retires Calendar, Timetable, Bookings.
- E15.1 Week-default calendar, day/week/month via `1/2/3`, dnd-kit drag create/move/resize with server conflict check on drop (snap-back + ghost highlight on conflict)
- E15.2 Availability overlay (dimmed out-of-hours) + drag-editable availability in Settings sharing the same interaction
- E15.3 Recurring edit scopes (this one / this and future / all) inline
- E15.4 One-popover class creation (template → students with capacity meter → slots) + "find a gap" slot picker
- Acceptance: rescheduling a recurring batch is a 15-second alert-free operation; keyboard equivalents for all drag actions.

## Epic 16: Operate-the-business layer — Engineer A (Weeks 17-19)
- E16.1 SaaS subscription billing: org plans, Razorpay subscriptions, feature gating hooks, free tier limits
- E16.2 Super-admin app: org list with health metrics, audited impersonation, per-org feature flags, usage metering
- E16.3 Org data export (full JSON/XLSX) + offboarding deletion job honoring retention (financial 8y)
- E16.4 Audit log viewer (super-admin; org-admin read of own org)
- Acceptance: you can answer a support ticket without touching the database console; an org can be gated, exported, and offboarded.

## Epic 17: Hardening gauntlet — both (Weeks 19-20)
- E17.1 Load test (k6): Monday-6pm attendance burst + cold Today load at 5x pilot volume; fix to p95 API <400ms, Today interactive <2s on mid-range Android
- E17.2 External pentest; triage and fix criticals/highs
- E17.3 Accessibility pass: axe in CI + manual keyboard sweep per REDESIGN 14 (focus rings, contrast tokens, aria-live on toasts, 44px touch targets)
- E17.4 Backup/restore rehearsal (restore staging from prod export; document RPO 24h / RTO 4h); incident response one-pager; release smoke script
- E17.5 Docs package: architecture, schema/ER, rules rationale, deployment + rollback runbook, onboarding guide (EN + HI), support macros; legal live (privacy, ToS, refund policy)

**Stage 3 exit gate = the blueprint section 14 launch checklist, every line green.** Pilots renewing at full price is the human gate.

---

# Stage 4: Launch and Listen (Weeks 21-24)
*Blueprint Phase 5 + REDESIGN Phases 5-6.*

- **E18 Mobile-web polish (B):** bottom tab bar (Today/Schedule/Inbox/More), swipe-to-mark-attendance agenda, record-payment bottom sheet, push-to-actionable-sheet deep links; front-desk tablet layout for attendance.
- **E19 Growth loop (A + Founder):** payment-link footer referral, PostHog activation funnel (signup→first class→first attendance→first payment) with weekly review, public launch to the metro ICP, weekly release cadence using the smoke script.
- **E20 Intelligence v1 (A):** morning brief via Claude API (Haiku-class) summarizing the already-rules-based queue; per-org AI toggle; evidence links on every output. (Queue anomalies are already live from E9.3; this epic only adds the narrative layer. Reply drafting and forecasting stay post-launch per blueprint 12.)

**Success criteria (from the blueprint):** 25 paying orgs, week-4 retention >80% of activated orgs, >₹10L monthly fee volume collected through the platform.

---

# Cross-cutting rules of engagement

1. **Definition of done, every task:** typed, rules-tested if it touches Firestore, unit-tested if it touches money math, i18n-wrapped strings, dark-mode-checked, keyboard-reachable, Sentry-clean on staging for 24h.
2. **The rules test suite is the constitution.** Any PR touching `firestore.rules` or a privileged endpoint must add or update matrix tests first.
3. **Money invariants, enforced by tests:** integer paise only; ledgers append-only; every mutation idempotency-keyed and audit-logged; invoice statuses move only along the state machine.
4. **Delete on replace.** When a new workspace lands, its legacy pages are removed in the same PR. The retirement list: Dashboard (E9.7), StudentProfile/Students/Leads (E11), Invoices/Wallet/Transactions (E12), Messaging/Notifications (E13), Settings/Profile/Preferences (E14), Calendar/Timetable/Bookings (E15), FindTutors (E2.6).
5. **No em dashes in product copy;** UX writing follows REDESIGN.md tone (calm, plain language, relative dates).
6. **Weekly cadence:** Monday scope check against this plan, Friday staging demo of the week's acceptance criteria. Slippage handling: cut scope inside a stage, never reorder stages, and never let Stage 0/1 work leak past its gate unfinished.

## Dependency spine (the critical path)

```
E1 CI/envs → E2 rules(+tests) → E3 server-money → E6 Razorpay → E7 WhatsApp → Stage 1 gate
                          ↘ E5 shell → E9 Today ↗
E3 data model → E11 Student Story → E12 Money UI → Stage 2 gate
E3.7 + E8 → E15 Schedule;  E6 → E16 SaaS billing → Stage 3 gate → Launch
```

Long-lead external items to start week 5 day 1 regardless of engineering state: Razorpay KYC, WhatsApp template approval, SMS DLT registration, CA invoice review, legal docs.
