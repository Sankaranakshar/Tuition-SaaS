// Pure derivations for the Today workspace (DEV_PLAN Epic 9). No React, no
// Firestore reads — every function takes plain data plus an explicit `now`, so
// the whole workspace is unit-testable and the clock is injectable. The page
// (src/pages/Today.tsx) is the only place these get wired to live listeners.

// ---- Shapes (loose; Firestore docs carry extra fields we ignore) -----------

export interface TodaySession {
  id: string;
  organizationId?: string;
  tutorId?: string;
  templateId?: string;
  studentIds?: string[];
  startTime: string; // ISO
  endTime: string; // ISO
  status?: "scheduled" | "completed" | "cancelled" | "no_show";
  isOnline?: boolean;
  meetingLink?: string;
  roomNumber?: string;
  attendanceMarkedAt?: unknown;
}

export interface TodayInvoice {
  id: string;
  studentId?: string;
  status?: string;
  dueDate?: string; // YYYY-MM-DD
  totalPaise?: number;
  paidPaise?: number;
  totalAmount?: number; // legacy rupee float
  amount?: number; // legacy rupee float
  createdAt?: string | { toDate?: () => Date };
  lastPaymentAt?: string | { toDate?: () => Date };
}

export interface TodayLead {
  id: string;
  name?: string;
  status?: string;
  updatedAt?: string;
  createdAt?: string;
}

export interface TodayStudent {
  id: string;
  name?: string;
  tutorId?: string;
  parentName?: string;
  parentPhone?: string;
  phone?: string;
}

export interface TodayAttendance {
  studentId: string;
  status: "present" | "absent" | "late" | "excused";
  sessionStart?: string | { toDate?: () => Date };
  sessionId?: string;
}

// ---- Session state machine (E9.1) ------------------------------------------

export type SessionPhase = "upcoming" | "live" | "unmarked" | "done" | "cancelled";

/** The state-aware phase that drives each block's action (Join → Mark → done). */
export function sessionPhase(s: TodaySession, now: Date): SessionPhase {
  if (s.status === "cancelled") return "cancelled";
  if (s.status === "completed" || s.attendanceMarkedAt) return "done";
  const start = new Date(s.startTime).getTime();
  const end = new Date(s.endTime).getTime();
  const t = now.getTime();
  if (t < start) return "upcoming";
  if (t <= end) return "live";
  return "unmarked";
}

/** Whole minutes until a session starts (negative once it has started). */
export function minutesUntilStart(s: TodaySession, now: Date): number {
  return Math.round((new Date(s.startTime).getTime() - now.getTime()) / 60000);
}

/**
 * The index in a start-sorted list where the now-cursor sits: the number of
 * sessions that have already started. Rendering inserts the live time marker
 * before this index.
 */
export function nowCursorIndex(sorted: TodaySession[], now: Date): number {
  const t = now.getTime();
  let i = 0;
  while (i < sorted.length && new Date(sorted[i].startTime).getTime() <= t) i++;
  return i;
}

const DAY = 24 * 3600 * 1000;

/** Matches the server rule: markable = past, within 7 days, not done/cancelled. */
export function isMarkable(s: TodaySession, now: Date): boolean {
  const start = new Date(s.startTime).getTime();
  if (start > now.getTime()) return false;
  if (now.getTime() - start > 7 * DAY) return false;
  return sessionPhase(s, now) === "unmarked";
}

/** Attendance debt (E9.5): every markable session across the 7-day window. */
export function attendanceDebt(sessions: TodaySession[], now: Date): TodaySession[] {
  return sessions
    .filter((s) => isMarkable(s, now))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

export function isSameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Today's sessions, sorted by start (cancelled kept — the Line shows them struck out). */
export function sessionsForDay(sessions: TodaySession[], day: Date): TodaySession[] {
  return sessions
    .filter((s) => isSameDay(new Date(s.startTime), day))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
}

// ---- Money helpers (paise-canonical, legacy-tolerant) ----------------------

function toDate(raw: unknown): Date | null {
  if (!raw) return null;
  if (typeof raw === "object" && typeof (raw as any).toDate === "function") return (raw as any).toDate();
  const d = new Date(raw as string);
  return isNaN(d.getTime()) ? null : d;
}

export function invoiceTotalPaise(inv: TodayInvoice): number {
  if (typeof inv.totalPaise === "number") return inv.totalPaise;
  return Math.round(((inv.totalAmount ?? inv.amount ?? 0) as number) * 100);
}

export function invoicePaidPaise(inv: TodayInvoice): number {
  if (typeof inv.paidPaise === "number") return inv.paidPaise;
  return inv.status === "paid" ? invoiceTotalPaise(inv) : 0;
}

/** Outstanding balance in paise; void and fully-paid invoices owe nothing. */
export function invoiceOutstandingPaise(inv: TodayInvoice): number {
  if (inv.status === "void" || inv.status === "paid") return 0;
  return Math.max(0, invoiceTotalPaise(inv) - invoicePaidPaise(inv));
}

const OPEN_INVOICE = new Set(["unpaid", "partially_paid", "sent", "overdue", "pending"]);

/** Whole days an invoice is past due (0 or negative = not yet due). */
export function daysOverdue(inv: TodayInvoice, now: Date): number {
  if (!inv.dueDate) return 0;
  const due = new Date(inv.dueDate + "T00:00:00");
  const midnight = new Date(now);
  midnight.setHours(0, 0, 0, 0);
  return Math.floor((midnight.getTime() - due.getTime()) / DAY);
}

// ---- The Pulse (E9.4): three numbers, no charts ----------------------------

export interface Pulse {
  collectedPaise: number;
  outstandingPaise: number;
  sessionsThisWeek: number;
  sessionsLastWeek: number;
}

function startOfMonth(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), 1);
}

