# ClassStackr: Production & Go-to-Market Blueprint
## From AI-generated prototype to launchable product

*Companion to REDESIGN.md (product experience). This document covers everything else: audit, architecture, data, security, APIs, DevOps, QA, AI, documentation, launch readiness, and a 12-month roadmap. Every claim about the current state is verified against the code in this repository.*

**Priority legend used throughout:**
- **P0 Critical** = launch is irresponsible without it
- **P1 High** = launch is embarrassing without it
- **P2 Medium** = needed within 90 days of launch
- **P3 Future** = roadmap
- Effort in engineer-weeks (ew) assuming one strong full-stack engineer; divide for a team.

---

# 1. Executive Summary

**Verdict: this codebase is a promising prototype approximately 25 to 30 percent of the way to a launchable product.** The class-type domain model is genuinely good. Almost everything around it (security, data integrity, payments, communications, testing, operations) is either missing or actively dangerous.

Three findings dominate everything else:

1. **The product has at least four Critical security vulnerabilities**, including a self-service privilege escalation to admin and client-writable financial records. Launching multi-tenant with these is a data breach with a countdown timer. (Section 9.)
2. **The money loop is not closed.** There is no payment gateway, no email or SMS or WhatsApp delivery, attendance records are never actually persisted (a code comment admits it), and Google Meet links are hard-coded placeholders. The product's core promise (schedule, teach, get paid) cannot currently be fulfilled end to end.
3. **There are two incompatible products in one repository.** A legacy SQLite/Express app (integer student IDs, tutor-owned students, its own messaging tables) and a Firestore multi-tenant app (org-scoped documents) coexist, partially synced, with two user stores and two messaging systems. Every week of building on both doubles future migration cost.

**The strategy in one paragraph:** collapse to a single source of truth (Firestore + Cloud Functions, drop SQLite), move all money and attendance logic server-side, close the loop with Razorpay and WhatsApp, execute the UX rebuild in REDESIGN.md, and launch in India as a focused wedge product ("the tuition center OS that collects your fees for you") rather than a feature-count war against Teachmint and Classplus. Realistic timeline to a launch a founder can defend: **20 to 24 weeks with 2 engineers**, phased below.

Top 10 actions by leverage:

| # | Action | Priority | Effort |
|---|--------|----------|--------|
| 1 | Fix privilege escalation + rewrite Firestore rules role-aware | P0 | 2 ew |
| 2 | Move wallet/invoice/attendance writes server-side (Cloud Functions or Express) | P0 | 3 ew |
| 3 | Kill the SQLite dual-store; one data model | P0 | 3 ew |
| 4 | Persist attendance records (currently never saved) | P0 | 1 ew |
| 5 | Razorpay integration (UPI links on invoices, webhooks) | P0 | 3 ew |
| 6 | WhatsApp + email delivery (reminders, schedules, receipts) | P0 | 2 ew |
| 7 | Real Google Meet link creation (Calendar API, exists in parts, wire it) | P1 | 1 ew |
| 8 | Test harness + CI (zero tests exist today) | P0 | 2 ew |
| 9 | Pagination/query limits (dashboard loads entire collections unbounded) | P1 | 1 ew |
| 10 | Execute REDESIGN.md Phases 0-2 (shell, Today, Student Story) | P1 | 8 ew |

---

# 2. Current State Assessment

## 2.1 What is genuinely good (keep and build on)

- **The class-type domain model** (`ClassManager.ts`): templates carrying type, pricing model, capacity, and recurrence is the correct abstraction and a real differentiator versus calendar-first competitors.
- **AES-256-GCM token encryption** (`server/utils/crypto.ts`) is correctly implemented (random 12-byte IV, auth tag verified).
- **Firestore rules exist and attempt org isolation.** Wrong in important ways (section 9) but the structure (helper functions, per-collection matches) is salvageable.
- **Server-side JWT verification** via Firebase Admin with sensible token extraction.
- **Helmet, rate limiting, pino logging, memory-buffered uploads with MIME allowlists**: the right instincts, wrong calibrations.
- The stack itself (React 19, Vite, Tailwind 4, Firestore, Express) is fine for this market and team size.

## 2.2 The unvarnished problems

**Architecture**
- **Dual-store split brain (the biggest structural problem).** `server/db.ts` defines a full relational app (users, students with `INTEGER PRIMARY KEY` and `tutor_id`, classes, documents, invoices, messages) while Firestore defines a different app (org-scoped `students`, `class_sessions`, `invoices`, `conversations`, `messages`). Both are live. The frontend talks mostly to Firestore directly; Express routes talk to SQLite; the auth middleware lazily syncs users from Firestore into SQLite. Two user stores, two invoice stores, two messaging systems, incompatible ID schemes. This is not a "hybrid architecture," it is two half-applications.
- **Business logic in the browser.** `ClassManager.ts` runs enrollment capacity checks, conflict detection, and wallet debiting from the client. Anything the client computes, a hostile client can skip or forge, and the Firestore rules currently let it (section 9).
- SQLite as a file in `process.cwd()` means single-instance deployment forever, data loss on container replacement, and no horizontal scaling. Same for uploaded documents written to local disk.
- No error-handling middleware in Express, no JSON 404 for unknown API routes, no graceful shutdown, hard-coded port.

