# ClassStackr Reimagined
## A ground-up product redesign proposal

*Prepared against the actual codebase in this repository, not the marketing description. Every criticism below is traceable to real code.*

---

## 0. The honest diagnosis

Before the vision, the verdict. This product is a competent database with a UI stapled to it. It is not yet software anyone would choose to live in for 8 hours a day. Evidence from the code:

- **The global search box does nothing.** `Layout.tsx` renders an input with a placeholder ("Search students, invoices...") that has no state, no handler, no results. It is decoration pretending to be a feature. This is the single most damning artifact in the codebase: it looks like software instead of being software.
- **Core flows run through `alert()` and `window.confirm()`.** Calendar errors, "no gaps found," and lead deletion all use browser-native dialogs. No product in the reference class (Linear, Stripe, Notion) has shipped a `window.confirm` in a decade.
- **StudentProfile.tsx is 1,289 lines with 31 `useState` hooks and five tabs.** It is a filing cabinet, not a profile. The user must know which drawer contains the answer before they can ask the question.
- **The Leads "pipeline" is a Kanban board where you move cards with a `<select>` dropdown.** It has the visual metaphor of drag-and-drop with none of the interaction. Worse than either a real board or a plain list.
- **The dashboard shows dollar signs in a product whose entire pricing model is denominated in rupees.** (`$${value}` in the revenue chart, `$` on pending invoices.) Nobody who uses this product pays in dollars.
- **Three primary buttons in three different colors** (indigo, green, orange) sit side by side in the dashboard header, under a title that reads "Business Pulse & Actions." That title is AI-generated copy. No human PM names a page that.
- **The student sidebar has 11 items**, including Wallet and Transactions as separate pages, Timetable and Bookings as separate pages, and Profile, Preferences, and Settings as three different destinations. This is the database schema leaking into the navigation.
- **"Quick Add" is a button that navigates to the Students page.** Quick Add that is neither quick nor an add.
- **Hover effects lift cards with `-translate-y-1` and slide nav items with `translate-x-1`.** These are the tells of AI-generated Tailwind: motion applied because it is available, not because it means anything.
- **Duplicate component libraries.** `/components/ui` and `/src/components/ui` both exist with overlapping files (tabs, button). Dead weight.

None of these are cosmetic complaints. Each one is a symptom of the same root cause: **the product was assembled entity-by-entity (students table, invoices table, messages table) instead of workflow-by-workflow (run today's classes, chase this month's money, keep parents in the loop).** The redesign below fixes the root cause, not the symptoms.

---

## 1. Product vision

**ClassStackr becomes the tutor's second brain: a calm, single-surface workspace where the day runs itself and money never falls through the cracks.**

The one-sentence positioning: *Linear for tuition centers.* Fast, keyboard-first, opinionated, and organized around what happens next rather than what is stored where.

Three promises, in priority order:

1. **You always know what's next.** The product's home is today, not a statistics page.
2. **Nothing slips.** Unpaid invoices, absent streaks, unanswered parents, and unconfirmed sessions surface themselves before the user thinks to look.
3. **Every record tells a story.** A student is not five tabs of tables; a student is a timeline you can scroll.

What ClassStackr is not: a generic school ERP, an accounting package, or an analytics product. Reports exist to trigger action, not admiration.

---

## 2. Design philosophy

Five principles, each with a hard rule that makes it enforceable:

1. **Time is the primary axis.** Tutoring is a time business: sessions, due dates, streaks, terms. Every major surface (Today, Student Story, Money, Pipeline) is organized chronologically or by urgency, never alphabetically by default. *Rule: no screen whose default sort is "created date descending" ships.*

2. **The next action is always one keystroke away.** Command palette (`Cmd+K`) is the primary navigation. Every entity row has inline actions. *Rule: any action reachable through 3+ clicks must also be reachable through the palette.*

3. **Calm by default, loud by exception.** The interface is quiet monochrome. Color is reserved exclusively for state that demands action: overdue, conflict, at-risk, unread. *Rule: no more than one accent color per viewport unless something is actually wrong.*

4. **Workflows over entities.** Screens are named for jobs (Today, People, Schedule, Money, Inbox), never for tables (Sessions, Enrollments, Transactions). *Rule: if a page name matches a database collection name, rename the page.*

