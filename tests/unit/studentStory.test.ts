import { describe, it, expect } from "vitest";
import {
  buildTimeline,
  filterTimeline,
  filterForNonStaff,
  computeHeaderStats,
  type StorySession,
  type StoryAssessment,
  type StoryDocument,
  type StoryPayment,
  type StoryNote,
} from "../../src/lib/studentStory";
import type { TodayInvoice } from "../../src/lib/today";

function session(id: string, startTime: string, status: StorySession["status"] = "completed"): StorySession {
  return { id, startTime, endTime: startTime, status };
}

describe("buildTimeline (REDESIGN §6.3)", () => {
  it("merges all sources into one reverse-chronological list", () => {
    const sessions = [session("s1", "2026-07-01T10:00:00Z"), session("s2", "2026-07-05T10:00:00Z")];
    const assessments: StoryAssessment[] = [
      { id: "a1", type: "quiz", date: "2026-07-03", createdAt: "2026-07-03T00:00:00Z" },
    ];
    const documents: StoryDocument[] = [{ id: "d1", fileName: "worksheet.pdf", createdAt: "2026-07-02T00:00:00Z" }];
    const payments: StoryPayment[] = [{ id: "p1", amountPaise: 50000, at: "2026-07-04T00:00:00Z" }];
    const notes: StoryNote[] = [{ id: "n1", body: "note", authorUserId: "u1", createdAt: "2026-07-06T00:00:00Z" }];

    const timeline = buildTimeline({ sessions, assessments, documents, payments, notes });
    expect(timeline.map((e) => e.id)).toEqual(["n1", "s2", "p1", "a1", "d1", "s1"]);
  });

  it("marks homework by dueDate when set, falling back to date/createdAt", () => {
    const assessments: StoryAssessment[] = [
      { id: "hw1", type: "assignment", dueDate: "2026-07-10", createdAt: "2026-07-01T00:00:00Z" },
    ];
    const timeline = buildTimeline({ sessions: [], assessments, documents: [], payments: [], notes: [] });
    expect(timeline[0].at).toBe("2026-07-10");
  });

  it("inserts a milestone event at every 10th completed session, uncompleted sessions don't count", () => {
    const sessions = Array.from({ length: 10 }, (_, i) =>
      session(`s${i}`, `2026-07-${String(i + 1).padStart(2, "0")}T10:00:00Z`)
    );
    sessions.push(session("cancelled", "2026-07-11T10:00:00Z", "cancelled"));
    const timeline = buildTimeline({ sessions, assessments: [], documents: [], payments: [], notes: [] });
    const milestones = timeline.filter((e) => e.kind === "milestone");
    expect(milestones).toHaveLength(1);
    expect(milestones[0].data).toEqual({ kind: "milestone", label: "10th session completed" });
  });

  it("marks notes private so they can be filtered out of the parent/student view", () => {
    const notes: StoryNote[] = [{ id: "n1", body: "private", authorUserId: "u1", createdAt: "2026-07-01T00:00:00Z" }];
    const timeline = buildTimeline({ sessions: [], assessments: [], documents: [], payments: [], notes });
    expect(timeline[0].private).toBe(true);
  });
});

describe("filterTimeline", () => {
  const sessions = [session("s1", "2026-07-01T10:00:00Z")];
  const notes: StoryNote[] = [{ id: "n1", body: "x", authorUserId: "u1", createdAt: "2026-07-02T00:00:00Z" }];
  const timeline = buildTimeline({ sessions, assessments: [], documents: [], payments: [], notes });

  it("'all' returns everything", () => {
    expect(filterTimeline(timeline, "all")).toHaveLength(2);
  });

  it("narrows to a single kind", () => {
    expect(filterTimeline(timeline, "notes").map((e) => e.id)).toEqual(["n1"]);
    expect(filterTimeline(timeline, "sessions").map((e) => e.id)).toEqual(["s1"]);
  });
});

describe("filterForNonStaff (REDESIGN §6.3: parent view = same component, permission-filtered)", () => {
  it("drops private notes but keeps everything else", () => {
    const sessions = [session("s1", "2026-07-01T10:00:00Z")];
    const notes: StoryNote[] = [{ id: "n1", body: "private", authorUserId: "u1", createdAt: "2026-07-02T00:00:00Z" }];
    const timeline = buildTimeline({ sessions, assessments: [], documents: [], payments: [], notes });
    const filtered = filterForNonStaff(timeline);
    expect(filtered.map((e) => e.id)).toEqual(["s1"]);
  });
});

describe("computeHeaderStats", () => {
  it("computes attendance rate from completed vs completed+no_show, ignores cancelled/scheduled", () => {
    const sessions = [
      session("s1", "2026-07-01T10:00:00Z", "completed"),
      session("s2", "2026-07-02T10:00:00Z", "completed"),
      session("s3", "2026-07-03T10:00:00Z", "completed"),
      session("s4", "2026-07-04T10:00:00Z", "no_show"),
      session("s5", "2026-07-05T10:00:00Z", "scheduled"),
      session("s6", "2026-07-06T10:00:00Z", "cancelled"),
    ];
    const stats = computeHeaderStats(sessions, [], 5);
    expect(stats.attendanceRatePct).toBe(75);
    expect(stats.walletBalance).toBe(5);
  });

  it("defaults attendance rate to 100 when there is no completed/no_show history yet", () => {
    const stats = computeHeaderStats([], [], 0);
    expect(stats.attendanceRatePct).toBe(100);
  });

  it("sums outstanding paise across invoices via invoiceOutstandingPaise", () => {
    const invoices: TodayInvoice[] = [
      { id: "i1", status: "unpaid", totalPaise: 100000, paidPaise: 0 },
      { id: "i2", status: "partial", totalPaise: 50000, paidPaise: 20000 },
      { id: "i3", status: "paid", totalPaise: 30000, paidPaise: 30000 },
    ];
    const stats = computeHeaderStats([], invoices, 0);
    expect(stats.outstandingPaise).toBe(130000);
  });
});