**Business logic gaps (verified in code)**
- `markAttendance` ends with the comment "We would also save attendance records here." **Attendance is never persisted.** Wallets get debited and sessions flip to completed, but there is no record of who attended. The billing-from-attendance promise is built on data that does not exist.
- Meeting links are `https://meet.google.com/placeholder-${Date.now()}`: fake URLs that will be sent to real parents.
- Capacity check runs outside the enrollment write (race: two simultaneous enrollments both pass a 5/5 check). Only checks BATCH; small groups and workshops are uncapped.
- Conflict query has no lower time bound and no org filter: it scans every scheduled session the tutor has ever had, from the client, forever growing.
- Recurring generation writes ~90 session docs and silently `console.warn`s away conflicts: sessions just vanish from the series with no user-visible trace.
- The invoice auto-created on insufficient balance duplicates every time attendance is re-marked; there is no idempotency key.
- No timezone handling anywhere (sessions stored as ISO strings interpreted in browser-local time); no double-billing guard; no refunds; no proration; no cancellation policy logic.

**Missing product-critical capabilities**
- **No payment collection.** Invoices exist as records; parents cannot pay them. In India this means UPI/Razorpay or the product is a fancy notebook.
- **No outbound communication.** No email provider, no SMS, no WhatsApp. Reminders, receipts, schedule changes: none can leave the app.
- No audit log, no soft deletes (deletes are real deletes on financial data), no data export for an org, no org deletion/offboarding, no branch concept despite the multi-branch pitch, no payroll, no announcements, no homework submission flow wired end to end.

**Engineering hygiene**
- **Zero tests.** No test runner, no CI, no lint config beyond `tsc --noEmit`.
- `package.json` is named `react-example`, version 0.0.0. No Dockerfile, no IaC, no environments, no `firestore.indexes.json`, no Storage rules, no deploy story at all.
- Unused/legacy dependencies: `bcryptjs` and `jsonwebtoken` (leftover custom auth), `@google/genai` (unwired), `xlsx` (SheetJS 0.18.5 has known unpatched CVEs; replace with `exceljs` or the maintained SheetJS CDN build).
- Duplicate `components/ui` trees; 31-state god components (see REDESIGN.md section 0).
- Rate limit of 100 requests per 15 minutes per IP would break a single active user if the Express API were actually used; it survives only because the frontend bypasses Express for Firestore.

**Performance**
- The dashboard opens four `onSnapshot` listeners with **no `limit()`**: every student, every session ever, every invoice ever, every assessment ever, recomputed on every change. At 200 students and a year of history this is thousands of document reads per page open (cost) and visible jank (UX).
- No code splitting: recharts, jspdf, xlsx, googleapis-adjacent code all in the main bundle. No route-level lazy loading, no list virtualization.

## 2.3 The two-products problem, decided

**Decision required, and my recommendation: Firestore wins, SQLite dies.** The frontend already lives on Firestore; the org model lives in Firestore; realtime is native there. The Express server shrinks to what genuinely needs a trusted server: Google OAuth + Calendar/Meet, payment webhooks, PDF/XLSX generation, file handling (moved to Cloud Storage), and privileged money mutations (or those become Cloud Functions). Everything in `server/db.ts` except `google_refresh_token` storage is deleted or migrated. This single decision removes the sync layer, the second user store, the second messaging system, and the single-instance constraint.

---

# 3. Gap Analysis by User Role

For each role: what exists, what is missing. Missing items are tagged with priority.

## 3.1 Organization Owner
**Exists:** create org, admin panel stub, dashboard KPIs.
**Missing:** staff invitation flow with roles (P0); org-wide revenue and outstanding view (P0); tutor performance/utilization (P1); branch management (P2); billing plan and subscription management for the SaaS itself (P0 for monetization); org settings: logo, invoice numbering, tax details/GSTIN, fee policies (P0); audit log of staff actions (P1); data export (P1); org offboarding/deletion (P1).

## 3.2 Branch Manager
**Nothing exists.** The pitch mentions multi-branch; the schema has no branch entity. **Decision: cut from launch (P3).** Model `branchId` as an optional field on students/templates/sessions now (1 day, prevents painful migration), build the role later. Do not build UI for a persona with zero design-partner demand yet.

## 3.3 Tutor
**Exists:** dashboard, students CRUD, calendar, invoices, leads, messaging, documents, availability settings.
**Missing:** one-tap attendance that actually records attendance (P0); fee reminder sending (P0); homework assign/collect/grade loop (P1); session notes (P1); substitute/reassignment flow (P2); payroll visibility for employed tutors (P2); mobile-usable anything (P1).

## 3.4 Student
**Exists:** dashboard, timetable, bookings, wallet view, study material, progress page.
**Missing:** working session join links (P0); homework submission with feedback loop (P1); notifications that deep-link (P1). **Cut:** the 11-item nav (REDESIGN.md collapses it to 5).

## 3.5 Parent
**Largest gap relative to importance: the parent pays the bills and barely has a product.** Firestore rules reference `parent_id` relationships but there is no parent portal beyond profile scraps.
**Missing:** children overview (P0); view and **pay** invoices (P0); attendance and progress visibility (P1); message tutor (P1); consent/data controls for minors (P1, DPDP requirement). Parent experience should be mobile-web-first.

## 3.6 Accountant
**Nothing exists.** For launch, cover with: role with read-only Money access (P1); exports to XLSX/Tally-friendly CSV (P1); invoice numbering and GST fields (P0 if invoicing legally in India). Full payroll, ledgers, reconciliation: P2/P3.

