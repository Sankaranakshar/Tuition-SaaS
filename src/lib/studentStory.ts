// Pure derivations for the Student Story workspace (DEV_PLAN §2a Stage 2 item
// 2, REDESIGN §6.3). Same discipline as src/lib/today.ts and src/lib/people.ts:
// no React, no Supabase reads, every function takes plain data plus an
// explicit `now` where time matters, so the whole module is unit-testable.
//
// The centerpiece is buildTimeline(): it merges five heterogeneous sources
// (sessions, homework/assessments, files, money, notes) into one
// reverse-chronological list of events, plus a derived milestone event where
// a round-number attendance count is crossed. The page filters this list by
// chip, never re-queries per filter.

import { invoiceOutstandingPaise, type TodayInvoice } from "./today";

export interface StorySession {
  id: string;
  startTime: string; // ISO
  endTime: string;
  status?: "scheduled" | "completed" | "cancelled" | "no_show";
}

export interface StoryAssessment {
  id: string;
  type?: string | null; // "assignment" = homework; anything else = graded assessment
  title?: string | null;
  status?: string | null; // pending | submitted, homework only
  date?: string | null; // graded assessments
  dueDate?: string | null; // homework
  score?: number | null;
  totalScore?: number | null;
  feedback?: string | null;
  createdAt: string;
}

export interface StoryDocument {
  id: string;
  fileName: string;
  category?: string | null;
  createdAt: string;
}

export interface StoryPayment {
  id: string;
  amountPaise: number;
  method?: string | null;
  at: string;
}

export interface StoryNote {
  id: string;
  body: string;
  authorUserId: string;
  createdAt: string;
}

export type StoryEventKind = "session" | "homework" | "file" | "money" | "note" | "milestone";

export interface StoryEvent {
  kind: StoryEventKind;
  id: string;
  at: string; // ISO, the sort key
  private?: boolean; // hidden from the parent/student view
  data:
    | { kind: "session"; session: StorySession }
    | { kind: "homework"; assessment: StoryAssessment }
    | { kind: "file"; document: StoryDocument }
    | { kind: "money"; payment: StoryPayment }
    | { kind: "note"; note: StoryNote }
    | { kind: "milestone"; label: string };
}

const MILESTONE_INTERVAL = 10;

/** Merges all sources into one reverse-chronological timeline, with milestone markers inserted at round-number completed-session counts. */
export function buildTimeline(input: {
  sessions: StorySession[];
  assessments: StoryAssessment[];
  documents: StoryDocument[];
  payments: StoryPayment[];
  notes: StoryNote[];
}): StoryEvent[] {
  const events: StoryEvent[] = [];

  for (const session of input.sessions) {
    events.push({ kind: "session", id: session.id, at: session.startTime, data: { kind: "session", session } });
  }
  for (const assessment of input.assessments) {
    const at = assessment.dueDate ?? assessment.date ?? assessment.createdAt;
    events.push({ kind: "homework", id: assessment.id, at, data: { kind: "homework", assessment } });
  }
  for (const document of input.documents) {
    events.push({ kind: "file", id: document.id, at: document.createdAt, data: { kind: "file", document } });
  }
  for (const payment of input.payments) {
    events.push({ kind: "money", id: payment.id, at: payment.at, data: { kind: "money", payment } });
  }
  for (const note of input.notes) {
    events.push({ kind: "note", id: note.id, at: note.createdAt, private: true, data: { kind: "note", note } });
  }

  const completed = input.sessions
    .filter((s) => s.status === "completed")
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  completed.forEach((session, index) => {
    const count = index + 1;
    if (count > 0 && count % MILESTONE_INTERVAL === 0) {
      events.push({
        kind: "milestone",
        id: `milestone-${session.id}`,
        at: session.startTime,
        data: { kind: "milestone", label: `${count}th session completed` },
      });
    }
  });

  return events.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
}

export type StoryFilter = "all" | "sessions" | "homework" | "money" | "notes";

const FILTER_KINDS: Record<Exclude<StoryFilter, "all">, StoryEventKind[]> = {
  sessions: ["session", "milestone"],
  homework: ["homework"],
  money: ["money"],
  notes: ["note"],
};

/** Narrows the timeline to a filter chip; "all" (default) returns every event. Milestones always ride along with sessions — they're derived from the same data. */
export function filterTimeline(events: StoryEvent[], filter: StoryFilter): StoryEvent[] {
  if (filter === "all") return events;
  const kinds = FILTER_KINDS[filter];
  return events.filter((e) => kinds.includes(e.kind));
}

/** Drops private (staff-only) events for the parent/student-facing view of the same component (REDESIGN §6.3). */
export function filterForNonStaff(events: StoryEvent[]): StoryEvent[] {
  return events.filter((e) => !e.private);
}

export interface StoryHeaderStats {
  attendanceRatePct: number; // 0-100, based on completed vs completed+no_show
  outstandingPaise: number;
  walletBalance: number;
}

/** The pinned header's always-true facts (REDESIGN §6.3): attendance rate, outstanding balance, wallet balance. */
export function computeHeaderStats(
  sessions: StorySession[],
  invoices: TodayInvoice[],
  walletBalance: number
): StoryHeaderStats {
  const completed = sessions.filter((s) => s.status === "completed").length;
  const noShow = sessions.filter((s) => s.status === "no_show").length;
  const total = completed + noShow;
  const attendanceRatePct = total > 0 ? Math.round((completed / total) * 100) : 100;
  const outstandingPaise = invoices.reduce((sum, inv) => sum + invoiceOutstandingPaise(inv), 0);
  return { attendanceRatePct, outstandingPaise, walletBalance };
}
