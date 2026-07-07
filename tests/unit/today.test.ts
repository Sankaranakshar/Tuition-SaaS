import { describe, it, expect } from "vitest";
import {
  sessionPhase,
  nowCursorIndex,
  isMarkable,
  attendanceDebt,
  invoiceTotalPaise,
  invoicePaidPaise,
  invoiceOutstandingPaise,
  daysOverdue,
  buildPulse,
  absenceStreaks,
  scheduleConflicts,
  buildAttentionQueue,
  type TodaySession,
  type TodayInvoice,
} from "../../src/lib/today";

const NOW = new Date("2026-07-07T12:00:00Z");

// Small helper to build a session relative to NOW.
function sess(id: string, startOffsetMin: number, durMin = 60, extra: Partial<TodaySession> = {}): TodaySession {
  const start = new Date(NOW.getTime() + startOffsetMin * 60000);
  const end = new Date(start.getTime() + durMin * 60000);
  return { id, startTime: start.toISOString(), endTime: end.toISOString(), tutorId: "t1", studentIds: ["s1", "s2"], ...extra };
}

describe("session phase machine (E9.1)", () => {
  it("is upcoming before the start", () => {
    expect(sessionPhase(sess("a", 30), NOW)).toBe("upcoming");
  });
  it("is live between start and end", () => {
    expect(sessionPhase(sess("a", -10, 60), NOW)).toBe("live");
  });
  it("is unmarked after the end", () => {
    expect(sessionPhase(sess("a", -120, 60), NOW)).toBe("unmarked");
  });
  it("is done when completed or attendance marked", () => {
    expect(sessionPhase(sess("a", -120, 60, { status: "completed" }), NOW)).toBe("done");
    expect(sessionPhase(sess("a", -120, 60, { attendanceMarkedAt: new Date() }), NOW)).toBe("done");
  });
  it("is cancelled regardless of time", () => {
    expect(sessionPhase(sess("a", -120, 60, { status: "cancelled" }), NOW)).toBe("cancelled");
  });
});

describe("now-cursor (E9.1)", () => {
  it("counts sessions that have already started", () => {
    const list = [sess("a", -120), sess("b", -30), sess("c", 30), sess("d", 90)];
    expect(nowCursorIndex(list, NOW)).toBe(2);
  });
  it("is 0 before the first session and length after the last", () => {
    expect(nowCursorIndex([sess("a", 30), sess("b", 60)], NOW)).toBe(0);
    expect(nowCursorIndex([sess("a", -120), sess("b", -60)], NOW)).toBe(2);
  });
});

describe("attendance debt / markable (E9.5)", () => {
  it("marks past, unmarked, within-7-day sessions", () => {
    expect(isMarkable(sess("a", -120, 60), NOW)).toBe(true);
  });
  it("excludes future sessions", () => {
    expect(isMarkable(sess("a", 30), NOW)).toBe(false);
  });
  it("excludes sessions older than 7 days", () => {
    expect(isMarkable(sess("a", -8 * 24 * 60, 60), NOW)).toBe(false);
  });
  it("excludes already-marked and cancelled", () => {
    expect(isMarkable(sess("a", -120, 60, { status: "completed" }), NOW)).toBe(false);
    expect(isMarkable(sess("a", -120, 60, { status: "cancelled" }), NOW)).toBe(false);
  });
  it("collects and sorts the debt window", () => {
    const debt = attendanceDebt([sess("a", -60, 30), sess("b", -300, 30), sess("c", 60)], NOW);
    expect(debt.map((s) => s.id)).toEqual(["b", "a"]);
  });
});

describe("invoice money helpers (paise-canonical, legacy tolerant)", () => {
  it("prefers paise fields", () => {
    expect(invoiceTotalPaise({ id: "1", totalPaise: 300000 })).toBe(300000);
  });
  it("falls back to legacy rupee floats", () => {
    expect(invoiceTotalPaise({ id: "1", totalAmount: 3000 })).toBe(300000);
    expect(invoiceTotalPaise({ id: "1", amount: 1500 })).toBe(150000);
  });
  it("derives paid from status when paidPaise is absent", () => {
    expect(invoicePaidPaise({ id: "1", status: "paid", totalPaise: 300000 })).toBe(300000);
    expect(invoicePaidPaise({ id: "1", status: "unpaid", totalPaise: 300000 })).toBe(0);
  });
  it("outstanding is zero for void and paid, else total minus paid", () => {
    expect(invoiceOutstandingPaise({ id: "1", status: "void", totalPaise: 300000 })).toBe(0);
    expect(invoiceOutstandingPaise({ id: "1", status: "paid", totalPaise: 300000 })).toBe(0);
    expect(invoiceOutstandingPaise({ id: "1", status: "partially_paid", totalPaise: 300000, paidPaise: 100000 })).toBe(200000);
  });
});