## 3.7 Reception / Front-desk Admin
**Nothing exists as a role.** Needs: create leads, book trials, record cash payments, mark attendance for any tutor, no access to org financial reports. This is one RBAC role plus existing screens (P1, cheap once RBAC is real).

## 3.8 Super Admin (you, the operator)
**Nothing exists.** Needed before you have 10 customers: org list with health metrics (P1); impersonation with audit trail and consent (P1); feature flags per org (P1); usage metering (P1); support tooling (P2). Without this, every support ticket becomes a database spelunking session.

---

# 4. Product Strategy

## 4.1 Market position

Competitors: **Teachmint and Classplus** (India, feature-broad, app-first, sales-heavy, increasingly content-monetization focused), **Proctur, MyClassCampus** (legacy ERP feel), **TutorBird, Teachworks, TutorCruncher** (Western, solo-tutor or agency focused, weak in India payments/WhatsApp). Nobody in the India segment is loved for product quality; all are feature checklists.

**Do not compete on feature count. You will lose.** Classplus has hundreds of engineers. Compete on a wedge:

> **"ClassStackr collects your fees."** The only tuition management product where attendance automatically becomes an invoice, the invoice automatically becomes a WhatsApp payment link, and the money automatically reconciles. Everything else (scheduling, messaging, progress) exists to feed that loop.

This wedge is: measurable in rupees (easy sale), viral through parents (every payment link is marketing), defensible through workflow lock-in (the ledger is the moat), and honest to the codebase's one differentiated asset (the class-type pricing engine).

Secondary differentiator, from REDESIGN.md: **speed and calm.** Every competitor feels like an ERP. Being the Linear of this category is a real position because tutors demo software to each other in staff rooms.

## 4.2 Who the product serves at launch

Primary ICP: **tuition centers with 1 to 5 tutors and 30 to 300 students in Indian metros/tier-2**, currently running on WhatsApp groups + paper registers + GPay screenshots. Secondary: solo premium tutors. Explicitly not at launch: schools, franchises, marketplaces (cut FindTutors per REDESIGN.md), and non-India markets.

## 4.3 Monetization (currently nonexistent)

The product has pricing pages but no billing for itself. Recommendation: per-active-student pricing (aligns cost with value, scales with center size), e.g. free up to 15 students, then slab pricing; payments collected via Razorpay subscriptions; annual discount. Payment-collection transaction margin (0.2 to 0.5 percent on top of gateway fees) becomes the second revenue line once volume exists. Build org-level subscription state + feature gating in Phase 2 (P0 for GTM; you cannot go to market without a way to charge).

---

# 5. Feature Specification by Module

Format per module: state, spec (purpose, key stories, data, edge cases, failures), priority. Modules the roadmap cuts entirely are listed at the end. REDESIGN.md owns the screen-level UX for each of these; this section owns behavior and data.

### 5.1 Attendance (P0, the keystone module)
- **State:** UI toggles exist; records never persisted; wallet debits happen client-side.
- **Spec:** `attendance_records` collection: sessionId, studentId, status (present/absent/late/excused), markedBy, markedAt, billingEventId. Written only server-side in the same transaction as wallet debit / invoice line creation, with an idempotency key (sessionId+studentId). Stories: tutor marks all-present in one tap then flips exceptions; re-marking corrects rather than duplicates billing; parent sees attendance same-day. Edge cases: session cancelled after marking (reverse billing event), student enrolled mid-batch, marking a session twice, marking without wallet (auto-invoice, exactly once), backdated marking (allowed 7 days, audit-logged). Failure: transaction abort leaves nothing half-written (Firestore transaction gives this if and only if all writes move inside it). Reports: attendance rate per student/batch, absence streak detection feeding the Today queue. Audit: every status change logged with actor.

### 5.2 Billing, Wallets, Invoices, Payments (P0)
- **State:** invoice records + wallet balances, client-writable (see 9.1), no gateway, no receipts, no numbering, no tax fields.
- **Spec:** server-authoritative ledger. Entities: `invoices` (immutable line items JSON, sequential per-org number INV-{org}-{YYYY}-{seq}, GST fields, status machine draft→sent→partially_paid→paid|void, never deleted, only voided), `payments` (gateway or manual, method, reconciliation state), `wallet_ledger` (append-only entries; wallet balance becomes a derived/cached value, fixing the current mutable-balance-field design), `billing_events` (attendance-generated accruals). Stories: monthly batch-draft + one-click approve (REDESIGN.md 8); parent taps WhatsApp link, pays UPI, invoice self-marks paid via webhook; front desk records cash with a receipt auto-sent. Edge cases: partial payments, overpayment→wallet credit, refunds (manual first), discount/scholarship lines, mid-month enrollment proration, duplicate webhook delivery (idempotency by gateway payment id). Failures: gateway down→links degrade to "notify tutor of intent to pay"; webhook missed→hourly reconciliation poll. Integrations: Razorpay (payment links + webhooks + subscriptions for your own SaaS billing). Exports: XLSX and CSV per date range. Audit: every state change. Analytics: collection rate, aging buckets, revenue by class type.