/** Monday-anchored week start in local time. */
function startOfWeek(now: Date): Date {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d;
}

export function buildPulse(invoices: TodayInvoice[], sessions: TodaySession[], now: Date): Pulse {
  const monthStart = startOfMonth(now).getTime();
  let collectedPaise = 0;
  let outstandingPaise = 0;
  for (const inv of invoices) {
    outstandingPaise += invoiceOutstandingPaise(inv);
    const paid = invoicePaidPaise(inv);
    if (paid > 0) {
      const when = toDate(inv.lastPaymentAt) ?? toDate(inv.createdAt);
      if (when && when.getTime() >= monthStart) collectedPaise += paid;
    }
  }

  const weekStart = startOfWeek(now).getTime();
  const lastWeekStart = weekStart - 7 * DAY;
  const countBetween = (from: number, to: number) =>
    sessions.filter((s) => {
      if (s.status === "cancelled") return false;
      const t = new Date(s.startTime).getTime();
      return t >= from && t < to;
    }).length;

  return {
    collectedPaise,
    outstandingPaise,
    sessionsThisWeek: countBetween(weekStart, weekStart + 7 * DAY),
    sessionsLastWeek: countBetween(lastWeekStart, weekStart),
  };
}

// ---- The attention queue (E9.3), rules-based -------------------------------

export type QueueKind =
  | "overdue_invoice"
  | "unmarked_session"
  | "absence_streak"
  | "quiet_lead"
  | "schedule_conflict";

export interface QueueItem {
  /** Stable key across renders, so snooze/dismiss survives a live update. */
  id: string;
  kind: QueueKind;
  title: string;
  detail: string;
  tone: "danger" | "warn" | "neutral";
  /** Higher sorts first. */
  sort: number;
  daysOverdue?: number;
  invoiceId?: string;
  sessionId?: string;
  leadId?: string;
  studentId?: string;
  phone?: string;
}

const LEAD_CLOSED = new Set(["Enrolled", "Lost"]);

export interface QueueInput {
  invoices: TodayInvoice[];
  sessions: TodaySession[];
  leads: TodayLead[];
  students: TodayStudent[];
  attendance: TodayAttendance[];
}