5. **Undo, never confirm.** Destructive and semi-destructive actions execute optimistically with a 5-second undo toast. *Rule: `window.confirm` count in the codebase must be zero. Reserved modal confirmation only for genuinely unrecoverable actions (deleting an organization).*

---

## 3. Information architecture

The current IA has ~17 tutor-facing and student-facing routes mapped one-to-one onto Firestore collections. The new IA collapses this to **five workspaces plus settings**, shared across roles with role-appropriate content:

```
ClassStackr
├── Today          ← home; the operational cockpit
├── Schedule       ← calendar, availability, templates, conflicts
├── People         ← students, parents, tutors, leads (one directory, four lenses)
│   └── Student Story (the living timeline; absorbs profile, progress,
│       documents, homework, attendance, grades, notes)
├── Money          ← invoices, wallets, payments, revenue (absorbs
│       Invoices, Wallet, Transactions, revenue reports)
├── Inbox          ← messages, notifications, approvals, homework
│       submissions (one triage surface, threaded by context)
└── Settings       ← org, profile, availability, billing rules,
        integrations, preferences (one page, sectioned; absorbs
        Profile + Preferences + Settings)
```

Key IA decisions and why:

- **Leads live inside People, not as a sibling of Students.** A lead is a student who has not started yet. Conversion should be a state change, not a copy-paste between modules. This kills an entire nav item and an entire class of data duplication.
- **Wallet, Transactions, and Invoices merge into Money.** They are three views of one ledger. Parents see their side; tutors see theirs; admins see the org. Same surface, filtered by role.
- **Notifications and Messaging merge into Inbox.** Both are "things that arrived while you were teaching." A notification you cannot act on from where you read it is a bug.
- **Timetable and Bookings (student side) merge into Schedule.** A student's timetable is the calendar filtered to them.
- **Documents dissolves as a top-level destination.** Files attach to students, sessions, and homework. A global file drawer remains reachable via palette for the rare "where is that PDF" moment.
- **Programs → Courses → Class Templates → Sessions (the 4-tier hierarchy) stays in the data model but disappears from navigation.** Tutors think "my Monday batch," not "Level 3 template instance." The hierarchy surfaces only inside the class creation wizard and admin catalog settings.

---

## 4. Navigation redesign

**Kill the current sidebar-as-table-of-contents. Replace with three layers:**

1. **A slim icon rail (56px)** with exactly five workspaces + settings. Labels on hover, badge dots for Inbox and Today attention counts. Collapsible to zero on small screens. This is the Linear/Arc pattern: navigation as furniture, not as a page.

2. **Command palette as the real navigation** (`Cmd+K`). It must do all of:
   - Jump: "riya" → Riya's Story. "march invoices" → Money filtered.
   - Act: "invoice riya," "cancel today's 5pm," "mark attendance," "message class 10 batch."
   - Create: "new student," "new session tomorrow 4pm with Arjun."
   - Answer: "how much is outstanding?" returns the number inline, with a link.
   The palette is also the fix for the fake search box: the topbar search input becomes a real palette trigger.

3. **Contextual secondary navigation inside each workspace.** Money has segments (Outstanding / Paid / Wallets / Insights); People has lenses (Students / Leads / Parents / Tutors). These are view switches within a surface, not routes in a tree.

**Role adaptation:** the rail renders per role. Students get Today / Schedule / Learn / Money / Inbox. Parents get Today / Children / Money / Inbox. Same mental model, fewer rooms. The current 11-item student sidebar becomes 5.

---

## 5. Dashboard redesign: "Today"

Delete the dashboard. The concept of "dashboard" (KPI cards + charts) is the wrong genre for an operator who is about to teach in 20 minutes. Replace with **Today**, built as three zones:

**Zone 1: The Line (top, full width).** A horizontal timeline of today's sessions, now-cursor moving through it. Each session block shows students, mode (online/in-person), and a one-click Join / Mark Attendance action that changes state as time passes: before class it says "Join," during class it says "Mark attendance," after class it says "3 unmarked" until resolved. Attendance debt is visible until paid.