### 5.3 Scheduling, Calendar, Class Templates (P0, exists, needs hardening)
- Move conflict detection server-side with bounded queries (`startTime` range window + orgId + tutorId) and a composite index. Template as source of truth with rolling 8-week session materialization (scheduled job) replacing the 3-month client-side generation. Cancellation/reschedule flows that carry billing consequences (5.2). Timezone: store UTC + IANA zone on org and user; render in viewer's zone (P1; single-city centers survive without it briefly, online tutors do not). Google Calendar sync: OAuth flow exists, make event creation and **real** Meet links work, handle token revocation gracefully (P1).

### 5.4 People: Students, Parents, Enrollments (P0)
- One canonical student record (Firestore), linked parent accounts with verified phone (OTP via MSG91/Firebase phone auth), enrollment as the join with status history. Import: CSV with dry-run preview (P1, decisive for onboarding 200-student centers). Dedup by phone. Soft-delete/archival: students are never hard-deleted once they have financial history (P0, currently rules allow any org member to delete students).

### 5.5 Leads / CRM (P1)
- Per REDESIGN.md 6.2 (funnel + going-cold list). Data adds: `lastTouchedAt`, `nextActionAt`, source, and a conversion that atomically creates student + enrollment + carries notes. Public inquiry web-form per org (P1, feeds the funnel automatically; UTM capture P2).

### 5.6 Messaging & Announcements (P1)
- **Decide the honest scope: this is not WhatsApp and will not beat WhatsApp for chat.** In-app messaging exists for context-anchored threads (REDESIGN.md 6.5) and audit trail; **outbound notifications go where parents already are: WhatsApp templates + SMS fallback + email.** Batch announcement channels with delivery/read receipts. Firestore rules must restrict reads to participants (currently any org member reads everything, see 9.1). Cut: the SQLite messaging system entirely.

### 5.7 Homework & Assessments (P1)
- Close the loop: assign (template + files + due date) → student submits (upload) → tutor grades (rubric or points + comment) → parent sees. Assessments already have a collection; add types (test/quiz/assignment), max marks normalization, and the "students needing attention" thresholds become configurable per org. Progress reports: monthly auto-compiled PDF per student (P2).

### 5.8 Documents & Files (P0 to fix, P1 to polish)
- **Move storage to Firebase Cloud Storage** (currently server local disk: lost on redeploy, unscalable, unscanned). Storage security rules mirroring Firestore org isolation. Signed URLs, 5MB cap kept, per-org quota metering (P1). Server-side MIME sniffing (magic bytes, not just declared type). Malware scanning via Cloud Function + ClamAV or a scanning API (P2).

### 5.9 Notifications (P1)
- One `notifications` collection feeding: in-app Inbox items (actionable, deep-linked), push (FCM, P2), and the outbound channel router (5.6). Per-user preferences matrix (channel × event type). Digest batching to avoid parent spam (max 2 WhatsApp/day per parent, configurable).

### 5.10 Reports & Analytics (P2)
- Launch scope: Money Insights (revenue trend, aging, collection rate, revenue per class type), attendance heatmap, lead funnel conversion. All queries against pre-aggregated `org_stats_daily` documents written by a nightly function (prevents the unbounded-collection-scan pattern that the current dashboard uses). Everything exportable. Deep BI: P3.

### 5.11 Settings, Roles & Permissions (P0)
- Real RBAC: roles owner/admin/tutor/frontdesk/accountant/parent/student as **custom claims** set by a server function on membership changes (never client-writable), enforced in Firestore rules per collection per operation (matrix in section 9.3). Org settings: identity, tax, invoice numbering, fee policies, working hours, academic year.

### 5.12 Onboarding (P1)
- Per REDESIGN.md 6.7 plus: sample-data workspace ("explore with demo data" that one click wipes), CSV import, and a WhatsApp-connected checklist ("send yourself a test fee reminder" as the aha moment).

### 5.13 Audit Log (P1)
- Append-only `audit_events` per org: actor, action, entity, before/after summary, IP, timestamp. Written server-side only. Surfaces: org admin view (P2), super-admin view (P1). Retention 2 years.

### 5.14 Public website & Help (P1/P2)
- Keep marketing pages, restyle per design system. Add: real pricing with signup, privacy policy and terms (P0, legally required), help center as static docs (P2), in-app feedback widget (P2).

### Cut from launch entirely
FindTutors marketplace (strategic dilution), Branch Manager UI (3.2), Payroll (P3), Inventory (not applicable), native mobile apps (mobile web first, per REDESIGN.md 16), GraphQL (no consumer needs it), microservices (see 7.1), custom AI chatbot (section 12 has the real AI plan).

---

# 6. UX Strategy

**REDESIGN.md is the UX strategy** (IA, navigation, Today, Student Story, Money, Inbox, design system, motion, accessibility, mobile). This section adds only what that document does not cover:

- **Internationalization:** launch English-only but wrap all strings in an i18n layer (react-i18next) from Phase 1; Hindi is the obvious second locale and retrofitting i18n into 40 screens later is a multi-week tax. Number/currency formatting through one utility from day one (also fixes the $ bug). Date locale via date-fns locales.
- **Branding:** orgs get logo + accent color on parent/student surfaces and invoices (white-label-lite); tutor-side chrome stays ClassStackr.
- **Offline states:** explicit banner + queued-writes pattern for attendance marking on flaky center Wi-Fi (mobile web, Workbox background sync) (P2).
- **Error states:** every Firestore permission error currently lands in `console.error` and the UI silently shows zeros (verified in Dashboard.tsx). Standard: user-visible error surface with retry, and Sentry capture (section 10).
- **Tablet:** the attendance and front-desk flows get a tablet-comfortable layout (front desks run on cheap Android tablets); everything else inherits responsive desktop.