/** Build the full rules-based queue, most urgent first. */
export function buildAttentionQueue(input: QueueInput, now: Date): QueueItem[] {
  const nameOf = new Map(input.students.map((s) => [s.id, s.name || "a student"]));
  const phoneOf = new Map(input.students.map((s) => [s.id, s.parentPhone || s.phone || ""]));
  const items: QueueItem[] = [];

  // 1. Overdue invoices, aged.
  for (const inv of input.invoices) {
    if (!OPEN_INVOICE.has(inv.status || "") || invoiceOutstandingPaise(inv) <= 0) continue;
    const d = daysOverdue(inv, now);
    if (d <= 0) continue;
    items.push({
      id: `overdue_invoice:${inv.id}`,
      kind: "overdue_invoice",
      title: `${nameOf.get(inv.studentId || "") ?? "Invoice"} · payment overdue`,
      detail: `${d} day${d === 1 ? "" : "s"} past due`,
      tone: d > 30 ? "danger" : "warn",
      sort: 1000 + Math.min(d, 365),
      daysOverdue: d,
      invoiceId: inv.id,
      studentId: inv.studentId,
      phone: phoneOf.get(inv.studentId || "") || undefined,
    });
  }

  // 2. Unmarked past sessions (attendance debt bubbles into the queue too).
  for (const s of attendanceDebt(input.sessions, now)) {
    const count = s.studentIds?.length ?? 0;
    items.push({
      id: `unmarked_session:${s.id}`,
      kind: "unmarked_session",
      title: "Attendance not marked",
      detail: `${new Date(s.startTime).toLocaleDateString("en-IN", { day: "numeric", month: "short" })} · ${count} student${count === 1 ? "" : "s"}`,
      tone: "warn",
      sort: 800 + Math.round((now.getTime() - new Date(s.startTime).getTime()) / DAY),
      sessionId: s.id,
    });
  }

  // 3. Absence streaks (3+ consecutive absences per student).
  for (const streak of absenceStreaks(input.attendance, 3)) {
    items.push({
      id: `absence_streak:${streak.studentId}`,
      kind: "absence_streak",
      title: `${nameOf.get(streak.studentId) ?? "A student"} · ${streak.length} absences in a row`,
      detail: "Reach out before they drift",
      tone: "warn",
      sort: 600 + streak.length,
      studentId: streak.studentId,
      phone: phoneOf.get(streak.studentId) || undefined,
    });
  }

  // 4. Quiet leads (untouched 6+ days, not yet won or lost).
  for (const lead of input.leads) {
    if (LEAD_CLOSED.has(lead.status || "")) continue;
    const touched = toDate(lead.updatedAt) ?? toDate(lead.createdAt);
    if (!touched) continue;
    const ageDays = Math.floor((now.getTime() - touched.getTime()) / DAY);
    if (ageDays < 6) continue;
    items.push({
      id: `quiet_lead:${lead.id}`,
      kind: "quiet_lead",
      title: `${lead.name || "Lead"} · going cold`,
      detail: `No contact in ${ageDays} days`,
      tone: "neutral",
      sort: 400 + Math.min(ageDays, 90),
      leadId: lead.id,
    });
  }

  // 5. Schedule conflicts (same tutor, overlapping upcoming sessions).
  for (const conflict of scheduleConflicts(input.sessions, now)) {
    items.push({
      id: `schedule_conflict:${conflict.a}_${conflict.b}`,
      kind: "schedule_conflict",
      title: "Schedule conflict",
      detail: conflict.detail,
      tone: "danger",
      sort: 1500, // conflicts are the most time-sensitive
      sessionId: conflict.a,
    });
  }

  return items.sort((x, y) => y.sort - x.sort);
}

// ---- Queue sub-derivations (exported for testing) --------------------------

export interface AbsenceStreak {
  studentId: string;
  length: number;
}

/**
 * Trailing consecutive absences per student. Records are grouped by student and
 * ordered by session start; we count the run of "absent" ending at the most
 * recent session. "excused" breaks a streak (it is not a no-show); "late" and
 * "present" break it too.
 */
export function absenceStreaks(records: TodayAttendance[], threshold: number): AbsenceStreak[] {
  const byStudent = new Map<string, TodayAttendance[]>();
  for (const r of records) {
    if (!byStudent.has(r.studentId)) byStudent.set(r.studentId, []);
    byStudent.get(r.studentId)!.push(r);
  }
  const out: AbsenceStreak[] = [];
  for (const [studentId, recs] of byStudent) {
    recs.sort((a, b) => (toDate(a.sessionStart)?.getTime() ?? 0) - (toDate(b.sessionStart)?.getTime() ?? 0));
    let run = 0;
    for (let i = recs.length - 1; i >= 0; i--) {
      if (recs[i].status === "absent") run++;
      else break;
    }
    if (run >= threshold) out.push({ studentId, length: run });
  }
  return out;
}

export interface Conflict {
  a: string;
  b: string;
  detail: string;
}

/** Overlapping scheduled sessions for the same tutor, from now forward. */
export function scheduleConflicts(sessions: TodaySession[], now: Date): Conflict[] {
  const active = sessions
    .filter((s) => s.status !== "cancelled" && new Date(s.endTime).getTime() >= now.getTime())
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());

  const seen = new Set<string>();
  const conflicts: Conflict[] = [];
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i];
      const b = active[j];
      if (!a.tutorId || a.tutorId !== b.tutorId) continue;
      const aStart = new Date(a.startTime).getTime();
      const aEnd = new Date(a.endTime).getTime();
      const bStart = new Date(b.startTime).getTime();
      if (bStart >= aEnd) continue; // sorted: no later one overlaps either
      const bEnd = new Date(b.endTime).getTime();
      if (aStart < bEnd && bStart < aEnd) {
        const key = [a.id, b.id].sort().join("_");
        if (seen.has(key)) continue;
        seen.add(key);
        const when = new Date(Math.max(aStart, bStart)).toLocaleString("en-IN", {
          day: "numeric",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        });
        conflicts.push({ a: a.id, b: b.id, detail: `Two sessions overlap on ${when}` });
      }
    }
  }
  return conflicts;
}