**Zone 2: Needs Attention (left column).** Not statistics; a ranked queue of items, each a sentence with an inline action:
- "₹4,500 overdue from 3 parents · 12 days oldest" → [Send reminders]
- "Aarav has missed 3 sessions in a row" → [Message parent] [View story]
- "Tomorrow 5pm: two sessions overlap for you" → [Resolve]
- "2 homework submissions waiting for review" → [Review]
- "Lead 'Mrs. Sharma' has gone quiet for 6 days" → [Follow up]
Every item is dismissible ("snooze until Friday"). An empty queue renders a genuinely rewarding empty state: "All clear. Next class at 4:00 pm."

**Zone 3: The Pulse (right column, deliberately small).** Three numbers, no charts: collected this month (₹), outstanding (₹), sessions this week vs. last. Each links into Money or Schedule. The revenue bar chart moves to Money → Insights where analysis, not glancing, happens.

Why this is better: the current dashboard answers "how is my business doing?" which the tutor asks monthly. Today answers "what do I do right now?" which they ask hourly. Zone 2 is also the natural home for the AI features in section 15: the queue is the delivery mechanism.

For admins, Today swaps Zone 1 for a center-wide view: all tutors' timelines stacked (a staff utilization strip), and Zone 3 gains org revenue.

---

## 6. Every page, redesigned

### 6.1 Schedule (replaces Calendar, Timetable, Bookings, availability settings)

The current Calendar page is a month grid with 24 pieces of state, `alert()` error handling, and a modal wizard. Rebuild:

- **Week view is the default** (tutors plan in weeks; the month grid is for density scanning only). Day / Week / Month via `1 / 2 / 3` keys.
- **Real drag interactions:** drag empty space to create, drag blocks to move, drag edges to resize. On drop, a conflict check runs before commit; a conflicting drop snaps back with the conflicting session ghost-highlighted, never an alert.
- **Availability as a first-class overlay:** the tutor's working hours render as the light region; outside hours is visibly dimmed. Booking against a dimmed region asks once: "Outside your hours. Book anyway?"
- **Recurring series done honestly:** editing a recurring session always asks scope (this one / this and future / all) inline in the popover, Google Calendar style. The current code generates 3 months of session documents on creation; the redesign treats the template as the source of truth and materializes sessions rolling forward, so "change my Monday batch to Tuesdays" is one edit, not ninety.
- **The class creation wizard shrinks to one popover:** pick from the service catalog (templates carry type, price, capacity, duration), pick students (capacity meter fills as you add), pick slots. Three fields because the template did the work up front. This is the payoff of the Class-Type architecture, which is genuinely good and currently buried.
- **"Find a gap" becomes real:** currently it alerts "No gaps found in the next 14 days." Instead: a slot picker that shows the next 10 open slots matching the template's duration inside availability, click to book.

### 6.2 People (replaces Students, Leads, tutor management in Admin)

One directory, four lenses (Students / Leads / Parents / Tutors), one row schema: avatar, name, one status chip, one "last activity" sentence, inline actions on hover (message, schedule, invoice, open).

- The Students lens defaults to **sorted by "needs attention"** (overdue fees, attendance anomalies, stale contact), not alphabetically. Alphabetical is one keystroke away; urgency is the default because urgency is the job.
- **Leads: kill the Kanban.** (The current one moves cards via dropdown anyway.) Replace with a **conversion funnel strip + focus list**: a horizontal funnel (Inquiry 12 → Trial booked 5 → Trial done 4 → Enrolled 2) where clicking a stage filters the list below. The list is sorted by "going cold" (time since last touch), because for a 2-person tuition center the pipeline problem is not visualizing 200 cards, it is remembering to call Mrs. Sharma back. Each lead row: source, interest, last touch, next action with a due date. Converting a lead = one action that creates the student, carries over notes and contact info, and opens enrollment.
- **Bulk actions** on multi-select: message, invoice, export.

### 6.3 Student Story (replaces the 1,289-line, 5-tab StudentProfile)

The centerpiece of the redesign. One scrollable, reverse-chronological timeline that interleaves everything: sessions (with attendance state), homework assigned/submitted/graded, files, invoices and payments, messages, notes, milestones ("finished Trigonometry," "50th session").