---

# 7. Technical Architecture (target)

## 7.1 Shape: modular monolith + BaaS. Explicitly not microservices.

At this team size microservices are a self-inflicted wound. Target topology:

```
Client (React SPA, Vite)
  ├── Firestore (direct, realtime reads + benign writes, rules-enforced)
  ├── Firebase Auth (identity; custom claims = roles)
  ├── Cloud Storage (files, signed URLs, storage rules)
  └── API service (the existing Express app, slimmed)
        ├── /api/oauth/google (Calendar + Meet, refresh tokens AES-GCM encrypted)
        ├── /api/billing (privileged mutations: mark attendance, record payment,
        │     approve invoice batch, wallet adjustments)  ← server-authoritative
        ├── /api/webhooks (razorpay, whatsapp provider; signature-verified, idempotent)
        ├── /api/export (PDF invoices, XLSX)
        └── /api/admin (super-admin operations)
Scheduled jobs (Cloud Scheduler → function or API endpoint):
  session materialization, invoice drafting, reminder scheduling,
  daily stats aggregation, reconciliation poll
```

Decisions and rationale:
- **SQLite: removed** (2.3). The Express server becomes stateless → horizontally scalable, deployable on Cloud Run with min instances 1.
- **Privileged writes via API, not client SDK.** Money, attendance, role changes, enrollment. Firestore rules then deny client writes to those collections outright, which is a far smaller attack surface than validating complex writes in rules.
- **Realtime stays Firestore native** (no WebSocket server needed): Inbox, Today timeline, notifications.
- **Queues/background jobs:** Cloud Tasks for retryable work (send WhatsApp, generate PDF, sync calendar event); Cloud Scheduler for cron. No Kafka, no Redis queue at this scale.
- **Caching:** Firestore + client SDK cache covers reads; the one true caching need is the pre-aggregated `org_stats_daily` (5.10). Add Redis only if/when the API layer measurably needs it.
- **Search:** Firestore cannot do full-text. Launch scope: client-side search over the org's people (small N) + palette. At >1k students per org, add Typesense/Algolia (P3).
- **Feature flags:** a `feature_flags` doc per org + a tiny hook; no vendor needed yet.
- **Multi-region/DR:** Firestore multi-region (nam5 or eur3... choose **asia-south1/2 pairing** for India data residency) + daily scheduled Firestore exports to GCS (this is the backup strategy; Firestore has PITR, enable it). Cloud Run is regional; acceptable at launch.
- **API versioning:** prefix `/api/v1` now; costs nothing, saves a migration.

## 7.2 Frontend architecture
- Route-level code splitting (React.lazy) per workspace; recharts/jspdf/exceljs as dynamic imports. Target: <200KB gzipped initial.
- State: TanStack Query for API calls + Firestore listener hooks with mandatory `limit()`; kill the copy-paste onSnapshot-into-useState pattern (Dashboard.tsx has four of them with manual merge logic).
- Error boundaries per workspace; Sentry.
- One `lib/format.ts` (₹, dates, relative time) and one `lib/firestore.ts` (typed converters per collection; today types are casts and drift is guaranteed).

## 7.3 Environments
`dev` (local, Firebase emulator suite: auth, firestore, storage, functions), `staging` (separate Firebase project, seeded demo data), `prod`. Separate Google OAuth clients and Razorpay test/live keys per env. Firebase project config via `.env` per env; never a shared project between staging and prod.

---

# 8. Database Design

## 8.1 Canonical Firestore schema (single source of truth)

Core collections (all org-scoped fields mandatory and immutable after create):

```
organizations, organization_members (roles), users
students, parent_links (parent↔student, verified), enrollments
programs, courses, class_templates, class_sessions
tutor_availability
attendance_records            ← NEW (5.1)
invoices, payments            ← payments NEW
wallet_ledger                 ← NEW append-only (replaces mutable wallet balance)
wallets                       ← becomes cached-balance doc, server-written only
billing_events                ← NEW (attendance→money bridge)
leads, lead_activities        ← NEW (touch history)
conversations, messages, announcements
homework, homework_submissions ← NEW
assessments
notifications, notification_prefs
documents (metadata; bytes in Cloud Storage)
audit_events                  ← NEW
org_stats_daily               ← NEW aggregates
feature_flags, subscriptions  ← NEW (your SaaS billing)
```

## 8.2 Rules of the schema
- **IDs:** one identity scheme. Students are documents whose ID is independent of auth UID, with optional `studentUserId`/parent links to auth accounts. Sessions reference student doc IDs; rules must map through parent_links for parent read access (the current `request.auth.uid in resource.data.studentIds` check compares auth UIDs to student doc IDs and is likely simply broken; verify with emulator tests).
- **Soft deletes everywhere financial or historical:** `archivedAt` field; rules deny reads of archived docs to non-admins; hard delete only via offboarding job.
- **Money as integer paise**, never floats. (Current code does `balanceCurrency - feeAmount` on floats.)
- **Denormalize names** (studentName on sessions/invoices) for list rendering; a Cloud Function fans out renames. Firestore makes joins expensive; embrace controlled denormalization with a single writer.
- **Timestamps:** Firestore Timestamp type, not ISO strings (enables range queries and correct ordering; current strings work but only by luck of ISO format).
- **`firestore.indexes.json` in repo** with composite indexes for: sessions by (orgId, tutorId, startTime), (orgId, startTime), invoices by (orgId, status, dueDate), attendance by (orgId, studentId, date), enrollments by (templateId, status).
- **Versioning/audit:** invoices and attendance are append-or-void, never update-in-place; `audit_events` covers the rest.
- **Retention:** messages 2y, audit 2y, financial records 8y (Indian tax), documents until org deletion; scheduled archival job to GCS coldline (P3).