describe("daysOverdue", () => {
  it("counts whole days past the due date", () => {
    expect(daysOverdue({ id: "1", dueDate: "2026-07-01" }, NOW)).toBe(6);
  });
  it("is zero or negative before the due date", () => {
    expect(daysOverdue({ id: "1", dueDate: "2026-07-10" }, NOW)).toBeLessThanOrEqual(0);
  });
});

describe("the Pulse (E9.4)", () => {
  const invoices: TodayInvoice[] = [
    { id: "1", status: "paid", totalPaise: 300000, paidPaise: 300000, lastPaymentAt: "2026-07-05T00:00:00Z" },
    { id: "2", status: "paid", totalPaise: 200000, paidPaise: 200000, lastPaymentAt: "2026-06-20T00:00:00Z" }, // last month
    { id: "3", status: "unpaid", totalPaise: 150000, paidPaise: 0, createdAt: "2026-07-02T00:00:00Z" },
    { id: "4", status: "partially_paid", totalPaise: 100000, paidPaise: 40000, lastPaymentAt: "2026-07-06T00:00:00Z" },
  ];
  const sessions = [sess("a", -1 * 24 * 60), sess("b", -3 * 24 * 60), sess("c", -9 * 24 * 60, 60, { status: "cancelled" })];

  it("collects only this-month payments", () => {
    const p = buildPulse(invoices, sessions, NOW);
    expect(p.collectedPaise).toBe(300000 + 40000); // inv 1 + inv 4, not inv 2 (last month)
  });
  it("sums outstanding across open invoices", () => {
    const p = buildPulse(invoices, sessions, NOW);
    expect(p.outstandingPaise).toBe(150000 + 60000); // inv 3 full + inv 4 remainder
  });
  it("counts non-cancelled sessions in the week windows", () => {
    const p = buildPulse(invoices, sessions, NOW);
    expect(p.sessionsThisWeek).toBeGreaterThanOrEqual(1);
  });
});

describe("absence streaks (E9.3)", () => {
  it("flags 3+ trailing consecutive absences", () => {
    const recs = [
      { studentId: "s1", status: "absent" as const, sessionStart: "2026-07-01" },
      { studentId: "s1", status: "absent" as const, sessionStart: "2026-07-03" },
      { studentId: "s1", status: "absent" as const, sessionStart: "2026-07-05" },
    ];
    expect(absenceStreaks(recs, 3)).toEqual([{ studentId: "s1", length: 3 }]);
  });
  it("does not flag when a recent present breaks the run", () => {
    const recs = [
      { studentId: "s1", status: "absent" as const, sessionStart: "2026-07-01" },
      { studentId: "s1", status: "absent" as const, sessionStart: "2026-07-03" },
      { studentId: "s1", status: "present" as const, sessionStart: "2026-07-05" },
    ];
    expect(absenceStreaks(recs, 3)).toEqual([]);
  });
});

describe("schedule conflicts (E9.3)", () => {
  it("detects overlapping sessions for the same tutor", () => {
    const a = sess("a", 60, 60, { tutorId: "t1" });
    const b = sess("b", 90, 60, { tutorId: "t1" }); // overlaps a
    expect(scheduleConflicts([a, b], NOW)).toHaveLength(1);
  });
  it("ignores different tutors and non-overlapping times", () => {
    const a = sess("a", 60, 60, { tutorId: "t1" });
    const b = sess("b", 90, 60, { tutorId: "t2" });
    const c = sess("c", 200, 60, { tutorId: "t1" });
    expect(scheduleConflicts([a, b, c], NOW)).toHaveLength(0);
  });
});

describe("attention queue assembly (E9.3)", () => {
  it("builds items across types and sorts conflicts first", () => {
    const sessions = [
      sess("past", -120, 60), // unmarked debt
      sess("x", 60, 60, { tutorId: "t1" }),
      sess("y", 90, 60, { tutorId: "t1" }), // conflict with x
    ];
    const invoices: TodayInvoice[] = [{ id: "i1", status: "unpaid", studentId: "s1", totalPaise: 300000, dueDate: "2026-07-01" }];
    const q = buildAttentionQueue(
      { invoices, sessions, leads: [{ id: "l1", status: "New", updatedAt: "2026-06-25T00:00:00Z" }], students: [{ id: "s1", name: "Riya", parentPhone: "999" }], attendance: [] },
      NOW
    );
    const kinds = q.map((i) => i.kind);
    expect(kinds[0]).toBe("schedule_conflict"); // most urgent
    expect(kinds).toContain("overdue_invoice");
    expect(kinds).toContain("unmarked_session");
    expect(kinds).toContain("quiet_lead");
  });
});
