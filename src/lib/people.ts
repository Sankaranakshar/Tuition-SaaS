// Pure derivations for the People workspace (DEV_PLAN Epic 12 / Stage 2 item 1,
// REDESIGN §6.2). Same discipline as src/lib/today.ts: no React, no Supabase
// reads, every function takes plain data plus an explicit `now` so the whole
// module is unit-testable and the clock is injectable. Reuses today.ts's
// invoice/attendance math rather than re-deriving it — one definition of
// "overdue" and "absence streak" for the whole app.

import {
  daysOverdue,
  absenceStreaks,
  type TodayInvoice,
  type TodayAttendance,
} from "./today";

export interface PeopleStudent {
  id: string;
  name: string;
  phone?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  createdAt?: string;
}

export type AttentionReason =
  | { kind: "overdue_fee"; days: number }
  | { kind: "absence_streak"; length: number }
  | { kind: "stale_contact"; days: number }
  | { kind: "none" };

export interface RankedStudent {
  student: PeopleStudent;
  reason: AttentionReason;
  /** Higher sorts first. Ties broken by name for a stable, predictable list. */
  priority: number;
}

const STALE_CONTACT_DAYS = 30;
const ABSENCE_THRESHOLD = 3;

function daysSince(iso: string | undefined, now: Date): number {
  if (!iso) return 0;
  return Math.floor((now.getTime() - new Date(iso).getTime()) / (24 * 3600 * 1000));
}

/**
 * Students sorted by "needs attention" (REDESIGN §6.2): overdue fees first
 * (worse overdue outranks milder), then absence streaks, then stale contact
 * (no roster update in 30+ days), then everyone else alphabetically.
 */
export function rankStudentsByAttention(
  students: PeopleStudent[],
  invoices: TodayInvoice[],
  attendance: TodayAttendance[],
  now: Date
): RankedStudent[] {
  const overdueByStudent = new Map<string, number>();
  for (const inv of invoices) {
    if (!inv.studentId) continue;
    const d = daysOverdue(inv, now);
    if (d > 0) overdueByStudent.set(inv.studentId, Math.max(overdueByStudent.get(inv.studentId) ?? 0, d));
  }
  const streaksByStudent = new Map(
    absenceStreaks(attendance, ABSENCE_THRESHOLD).map((s) => [s.studentId, s.length])
  );

  const ranked = students.map((student): RankedStudent => {
    const overdueDays = overdueByStudent.get(student.id);
    if (overdueDays) {
      return { student, reason: { kind: "overdue_fee", days: overdueDays }, priority: 3_000_000 + overdueDays };
    }
    const streak = streaksByStudent.get(student.id);
    if (streak) {
      return { student, reason: { kind: "absence_streak", length: streak }, priority: 2_000_000 + streak };
    }
    const staleDays = daysSince(student.createdAt, now);
    if (staleDays >= STALE_CONTACT_DAYS && !student.phone && !student.parentPhone) {
      return { student, reason: { kind: "stale_contact", days: staleDays }, priority: 1_000_000 + staleDays };
    }
    return { student, reason: { kind: "none" }, priority: 0 };
  });

  return ranked.sort((a, b) => b.priority - a.priority || a.student.name.localeCompare(b.student.name));
}

// ---- Leads: funnel + "going cold" (REDESIGN §6.2) --------------------------

export interface PeopleLead {
  id: string;
  name: string;
  status: string; // free-text today, not a DB enum — see DEV_PLAN Tech Debt
  source?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

export const LEAD_FUNNEL_STAGES = ["New", "Contacted", "Trial Scheduled", "Enrolled"] as const;
const CLOSED_STAGES = new Set(["Enrolled", "Lost"]);
const QUIET_LEAD_DAYS = 6;

export interface FunnelStage {
  stage: string;
  count: number;
}

/** Stage → count for the funnel strip. Order matches LEAD_FUNNEL_STAGES; "Lost" is excluded (it's a dead end, not a stage in the strip). */
export function buildLeadFunnel(leads: PeopleLead[]): FunnelStage[] {
  return LEAD_FUNNEL_STAGES.map((stage) => ({
    stage,
    count: leads.filter((l) => l.status === stage).length,
  }));
}

export interface RankedLead {
  lead: PeopleLead;
  daysSinceTouch: number;
  isGoingCold: boolean;
}

/**
 * Open leads sorted by time since last touch (updatedAt, falling back to
 * createdAt), oldest first — "going cold" is the job for a 2-person tuition
 * center, not pipeline volume. Closed stages (Enrolled/Lost) are dropped.
 */
export function rankLeadsByGoingCold(leads: PeopleLead[], now: Date): RankedLead[] {
  return leads
    .filter((l) => !CLOSED_STAGES.has(l.status))
    .map((lead) => {
      const daysSinceTouch = daysSince(lead.updatedAt ?? lead.createdAt, now);
      return { lead, daysSinceTouch, isGoingCold: daysSinceTouch >= QUIET_LEAD_DAYS };
    })
    .sort((a, b) => b.daysSinceTouch - a.daysSinceTouch);
}