---

# 9. Security Review

## 9.1 Critical vulnerabilities (fix before any external user touches this)

**C1. Self-service privilege escalation to admin.**
`firestore.rules` line 51: `users/{userId}` allows `update: if isOwner(userId)` with no field restrictions → any user sets `role: "admin"` on their own user doc. `server/middleware/auth.ts` then syncs that doc into SQLite and trusts it: `let role = user?.role || decodedToken.role || "student"`, and `requireRole` grants everything to `'admin'`. **Any authenticated user becomes a full admin of the API in two writes.** Fix: roles live only in custom claims + `organization_members`, both writable only by server code; users doc update rule gets `hasOnlyAllowedFields(['name','phone','timezone','photoUrl'])`.

**C2. Client-writable money.**
Rules for `wallets`, `invoices`, `transactions` allow update by any `isOrgMember`. Combined with C1 (or simply by being any member): balances and invoice statuses are directly editable from the browser console. A student org member marks their invoices paid and tops up their own wallet. Fix: deny all client writes on financial collections; mutations only via the API/Cloud Functions (7.1).

**C3. `isOrgMember` is a single flat privilege.**
Students, sessions, templates, leads, programs: full CRUD for **every** org member regardless of role. If students/parents are ever made org members (the onboarding flow suggests they are), they can read the entire student roster, all leads, and delete students. Even if only staff are members, front-desk = owner. Fix: role matrix (9.3).

**C4. Messaging privacy failure.**
`conversations` and `messages` are readable by any org member: every tutor (and any member) can read every private parent-tutor conversation in the org. Fix: `request.auth.uid in resource.data.participantIds`.

**C5 (adjacent). `tutor_profiles` readable by any authenticated user of the entire platform** (cross-tenant): `allow read: if isAuthenticated()`. Leaks names/contact details across organizations. Presumably for FindTutors; cutting that feature closes this.

## 9.2 High-priority issues
- **Server files on local disk** (documents): unscalable and unscanned; move to Cloud Storage with rules (5.8).
- **MIME trust:** multer filters declared content-type only; sniff magic bytes server-side; also sanitize filenames (path traversal defense-in-depth even with memory storage).
- **No webhook infrastructure yet**: when added, signature verification + idempotency are P0 parts of the payment work, not afterthoughts.
- **Rate limiting** keyed only by IP behind `trust proxy 1`: fine on Cloud Run with one proxy hop, but auth limiter at 5/15min will lock out shared-NAT coaching centers; key by IP+uid where authenticated.
- **`xlsx` 0.18.5 CVEs** (prototype pollution, ReDoS): replace (2.2).
- **No CSRF story** for the cookie-token path: the API accepts `req.cookies.token`; either drop cookie auth (header-only, SPA-friendly) or add SameSite=Strict + CSRF token. Recommendation: header-only, delete the cookie path.
- **Secrets:** `.env` files; move prod secrets to Google Secret Manager; rotate ENCRYPTION_KEY story (key-version prefix in ciphertext format, current format has no version field). The crypto error message telling users to "set it in the Settings menu" is wrong and confusing; fix message.
- **Logging PII:** pino-http logs full URLs; ensure no tokens in query strings (Google OAuth callback: verify), add redaction config for authorization headers.
- **Session management:** no server-side revocation; on role change or member removal call `revokeRefreshTokens(uid)` and check `auth_time` in rules-sensitive claims.

## 9.3 The RBAC matrix (target, enforced in rules + API)

