import { describe, it, expect } from "vitest";
import {
  rankStudentsByAttention,
  buildLeadFunnel,
  rankLeadsByGoingCold,
  type PeopleStudent,
  type PeopleLead,
} from "../../src/lib/people";
import type { TodayInvoice, TodayAttendance } from "../../src/lib/today";

const NOW = new Date("2026-07-10T12:00:00Z");

function student(id: string, extra: Partial<PeopleStudent> = {}): PeopleStudent {
  return { id, name: id, createdAt: "2026-01-01T00:00:00Z", ...extra };
}

describe("rankStudentsByAttention (REDESIGN §6.2)", () => {
  it("puts an overdue-fee student first, worse overdue ranking higher", () => {
    const students = [student("a", { phone: "123" }), student("b", { phone: "123" }), student("c", { phone: "123" })];
    const invoices: TodayInvoice[] = [
      { id: "i1", studentId: "b", status: "unpaid", dueDate: "2026-07-01" }, // 9 days overdue
      { id: "i2", studentId: "c", status: "unpaid", dueDate: "2026-07-08" }, // 2 days overdue
    ];
    const ranked = rankStudentsByAttention(students, invoices, [], NOW);
    expect(ranked[0].student.id).toBe("b");
    expect(ranked[0].reason).toEqual({ kind: "overdue_fee", days: 9 });
    expect(ranked[1].student.id).toBe("c");
    expect(ranked[2].student.id).toBe("a");
    expect(ranked[2].reason).toEqual({ kind: "none" });
  });

  it("ranks an absence streak below overdue fees but above stale contact", () => {
    const students = [student("a", { phone: "123" }), student("b")];
    const attendance: TodayAttendance[] = [
      { studentId: "b", status: "absent", sessionStart: "2026-07-08T10:00:00Z" },
      { studentId: "b", status: "absent", sessionStart: "2026-07-06T10:00:00Z" },
      { studentId: "b", status: "absent", sessionStart: "2026-07-04T10:00:00Z" },
    ];
    const ranked = rankStudentsByAttention(students, [], attendance, NOW);
    expect(ranked[0].student.id).toBe("b");
    expect(ranked[0].reason).toEqual({ kind: "absence_streak", length: 3 });
  });

  it("flags stale contact only when no phone is on file and the roster entry is old", () => {
    const students = [
      student("has-phone", { phone: "123", createdAt: "2026-01-01T00:00:00Z" }),
      student("no-phone-old", { createdAt: "2026-01-01T00:00:00Z" }),
      student("no-phone-new", { createdAt: "2026-07-09T00:00:00Z" }),
    ];
    const ranked = rankStudentsByAttention(students, [], [], NOW);
    const byId = Object.fromEntries(ranked.map((r) => [r.student.id, r.reason]));
    expect(byId["has-phone"]).toEqual({ kind: "none" });
    expect(byId["no-phone-new"]).toEqual({ kind: "none" });
    expect(byId["no-phone-old"].kind).toBe("stale_contact");
  });

  it("ties break alphabetically for a stable, predictable list", () => {
    const students = [student("Zed"), student("Amy")];
    const ranked = rankStudentsByAttention(students, [], [], NOW);
    expect(ranked.map((r) => r.student.id)).toEqual(["Amy", "Zed"]);
  });
});

function lead(id: string, status: string, extra: Partial<PeopleLead> = {}): PeopleLead {
  return { id, name: id, status, createdAt: "2026-07-01T00:00:00Z", ...extra };
}

describe("buildLeadFunnel (REDESIGN §6.2)", () => {
  it("counts leads per stage in funnel order, Lost excluded from the strip", () => {
    const leads = [
      lead("a", "New"),
      lead("b", "New"),
      lead("c", "Contacted"),
      lead("d", "Enrolled"),
      lead("e", "Lost"),
    ];
    expect(buildLeadFunnel(leads)).toEqual([
      { stage: "New", count: 2 },
      { stage: "Contacted", count: 1 },
      { stage: "Trial Scheduled", count: 0 },
      { stage: "Enrolled", count: 1 },
    ]);
  });
});

describe("rankLeadsByGoingCold (REDESIGN §6.2)", () => {
  it("excludes closed stages (Enrolled/Lost)", () => {
    const leads = [lead("a", "New"), lead("b", "Enrolled"), lead("c", "Lost")];
    const ranked = rankLeadsByGoingCold(leads, NOW);
    expect(ranked.map((r) => r.lead.id)).toEqual(["a"]);
  });

  it("sorts oldest-touched first and flags going-cold at the 6-day threshold", () => {
    const leads = [
      lead("recent", "New", { updatedAt: "2026-07-09T00:00:00Z" }), // 1 day
      lead("cold", "New", { updatedAt: "2026-07-01T00:00:00Z" }), // 9 days
    ];
    const ranked = rankLeadsByGoingCold(leads, NOW);
    expect(ranked.map((r) => r.lead.id)).toEqual(["cold", "recent"]);
    expect(ranked[0].isGoingCold).toBe(true);
    expect(ranked[1].isGoingCold).toBe(false);
  });

  it("falls back to createdAt when a lead has never been touched", () => {
    const leads = [lead("never-touched", "New", { updatedAt: undefined, createdAt: "2026-06-01T00:00:00Z" })];
    const ranked = rankLeadsByGoingCold(leads, NOW);
    expect(ranked[0].daysSinceTouch).toBe(39);
  });
});