- **A pinned header** carries the always-true facts: name, batch(es), parent contact (tap to call/message), wallet balance, outstanding amount, attendance rate. The header is the profile; everything else is history.
- **Filter chips** (Sessions / Homework / Money / Messages / Notes) narrow the stream; they replace the tabs. The difference matters: tabs hide four-fifths of the story at all times; filters start from the whole story and let you focus.
- **Inline composition:** add a note, assign homework, or record a payment directly into the timeline from a persistent composer at the top. No modals for the common cases.
- **The parent view is the same component, permission-filtered.** Parents see the story minus private tutor notes. This single decision replaces the separate student-portal pages (AcademicProgress, StudyMaterial) with filtered lenses of one artifact and guarantees the parent never sees a stale, different version of the truth.

Why a timeline: the question a tutor actually asks before a parent call is "what has been going on with this kid?" That is a narrative question. Five tabs make the user assemble the narrative; the timeline is the narrative.

### 6.4 Money (replaces Invoices, Wallet, Transactions, BillingInvoiceSettings sprawl)

Billing is the highest-stakes surface and currently the most fragmented. Rebuild around one ledger with four segments:

- **Outstanding (default):** invoices grouped by payer, aged (0–7 / 8–30 / 30+ days with escalating visual temperature), each row with [Remind] [Record payment] [View]. A sticky footer totals the selection: select six rows, see "₹27,300 across 6 invoices," one click sends six reminders.
- **Recording a payment is a two-field inline popover** (amount prefilled, method), not a page. Optimistic update, undoable.
- **Wallets:** balance list with projected depletion ("Riya's balance covers 3 more sessions") and threshold alerts that feed the Today queue.
- **Invoice as a document:** the invoice detail looks like the beautiful PDF it will become (the JSON-archival engine already supports this), with an activity trail (sent → viewed → reminded → paid) borrowed from Stripe's receipt timeline.
- **Insights:** revenue trend, collection rate, revenue by class type, forecast. This is where the dashboard's chart moves, joined by the questions that matter: "Which class type earns the most per hour of my time?"
- **Everything in ₹, everywhere, formatted in the Indian system (₹1,23,450).** The current `$` formatting is not a detail; it is proof nobody using the product looked at it.

### 6.5 Inbox (replaces Messaging + Notifications)