| Collection | owner/admin | tutor | frontdesk | accountant | parent | student |
|---|---|---|---|---|---|---|
| students | CRUD | R (assigned), U (notes) | CR U(contact) | R | R (own children) | R (self) |
| invoices/payments | R + API mutations | R (own students) | record-cash via API | R + export | R (own) + pay | R (own) |
| wallets/ledger | R (mutate via API) | R | R | R | R (own) | R (own) |
| attendance | R (write via API) | write via API (own sessions) | write via API | R | R (children) | R (self) |
| sessions/templates | CRUD | CRUD (own) | CR | R | R (children's) | R (own) |
| leads | CRUD | R | CRUD | none | none | none |
| conversations/messages | participants only | participants | participants | none | participants | participants |
| audit_events | R | none | none | R (financial) | none | none |
| org settings/members | CRUD | R | R | R | none | none |

## 9.4 Compliance
- **DPDP Act 2023 (India) is the binding one:** consent for processing minors' data requires **verifiable parental consent**; build parent-consent capture into student onboarding (P1), a privacy policy (P0), data-deletion request handling (P1), and breach notification runbook (P2). Data residency: prefer asia-south Firestore region.
- GDPR: not launch-relevant (India-only) but the DPDP work covers 80 percent of it.
- FERPA: US-only, not applicable at launch; note it for expansion.
- SOC 2: premature; instead keep an evidence-friendly posture (audit logs, access reviews quarterly, secrets in SM, CI-enforced review) so Type I is a 3-month project when an enterprise deal demands it (P3).
- PCI: never touch card data; Razorpay hosted flows only.

---

# 10. API, DevOps, Observability

## 10.1 API standards
- `/api/v1`, JSON, errors as `{error: {code, message, details}}` with stable machine codes; Zod validation on every route (Zod is already a dependency, barely used); cursor pagination (`?cursor=&limit=`, max 100); idempotency-key header honored on all money mutations; OpenAPI spec generated from Zod schemas (`zod-openapi`) published at `/api/docs` (P1). Webhooks out (org-configurable) P3. No GraphQL, no public SDK until customers ask.

## 10.2 CI/CD (from zero)
GitHub repo (this folder is not even a git repo: `git init` is literally step one) → GitHub Actions: lint (eslint + tsc) → unit tests → rules tests (Firestore emulator) → build → deploy preview (staging) on PR merge → manual promote to prod. Deploy targets: Cloud Run (API, Docker), Firebase Hosting (SPA), `firebase deploy` for rules/indexes/functions. Rollback = redeploy previous Cloud Run revision + Hosting version (both are built-in one-click). Canary/blue-green: Cloud Run traffic splitting when there is traffic to split (P3).

## 10.3 Observability
- **Sentry** front + back (P0-adjacent: currently every error is a console.log in a browser you cannot see).
- Pino → Cloud Logging with request IDs propagated to client errors.
- Uptime checks on `/api/health` (extend it to actually check Firestore/Storage reachability) + alerting to your phone (Cloud Monitoring).
- Product analytics: PostHog (self-serve funnel: signup→first class→first attendance→first payment collected) (P1).
- Cost guardrails: Firestore budget alerts; the unbounded-listener fix (2.2) is also a cost fix.

## 10.4 Testing strategy (from zero)
- **Unit (Vitest):** billing math (proration, partial payments, paise arithmetic), conflict detection, recurrence expansion, aging buckets. Target: the money paths at ~90 percent.
- **Firestore rules tests (@firebase/rules-unit-testing):** one test per cell of the RBAC matrix, plus regression tests for C1-C5. This is the highest-value test suite in the product; write it before rewriting the rules so the rewrite has a spec.
- **API integration (Vitest + supertest + emulators):** money mutations, webhook idempotency, auth middleware.
- **E2E (Playwright):** five golden journeys: signup→org→first class; enroll→attend→invoice→pay (test gateway); fee reminder loop; parent portal pay; role permission denial spot-checks. Run on staging nightly and pre-release.
- **Load (k6):** attendance-marking burst (Monday 6pm at a 300-student center) and dashboard cold load; budget: p95 API < 400ms, Today interactive < 2s on a mid-range Android.
- Accessibility: axe-core in Playwright + manual keyboard pass per REDESIGN.md 14. Security: ZAP baseline scan in CI (P2) + one external pentest before charging money (P1, budget item).
- Manual: a 30-minute release smoke script documented in the repo.

---

# 11. Performance Plan

Ordered by measured impact:
1. `limit()` + date-bounds on every listener; Today needs this-week sessions, not all history (P0, hours of work).
2. Route-level code splitting + dynamic import of chart/PDF/XLSX libs (P1).
3. Pre-aggregated `org_stats_daily` for anything chart-shaped (P1).
4. List virtualization (tanstack-virtual) for rosters and ledgers >100 rows (P2).
5. Image/logo uploads through Storage with resize function (P2).
6. Bundle budget in CI (size-limit) to prevent regression (P2).
7. Memory-leak sweep: several components subscribe without cleanup on error paths; the Dashboard's four-listener merge also causes redundant re-renders; fixed by the TanStack refactor (P1).

---

# 12. AI Roadmap (post-core, honest scope)

Per REDESIGN.md 15, all AI ships inside the attention queue and palette. Sequencing with build notes:
1. **Deterministic "AI" first (no model, launch-ready):** absence streaks, aging fees, going-cold leads, schedule gaps are all rules. Ship these as the queue in Phase 1; they are 80 percent of the perceived intelligence at 0 percent of the cost.
2. **Morning brief (Claude API, P2):** summarize the queue + overnight events into three sentences. Grounded, cheap (Haiku-class model), high perceived value.
3. **Reply drafting in Inbox (P2):** context-anchored drafts, never auto-send.
4. **Fee-risk timing + retention prediction (P3):** needs 6+ months of payment/attendance history; do not fake it before the data exists.
5. **Palette answers over the ledger (P3):** natural-language → predefined query templates (not open SQL/no-SQL generation; keep it deterministic and safe).
6. Homework suggestion from document library (P3).
Guardrails: per-org AI toggle, no PII to model providers beyond what the feature needs, log prompts for debugging with retention limits, and every output shows its evidence.
Note: the `@google/genai` dependency is unwired; remove it and standardize on one provider abstraction when 2 ships.

---

# 13. Documentation Plan

Before launch (P0/P1): README replacement (real setup, emulators, envs), architecture doc (7.1 diagram + decisions), ER/schema doc (8.1), Firestore rules rationale + RBAC matrix, API reference (generated), deployment guide + rollback runbook, incident response one-pager (who, what, comms), backup/restore runbook (tested once, actually restore a staging copy), privacy policy + ToS (lawyer-reviewed, DPDP-aware), support macros for the top 10 predictable tickets, onboarding guide for centers (one page, Hindi + English), release smoke checklist.
Post-launch (P2): admin guide, help center articles per module, contributing/coding standards, DR plan with RTO/RPO targets (suggest RPO 24h via daily export, RTO 4h).

---

# 14. Launch Readiness Checklist (condensed gate list)

**Security gates:** C1-C5 fixed and rules-tested; money mutations server-only; pentest findings triaged; secrets in SM; Sentry live.
**Product gates:** the golden loop demo-able end to end on staging with a real UPI payment; attendance persists; real Meet links; WhatsApp reminder delivered; parent can pay on a phone.
**Engineering gates:** CI green with rules+unit+E2E suites; staging/prod separated; rollback rehearsed; backup restore rehearsed; load test passed at 5x expected launch volume.
**Legal/finance gates:** privacy policy, ToS, refund policy live; GST invoicing fields correct (CA-reviewed); Razorpay KYC live mode approved; company can actually receive money.
**Operations gates:** support inbox + phone/WhatsApp line staffed; super-admin org list + impersonation working; on-call = founder's phone with real alerts; status page (even a simple one).
**GTM gates:** pricing page truthful; onboarding under 30 minutes validated with 3 design-partner centers; 5 pilot centers committed; analytics funnel instrumented so week-1 activation is measurable.

---

# 15. Roadmap: phases with objectives, risks, exit criteria

Assumes 2 engineers + founder doing design/GTM. REDESIGN.md phases interleave (marked R#).

### Phase 1: Stop the bleeding (weeks 1-4)
Objectives: make the codebase safe and honest. `git init` + CI + Sentry + envs/emulators; fix C1-C5 with rules test suite; move attendance/wallet/invoice mutations server-side; persist attendance records; kill SQLite (migrate refresh tokens to Firestore encrypted, delete the rest); listener limits; delete dead deps and duplicate ui tree; R0 foundation (tokens, shell, palette skeleton).
Risks: rules rewrite breaks flows silently → mitigated by writing rules tests first.
Exit: emulator test suite green proving the RBAC matrix; no client can write money; attendance survives page reload; one `firebase deploy` + Cloud Run deploy pipeline works.

### Phase 2: Close the money loop (weeks 5-10)
Objectives: the wedge works end to end. Razorpay (links, webhooks, reconciliation, receipts); WhatsApp (template messages via Interakt/Gupshup/Twilio, DLT registration for SMS fallback started early, it takes weeks); invoice numbering + GST fields; batch invoice drafting/approval; real Meet links via Calendar API; parent mobile-web portal (children, invoices, pay); R1 Today + one-tap attendance.
Risks: WhatsApp template approval and DLT registration lead times (start week 5, day one); Razorpay live KYC.
Exit: a real parent pays a real ₹500 invoice from a WhatsApp link and the ledger reconciles itself; a tutor runs a full day from Today.

### Phase 3: Make it lovable (weeks 11-16)
Objectives: the product feels like REDESIGN.md. R2 Student Story + People + lead funnel; R3 Money surface; homework loop v1; announcements; CSV import; onboarding flow with demo data; i18n wrapping; notifications/Inbox v1.
Exit: parent-call prep under 10 seconds; month-end billing for 30 students under 10 minutes; a new center self-onboards in 30 minutes.

### Phase 4: Pilot hardening (weeks 17-20)
Objectives: 5 paying pilot centers on the product daily. Your-SaaS subscription billing + feature gating; super-admin tooling; audit log; exports; load test + perf items 1-4; external pentest; docs/legal package; R4 Schedule rebuild (drag calendar) lands here.
Exit: pilots renew at full price; all launch gates in section 14 green.

### Phase 5: Launch + listen (weeks 21-24)
Public launch to the metro segment; R5 mobile-web polish; referral loop (payment-link footer); weekly release cadence with the smoke script; begin AI 1-2 (queue is already rules-based; add the brief).
Success criteria: 25 paying orgs, week-4 retention >80 percent of activated orgs, >₹10L monthly fee volume collected through the platform (the number that proves the wedge).

### Months 7-12 (directional)
Attendance/fee automation depth (auto-reminders with escalation), progress report PDFs, reports v2, Typesense search, FCM push, payroll v1, branch role, AI 3-5, SOC-2-friendly posture work, second locale (Hindi), and evaluate native app demand against mobile-web analytics rather than assumption.

---

# 16. Final Recommendations

1. **Refuse to build features until Phase 1 and 2 are done.** Every one of the four Critical vulns and the open money loop compounds with each new customer and each new module. The discipline to fix foundations first is the difference between a product and an incident.
2. **Let Firestore win.** The dual-store design is the root of half the audit findings. One data model, server-authoritative money, realtime for free.
3. **Sell the wedge, not the suite.** "We collect your fees" is a rupee-denominated promise competitors don't make and the codebase's class-type engine uniquely supports. Feature breadth comes later, financed by that wedge.
4. **The parent is the growth engine.** Every WhatsApp payment link and every polished parent portal touch is marketing to a parent who knows three other centers. Invest in the parent-facing 20 percent disproportionately.
5. **Write the rules tests before the rules.** The RBAC matrix in 9.3 is the product's real constitution; encoding it as an executable spec is the single highest-leverage engineering artifact this project can have.
6. **"Better than every product available" is winnable only on experience and the money loop, not on checklists.** Teachmint will always have more features. Nobody in this market has Linear-grade speed, a Student Story, or a self-reconciling fee ledger. That is the game; REDESIGN.md and this blueprint together are the playbook.