- **Threads are contextual by design:** every conversation can be anchored to a student, session, invoice, or homework item, and the anchor renders as a context card at the top of the thread ("About: Invoice #142 · ₹3,000 · overdue 6 days" with [Record payment] inline). A parent asking "did Riya attend today?" is answered without leaving the thread because the thread knows who Riya is.
- **Class channels:** each batch gets a broadcast channel (the deck's "3-click broadcast" flow survives, now 2 clicks).
- **Notifications become inbox items** with inline actions, not a dead-end list page. Anything you cannot act on from the notification is a design failure.
- **Triage affordances:** unread-first, archive on `E`, snooze, and a "waiting for reply" state so a tutor can see which parents never answered.

### 6.6 Settings (merges Settings + Profile + Preferences + org/billing/availability components)

One page, left-anchored section list (Workspace / Profile / Availability / Billing rules / Integrations / Notifications / Members). Searchable via palette ("change my UPI id" jumps straight to the field). Availability editing gets the same drag interaction as Schedule; it is the same concept and must feel like it.

### 6.7 Onboarding

The current onboarding is a 399-line form sequence. Replace with a **conversational, three-beat setup**: (1) solo tutor or center? (2) create your first class from a template gallery ("Class 10 Maths batch, Mon/Wed/Fri" pre-filled), (3) add two students or import a CSV/contacts. The goal: a booked session on the calendar within 3 minutes, because a calendar with one real class is the "aha," not a completed profile.

### 6.8 Public site

Out of scope for deep treatment here, but the public pages (Home, Features, Pricing, FindTutors) should adopt the same type scale and color system so the product does not change personality at the login wall. FindTutors is a marketplace feature that dilutes the SaaS positioning; recommend cutting it entirely (see section 18).

---

## 7. User journeys, before and after

**Morning open (tutor).** Before: Dashboard shows 3 KPI cards and a revenue chart; tutor clicks into Calendar, then Students, then Messaging to assemble the day. After: Today shows the timeline, the attention queue, and unread count. Zero navigation to reach a fully-briefed state.

**"Did Aarav's mother pay?"** Before: Invoices page → search → filter by student → read table. After: `Cmd+K` "aarav" → Story header shows outstanding ₹0 or the aged amount, with the payment event visible in the timeline. Five seconds.

**Marking attendance.** Before: Sidebar → Calendar → find session → popover → checkboxes → confirm (the "3-click rule" that is really six). After: the Today timeline block says "Mark attendance" the moment class ends; one click opens the roster inline; names toggle with single taps; auto-saves. Unmarked sessions chase the tutor, not the reverse.

**Chasing fees.** Before: read table, open WhatsApp, type message, repeat per parent. After: Money → Outstanding → select all 30+ day rows → [Send reminders] → templated, personalized messages go out through Inbox; each invoice's activity trail records it.

**Lead follow-up.** Before: remember the Kanban exists, open it, read cards. After: the lead surfaces in the Today queue on day 4 of silence with a [Follow up] action that opens a prefilled message.

---

## 8. Workflow improvements

- **Attendance debt:** unmarked past sessions accumulate as a visible counter on Today and block nothing but nag gently. Attendance drives billing for per-session models, so this is a revenue-integrity feature, not a discipline feature.
- **Invoice generation becomes a review, not a chore:** on the 1st, the system drafts all monthly invoices from templates and enrollments; the tutor reviews a single "Approve batch (₹52,000 across 18 invoices)" screen. Per-session invoices accrue automatically from attendance (the atomic attendance-plus-wallet transaction already in ClassManager supports this).
- **Trial-to-enrollment is one flow:** lead → book trial (a real session on the calendar, tagged trial) → after the session, the Today queue asks "How did Riya's trial go?" → [Enroll] [Follow up] [Close lost]. The CRM updates itself as a side effect of teaching.
- **Session cancellation handles money:** cancelling a per-session class offers credit-back / reschedule / charge-anyway in the same popover, because the wallet consequence is the actual decision.
- **Everything optimistic, everything undoable.**

---

## 9. UX improvements (systemic)

- Replace all `alert()` / `window.confirm()` with toasts (undo) and inline popovers.
- Real empty states everywhere: what this is, why it is empty, one primary action, one example artifact ("See a sample invoice").
- Loading: skeletons that match final layout; no spinners for sub-300ms operations; the current full-page `LoadingSpinner message="Loading dashboard..."` pattern dies.
- Inline validation at the field, on blur, in plain language ("End time is before start time").
- Every list: keyboard navigable (`↑↓` move, `Enter` open, `E` archive, `X` select).
- Dates rendered relationally ("today, 5:00 pm," "in 2 days," "12 days overdue") with absolute dates on hover.
- Session timezone honesty: online tutoring crosses timezones; render the student's local time in tooltips.

---

## 10. Interaction patterns

A small, fixed vocabulary used everywhere, so the product feels like one hand made it:

1. **Popover-first editing.** Click a value, edit in place. Modals only for multi-step creation (new class wizard).
2. **Hover reveals, selection persists.** Row actions appear on hover (desktop) and via long-press (mobile); multi-select via checkbox on hover or `X`.
3. **Drag with physics honesty.** Draggables lift 2px with a soft shadow on grab; invalid drops snap back with the reason ghosted; valid drops settle with a 120ms ease-out.
4. **The 5-second undo toast** as the universal safety net.
5. **`Cmd+K` for everything; `/` focuses list filter; `?` shows the shortcut map.** New-item shortcuts: `C` new class, `S` new student, `I` new invoice, `M` new message, from anywhere.
6. **Counting selections in a sticky action bar** (Gmail pattern) for all bulk operations.

---

## 11. Component library recommendations

Keep the Tailwind + shadcn/ui base (it is the right choice) but govern it:

- **Delete the duplicate `/components/ui` directory**; one source of truth in `src/components/ui`.
- Adopt from shadcn/Radix: `Command` (palette), `Popover`, `Toast`/`sonner`, `Sheet` (mobile), `Dialog` (rare), `Tabs`, `Avatar`, `DropdownMenu`, `Tooltip`, `Skeleton`.
- Add: `@dnd-kit` for calendar and list drag; `date-fns` (already present) with a single `formatRelative` util so date rendering is centralized; `recharts` stays but only inside Money → Insights, with a custom sparkline component for inline trends.
- Build as product components (not per-page code): `TimelineItem`, `AttentionCard`, `SessionBlock`, `PersonRow`, `MoneyRow`, `AgedBadge`, `CapacityMeter`, `EmptyState`, `UndoToast`, `ContextCard` (inbox anchors), `StatChip`.
- Enforce via a single `tokens.css`: no raw hex, no arbitrary Tailwind values (`w-[137px]`) in pages.

---

## 12. Motion principles

- **Durations:** 120ms micro (hover, toggle), 180ms structural (popover, row expand), 240ms spatial (panel slide, palette). Nothing over 300ms, ever.
- **Easing:** ease-out for entrances, ease-in for exits, spring only for drag settle.
- **Motion must mean something:** things animate to show where they went (a marked-attendance session block settles into its "done" state; a paid invoice row slides to Paid). The current hover `-translate-y-1` card lift and `translate-x-1` nav slide are motion as garnish; both die.
- **The now-cursor on Today's timeline moves in real time.** One piece of ambient motion that makes the product feel alive; everything else stays still.
- `prefers-reduced-motion` collapses everything to opacity fades.

---

## 13. Visual language

- **Type:** Inter (UI) with `tabular-nums` for every number. Scale: 12 / 13 / 14 (body) / 16 / 20 / 28. Two weights: 450 and 600. The current soup of `text-2xl font-bold` page titles becomes a single 20/600 page header.
- **Color:** near-monochrome slate base (background `#FAFAF9`, surface white, borders `#E7E5E4`, text `#1C1917` / `#78716C`). One brand accent (a deep indigo, kept from the current identity but used at perhaps 5% of current frequency: focused states, primary buttons, links). Semantic trio used only for state: amber (aging/at-risk), red (overdue/conflict), green (paid/present). Full dark theme from day one; tutors teach evenings.
- **Space:** 4px base grid; 8/12/16/24 as the only gaps; page gutter 24px; **card padding 16px, down from the current 24px**, because information density is a feature for an 8-hour tool.
- **Depth:** borders and background shifts, not shadows. Shadows only on floating elements (popover, palette, drag lift). The current `shadow-sm hover:shadow-md` card treatment goes.
- **Radius:** 6px controls, 10px containers, full only on avatars and status dots.
- **Iconography:** lucide stays, one size (16px) inline and one (18px) in the rail, `stroke-width: 1.75` everywhere.
- **Numbers and money:** ₹ everywhere, Indian digit grouping, negative amounts in red only inside Money.

---

## 14. Accessibility improvements

- Full keyboard operability of every workflow (the palette gets this 80% free; drag interactions all get keyboard equivalents: select session, `Cmd+arrows` to move).
- Visible 2px focus rings on the accent color; never `focus:outline-none` without replacement (the current Layout does exactly this on the role switcher).
- WCAG AA contrast minimums enforced in tokens; the current gray-400 icon-on-white fails and gets darkened.
- Color never the sole carrier: overdue = red + "12d overdue" text + icon; attendance states get glyphs, not just fill.
- `aria-live` polite regions for toasts and optimistic updates; palette and popovers with correct focus traps and `Esc` behavior (Radix provides this; use it, do not rebuild it).
- Touch targets ≥ 44px on mobile; the timeline and attendance toggles designed thumb-first.
- Language: `lang` attributes and font fallbacks ready for Devanagari names; test every layout with long Indian names ("Lakshminarasimhan Venkatasubramanian") because truncation strategy is an a11y and dignity issue.

---

## 15. AI-native experiences

All AI ships through two honest surfaces: the Today attention queue and the palette. No chatbot bolted to the corner.

1. **Morning brief (queue, daily):** "3 classes today. Riya's batch has a test scheduled. ₹4,500 became overdue overnight. Aarav's parent replied late last night." One paragraph, sourced from real events, every claim linked.
2. **Attendance anomalies:** streak and pattern detection ("Sana has missed the last 3 Wednesdays specifically") with a suggested action, not just a flag.
3. **Fee-risk scoring:** payers ranked by historical payment latency; the reminder scheduler adapts ("this parent pays on the 7th; remind on the 5th").
4. **Schedule optimization:** "You have a 90-minute gap Tuesdays; two drop-in students match that slot" and "Moving Thursday 7pm batch to 6pm would free your only evening."
5. **Reply drafting in Inbox:** drafts grounded in the thread's context anchor (attendance record, invoice state), always shown as an editable draft, never auto-sent.
6. **Homework suggestions:** given the course topic and the student's recent grades, propose the next worksheet from the document library.
7. **Palette answers:** "how much did I earn from crash courses this quarter?" resolved against the ledger with the number and a link to the filtered view.
8. **Revenue forecast in Money → Insights:** enrollment-and-history-based projection with visible assumptions, editable ("assume 2 batch students churn").

Guardrails: every AI item shows its evidence, every suggestion is dismissible and snoozable, nothing sends or spends without a human click, and the queue learns from dismissals.

---

## 16. Mobile strategy

Mobile is not the desktop shrunk; it is the **between-classes companion**. Jobs ranked: (1) see what's next and join it, (2) mark attendance, (3) triage Inbox, (4) record a cash payment / send a fee reminder, (5) quick-add a lead after a phone call. That is the whole phone app.

- **Bottom tab bar:** Today / Schedule / Inbox / More. People and Money live behind More and search; nobody does roster administration on a phone.
- **Today on mobile is a vertical agenda** with swipe actions: swipe a past session right to mark all present (then tap exceptions), left to open the roster. Attendance in under 10 seconds while walking between rooms.
- **Record payment** as a bottom-sheet: student, amount (prefilled from outstanding), method, done. Built for the parent who hands over cash at pickup.
- **Push notifications deep-link to actionable sheets**, not to pages.
- Desktop-only, by design: calendar drag-editing, batch invoice approval, reports, settings, CSV import, template management.
- Parent/student mobile experience is the priority mobile audience (they check schedules and pay); their web app must be flawless at 375px before any tutor-side native work.

---

## 17. Future scalability

- **Multi-branch:** the org → branch → tutor hierarchy slots into the People and Schedule filters without new IA; Today's admin view gains a branch switcher. Because navigation is workspace-based rather than entity-based, adding a tier does not add nav items.
- **Payments:** the Money surface is designed around a ledger, so adding Razorpay/UPI collection later changes row actions ([Collect via UPI]) without changing the surface.
- **White-labeling for centers:** the token system (section 13) makes theming a data problem, not a redesign.
- **Offline-tolerant mobile:** attendance marking queues locally and syncs; tuition centers have bad Wi-Fi.
- **The dual-store architecture (Firestore + SQLite) stays backend-internal;** the redesign deliberately never exposes which store owns what, and the sync layer's latency characteristics push toward optimistic UI everywhere, which section 8 already mandates.

---

## 18. Features to remove

| Feature | Why it dies |
|---|---|
| FindTutors public marketplace | A second business model hiding inside the first. Dilutes positioning, invites moderation burden, serves nobody yet. |
| Standalone Documents page | Files belong to students, sessions, and homework. A global drawer via palette covers the rest. |
| Standalone Notifications page | Dead-end list; becomes Inbox items with actions. |
| Separate Wallet + Transactions pages | Two pages for one ledger; both become Money segments. |
| Profile / Preferences / Settings as three destinations | One Settings surface, sectioned. |
| The Kanban lead board | Replaced by funnel + focus list (6.2). |
| KPI card row on the dashboard | Replaced by the Pulse (three linked numbers) and the attention queue. |
| Fake global search input | Replaced by the real palette. |
| Duplicate `/components/ui` tree | Dead code. |
| `alert()` / `window.confirm()` (5 call sites) | Toasts, popovers, undo. |
| Hover translate gimmicks | Motion with meaning only. |

## 19. Features to merge

- Students + Leads + Parents + Tutors → **People** (four lenses, one directory).
- Invoices + Wallet + Transactions + revenue chart → **Money**.
- Messaging + Notifications → **Inbox**.
- Calendar + Timetable + Bookings + availability settings → **Schedule**.
- StudentProfile's five tabs + AcademicProgress + StudyMaterial → **Student Story** (one timeline, filter chips, permission-lensed for parents/students).
- Onboarding + RoleSelection → one adaptive first-run flow.

## 20. Features to simplify

- **Class creation:** the 4-tier hierarchy stays in data, disappears from UX; creation = template + students + slots in one popover.
- **Recurring sessions:** template as source of truth with rolling materialization, replacing 3-months-of-documents generation.
- **Invoice creation:** from "fill a form per invoice" to "approve the drafted batch."
- **Attendance:** from calendar-popover-checkbox-confirm to one-tap from Today, with all-present default and exception taps.
- **Role switching:** the portal dropdown stays but the shared IA means switching roles changes content, not mental model.

## 21. Features to add

Ranked by leverage:

1. Command palette (navigation, actions, answers).
2. Today with the attention queue (the retention feature).
3. Student Story timeline (the demo feature; this is the screen that sells).
4. Undo system + optimistic writes (the trust feature).
5. Fee reminder engine with aging, batching, and templates.
6. Trial-session flow with post-trial prompt (converts the CRM from record-keeping to revenue).
7. Attendance debt tracking.
8. Class broadcast channels.
9. AI morning brief + anomaly detection (after the queue exists to host it).
10. Payment-collection integration (UPI links on invoices), when payments strategy is decided.

## 22. Screens to rebuild completely (do not refactor, rewrite)

1. **Dashboard → Today.** Nothing survives except the upcoming-classes data query.
2. **StudentProfile → Student Story.** The 1,289-line component is unsalvageable as architecture; its data fetching is reusable.
3. **Calendar → Schedule.** The month grid and modal wizard go; conflict-check server logic stays.
4. **Leads → People/Pipeline lens.** Board dies; lead schema mostly survives with added `lastTouchedAt` / `nextActionAt`.
5. **Messaging → Inbox.** Thread list survives conceptually; context anchors are new schema.
6. **Layout.tsx → rail + palette shell.** Total rewrite; it is also where the fake search lives.
7. **Invoices → Money.** Table becomes aged, grouped, bulk-actionable ledger.

Salvageable with restyling: Settings sections, Login, Onboarding steps (content, not flow), public pages.

---

## 23. Phased implementation roadmap

**Phase 0 · Foundation (2–3 weeks).** Design tokens, type scale, color system, dark theme plumbing; delete duplicate ui tree; install Command/Popover/Toast/dnd-kit primitives; build the shell (rail + palette + topbar) with old pages mounted inside it; centralized date/₹ formatting utils (this alone fixes the $ bug everywhere); kill all alert/confirm call sites. *Exit criterion: the app looks and feels different before any workflow has changed.*

**Phase 1 · Today + attendance (3–4 weeks).** The timeline, the attention queue (rule-based items only: overdue, unmarked, conflicts, quiet leads), one-tap attendance with undo, the Pulse. *Exit: a tutor can run a full teaching day without opening any other workspace.*

**Phase 2 · Student Story + People (4 weeks).** The timeline component, pinned header, filter chips, inline note/homework/payment composers; the People directory with lenses; lead list + funnel strip + convert flow; retire StudentProfile, Students, Leads. *Exit: the parent-call prep journey (section 7) takes under 10 seconds.*

**Phase 3 · Money (3–4 weeks).** Ledger with aging, bulk reminders, inline payment recording, batch invoice approval, wallets with depletion projection, Insights (charts move here); retire Invoices/Wallet/Transactions. *Exit: month-end billing for 30 students takes under 10 minutes.*

**Phase 4 · Schedule (4 weeks).** Week-view calendar with drag create/move/resize, availability overlay, honest recurring edits, slot finder, template-driven creation popover; retire Calendar/Timetable/Bookings. *Exit: rescheduling a recurring batch is a 15-second, alert-free operation.*

**Phase 5 · Inbox + mobile web (3 weeks).** Threads with context anchors, class channels, notification absorption, triage keys; responsive pass making Today/attendance/Inbox/record-payment excellent at 375px; bottom tab bar. *Exit: a tutor can leave the laptop at home on a light day.*

**Phase 6 · Intelligence (ongoing).** Morning brief, anomalies, fee-risk timing, palette answers, reply drafts, forecast. Each ships as a new item type in surfaces that already exist, which is the point of building the queue first.

Sequencing logic: value order matches dependency order. Today is first because it is the retention surface and the host for everything later; Money before Schedule because billing pain is acute and calendar rebuild is the riskiest engineering; AI last because AI delivered through a bad surface reads as a gimmick, and through a good one reads as magic.

---

## Closing argument

The backend already understands this business: class types with their own billing physics, atomic attendance-to-wallet transactions, JSON-archived invoices, real conflict detection. The frontend currently betrays that understanding by presenting the database instead of the job. The redesign above is, in one sentence, the decision to organize every pixel around three questions the current product never asks: **what is happening now, what needs me, and what happens next.** Answer those on every screen and ClassStackr stops feeling generated and starts feeling designed.
