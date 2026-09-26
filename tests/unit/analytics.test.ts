import { describe, it, expect } from "vitest";
import {
  ACTIVATION,
  computeActivation,
  daysToActivate,
  computeFunnel,
  orgStage,
  starterStage,
  computeRetentionCohorts,
  weekStartInZone,
  addDaysToDateKey,
  lastMonthKeys,
  pivotMonthlyCollected,
  type ActivationSnapshot,
} from "../../shared/analytics";
import { validateEventProperties, featureForPath, CLIENT_EVENT_NAMES } from "../../shared/analyticsEvents";
import { activationStatus, formatRate, formatCohortCell, formatMonthKey, featureLabel } from "../../src/lib/admin";

// C-07 (EXECUTION_PLAN.md Step 32).

const SIGNUP = "2026-09-01T04:30:00.000Z"; // 10:00 IST
const day = (n: number, extraMs = 0) => new Date(new Date(SIGNUP).getTime() + n * 86400000 + extraMs).toISOString();
const tenSessions = (startDay = 1) => Array.from({ length: 10 }, (_, i) => day(startDay + i * 0.5));

describe("computeActivation: MASTER_PLAN §11's definition", () => {
  it("uses exactly the plan's numbers", () => {
    expect(ACTIVATION).toEqual({ windowDays: 14, minSessionsAttended: 10, minCollectedPaise: 100 });
  });

  it("activates with 10 sessions and ₹1 collected inside 14 days, at the later of the two moments", () => {
    const r = computeActivation({
      signupAt: SIGNUP,
      firstClassAt: day(0.1),
      sessionFirstMarkedAt: tenSessions(1),
      collections: [{ at: day(3), paise: 50000, online: false }],
    });
    expect(r.sessionsAttendedInWindow).toBe(10);
    expect(r.tenthSessionAttendedAt).toBe(day(5.5));
    expect(r.firstCollectedAt).toBe(day(3));
    expect(r.activatedAt).toBe(day(5.5));
    expect(daysToActivate(r)).toBe(5);
    expect(r.windowEndsAt).toBe(day(14));
  });

  it("does not activate on 9 sessions, however much is collected", () => {
    const r = computeActivation({
      signupAt: SIGNUP, firstClassAt: day(0), sessionFirstMarkedAt: tenSessions(1).slice(0, 9),
      collections: [{ at: day(2), paise: 1_000_000, online: true }],
    });
    expect(r.activatedAt).toBeNull();
    expect(r.tenthSessionAttendedAt).toBeNull();
  });

  it("does not activate with 10 sessions and nothing collected", () => {
    const r = computeActivation({ signupAt: SIGNUP, firstClassAt: day(0), sessionFirstMarkedAt: tenSessions(1), collections: [] });
    expect(r.activatedAt).toBeNull();
    expect(r.firstCollectedAt).toBeNull();
  });

  it("the first rupee is when the running total reaches 100 paise, not the first row", () => {
    const r = computeActivation({
      signupAt: SIGNUP, firstClassAt: null, sessionFirstMarkedAt: [],
      collections: [
        { at: day(2), paise: 40, online: false },
        { at: day(4), paise: 60, online: false },
        { at: day(1), paise: 0, online: false },
      ],
    });
    expect(r.firstCollectedAt).toBe(day(4));
    expect(r.collectedInWindowPaise).toBe(100);
  });

  it("a 10th session or a first rupee after day 14 does not count", () => {
    const lateSession = computeActivation({
      signupAt: SIGNUP, firstClassAt: day(0),
      sessionFirstMarkedAt: [...tenSessions(1).slice(0, 9), day(14, 1)],
      collections: [{ at: day(2), paise: 500, online: false }],
    });
    expect(lateSession.tenthSessionAttendedAt).toBe(day(14, 1));
    expect(lateSession.sessionsAttendedInWindow).toBe(9);
    expect(lateSession.activatedAt).toBeNull();

    const lateMoney = computeActivation({
      signupAt: SIGNUP, firstClassAt: day(0), sessionFirstMarkedAt: tenSessions(1),
      collections: [{ at: day(15), paise: 500, online: false }],
    });
    expect(lateMoney.firstCollectedAt).toBe(day(15));
    expect(lateMoney.collectedInWindowPaise).toBe(0);
    expect(lateMoney.activatedAt).toBeNull();
  });

  it("the boundary instant (exactly 14 days) is inside the window", () => {
    const r = computeActivation({
      signupAt: SIGNUP, firstClassAt: day(0), sessionFirstMarkedAt: [...tenSessions(1).slice(0, 9), day(14)],
      collections: [{ at: day(14), paise: 100, online: false }],
    });
    expect(r.activatedAt).toBe(day(14));
    expect(daysToActivate(r)).toBe(14);
  });

  it("splits the online (Razorpay) share and orders unsorted input", () => {
    const r = computeActivation({
      signupAt: SIGNUP, firstClassAt: null, sessionFirstMarkedAt: [day(3), day(1), day(2)],
      collections: [{ at: day(5), paise: 300, online: true }, { at: day(2), paise: 200, online: false }],
    });
    expect(r.firstAttendanceAt).toBe(day(1));
    expect(r.collectedInWindowPaise).toBe(500);
    expect(r.collectedOnlineInWindowPaise).toBe(300);
  });
});

describe("funnel stages and computeFunnel", () => {
  const snap = (p: Partial<ActivationSnapshot>): ActivationSnapshot => ({
    firstClassAt: null, firstAttendanceAt: null, sessionsAttendedInWindow: 0, activatedAt: null, ...p,
  });

  it("orgStage walks created -> first class -> first attendance -> 10 sessions -> activated", () => {
    expect(orgStage(snap({}))).toBe(4);
    expect(orgStage(snap({ firstClassAt: day(0) }))).toBe(5);
    expect(orgStage(snap({ firstClassAt: day(0), firstAttendanceAt: day(1) }))).toBe(6);
    expect(orgStage(snap({ firstClassAt: day(0), firstAttendanceAt: day(1), sessionsAttendedInWindow: 10 }))).toBe(7);
    expect(orgStage(snap({ firstClassAt: day(0), firstAttendanceAt: day(1), sessionsAttendedInWindow: 10, activatedAt: day(5) }))).toBe(8);
  });

  it("starterStage uses the onboarding beat until an org exists, then the org's stage", () => {
    const byOrg = new Map([["o1", snap({ firstClassAt: day(0) })]]);
    expect(starterStage({ maxBeat: 2, organizationId: null }, byOrg)).toBe(2);
    expect(starterStage({ maxBeat: 3, organizationId: "o1" }, byOrg)).toBe(5);
    // An org whose rollup has not run yet is at "created".
    expect(starterStage({ maxBeat: 3, organizationId: "o2" }, byOrg)).toBe(4);
    // A lost beat-3 beacon cannot make a finished person look stuck.
    expect(starterStage({ maxBeat: 1, organizationId: "o2" }, byOrg)).toBe(4);
  });

  it("counts everyone at a stage or beyond, so it only narrows, with drop-off per step", () => {
    const steps = computeFunnel([1, 1, 2, 3, 3, 4, 5, 6, 8]);
    expect(steps.map((s) => s.count)).toEqual([9, 7, 6, 4, 3, 2, 1, 1]);
    expect(steps.map((s) => s.dropOff)).toEqual([0, 2, 1, 2, 1, 1, 1, 0]);
    expect(steps[0].conversionFromPrevious).toBeNull();
    expect(steps[1].conversionFromPrevious).toBeCloseTo(7 / 9);
    expect(steps[7].key).toBe("activated");
  });

  it("an org-only funnel starts at org created; an empty funnel has no rates", () => {
    const org = computeFunnel([4, 5, 8], 4);
    expect(org.map((s) => s.key)).toEqual(["org_created", "first_class", "first_attendance", "ten_sessions", "activated"]);
    expect(org.map((s) => s.count)).toEqual([3, 2, 1, 1, 1]);
    const empty = computeFunnel([]);
    expect(empty.every((s) => s.count === 0 && s.conversionFromPrevious === null)).toBe(true);
  });
});

describe("weeks and months in an org's timezone", () => {
  it("weekStartInZone is the Monday of the local week", () => {
    // Sunday 2026-09-06 20:00 UTC is Monday 01:30 IST: a new IST week.
    expect(weekStartInZone(new Date("2026-09-06T20:00:00Z"), "Asia/Kolkata")).toBe("2026-09-07");
    expect(weekStartInZone(new Date("2026-09-06T20:00:00Z"), "UTC")).toBe("2026-08-31");
    expect(weekStartInZone(new Date("2026-09-09T12:00:00Z"), "Asia/Kolkata")).toBe("2026-09-07");
  });

  it("addDaysToDateKey crosses months and years", () => {
    expect(addDaysToDateKey("2026-12-28", 7)).toBe("2027-01-04");
    expect(addDaysToDateKey("2026-03-02", -7)).toBe("2026-02-23");
  });

  it("lastMonthKeys ends at the local month and crosses a year", () => {
    expect(lastMonthKeys(new Date("2026-02-10T12:00:00Z"), 3, "Asia/Kolkata")).toEqual(["2025-12", "2026-01", "2026-02"]);
    // 2026-02-28 20:00 UTC is already 1 March in IST.
    expect(lastMonthKeys(new Date("2026-02-28T20:00:00Z"), 1, "Asia/Kolkata")).toEqual(["2026-03"]);
  });
});

describe("computeRetentionCohorts: retained = attendance marked that week", () => {
  it("groups by signup week, counts active orgs per week offset, and leaves future weeks null", () => {
    const rows = computeRetentionCohorts(
      [
        { organizationId: "a", signupWeek: "2026-09-07" },
        { organizationId: "b", signupWeek: "2026-09-07" },
        { organizationId: "c", signupWeek: "2026-09-14" },
      ],
      [
        { organizationId: "a", weekStart: "2026-09-07", sessionsAttended: 3 },
        { organizationId: "b", weekStart: "2026-09-07", sessionsAttended: 0 },
        { organizationId: "a", weekStart: "2026-09-14", sessionsAttended: 1 },
        { organizationId: "b", weekStart: "2026-09-14", sessionsAttended: 2 },
        { organizationId: "c", weekStart: "2026-09-21", sessionsAttended: 1 },
      ],
      "2026-09-21",
      3
    );
    expect(rows).toEqual([
      { cohortWeek: "2026-09-14", size: 1, retained: [0, 1, null, null] },
      { cohortWeek: "2026-09-07", size: 2, retained: [1, 2, 0, null] },
    ]);
  });
});

describe("pivotMonthlyCollected", () => {
  it("fills missing months with zero and sorts by total collected", () => {
    const out = pivotMonthlyCollected(
      [{ organizationId: "a", name: "Alpha" }, { organizationId: "b", name: "Beta" }, { organizationId: "c", name: "Gamma" }],
      [
        { organizationId: "a", month: "2026-08", collectedPaise: 1000, onlinePaise: 0 },
        { organizationId: "b", month: "2026-09", collectedPaise: 5000, onlinePaise: 2000 },
        { organizationId: "b", month: "2026-01", collectedPaise: 9999, onlinePaise: 0 }, // outside the months shown
      ],
      ["2026-08", "2026-09"]
    );
    expect(out.map((o) => o.name)).toEqual(["Beta", "Alpha", "Gamma"]);
    expect(out[0].months).toEqual([
      { month: "2026-08", collectedPaise: 0, onlinePaise: 0 },
      { month: "2026-09", collectedPaise: 5000, onlinePaise: 2000 },
    ]);
    expect(out[0].totalPaise).toBe(5000);
    expect(out[2].totalPaise).toBe(0);
  });
});

describe("the payload rule (validateEventProperties)", () => {
  const SESSION = "0b6c5a9e-6f3e-4c1e-9d2a-8f1e2d3c4b5a";

  it("accepts ids, counts and fixed values", () => {
    expect(validateEventProperties("attendance.marked", { sessionId: SESSION, present: 3, absent: 1, billed: 0, invoiced: 3 })).toBeNull();
    expect(validateEventProperties("payment.recorded", { amountPaise: 50000, channel: "manual", method: "cash" })).toBeNull();
    expect(validateEventProperties("onboarding.beat_viewed", { beat: 2, mode: "center" })).toBeNull();
    expect(validateEventProperties("org.created", {})).toBeNull();
  });

  it("refuses a name, a phone or message text, even under an allowed key", () => {
    expect(validateEventProperties("attendance.marked", { sessionId: "Asha Rao" })).toMatch(/record id/);
    expect(validateEventProperties("payment.recorded", { amountPaise: 100, channel: "manual", method: "+919876543210" })).toMatch(/one of/);
    expect(validateEventProperties("feature.opened", { feature: "Hi Asha, your fee is due" })).toMatch(/one of/);
  });

  it("refuses keys an event does not declare, including student and parent ids", () => {
    expect(validateEventProperties("attendance.marked", { sessionId: SESSION, studentId: SESSION })).toMatch(/not an allowed property/);
    expect(validateEventProperties("org.created", { name: "Rao Tutorials" })).toMatch(/not an allowed property/);
    expect(validateEventProperties("parent.portal_opened", { phone: "9876543210" })).toMatch(/not an allowed property/);
  });

  it("refuses unknown events, wrong kinds, out-of-range numbers and missing required keys", () => {
    expect(validateEventProperties("student.named", {})).toMatch(/unknown event/);
    expect(validateEventProperties("attendance.marked", { sessionId: SESSION, present: "3" })).toMatch(/integer/);
    expect(validateEventProperties("attendance.marked", { sessionId: SESSION, present: -1 })).toMatch(/out of range/);
    expect(validateEventProperties("attendance.marked", { sessionId: SESSION, present: 1.5 })).toMatch(/integer/);
    expect(validateEventProperties("onboarding.beat_viewed", { beat: 4 })).toMatch(/out of range/);
    expect(validateEventProperties("onboarding.beat_viewed", {})).toMatch(/required/);
    expect(validateEventProperties("org.created", ["x"])).toMatch(/object/);
    expect(validateEventProperties("org.created", null)).toMatch(/object/);
  });

  it("exposes exactly three client events", () => {
    expect([...CLIENT_EVENT_NAMES].sort()).toEqual(["feature.opened", "onboarding.beat_viewed", "parent.portal_opened"]);
  });

  it("featureForPath maps /app routes to workspaces and ignores the rest", () => {
    expect(featureForPath("/app")).toBe("today");
    expect(featureForPath("/app/")).toBe("today");
    expect(featureForPath("/app/money")).toBe("money");
    expect(featureForPath("/app/students/123")).toBe("student_story");
    expect(featureForPath("/app/my-schedule")).toBe("schedule");
    expect(featureForPath("/app/platform-admin")).toBeNull();
    expect(featureForPath("/onboarding")).toBeNull();
  });
});

describe("platform admin display helpers", () => {
  const now = new Date(day(10));
  it("activationStatus: activated, still in the window, or not activated", () => {
    expect(activationStatus({ activatedAt: day(5), windowEndsAt: day(14) }, now)).toEqual({ kind: "activated", activatedAt: day(5) });
    expect(activationStatus({ activatedAt: null, windowEndsAt: day(14) }, now)).toEqual({ kind: "in_window", daysLeft: 4 });
    expect(activationStatus({ activatedAt: null, windowEndsAt: day(9) }, now)).toEqual({ kind: "not_activated" });
  });

  it("formats rates, cohort cells, months and feature names", () => {
    expect(formatRate(0.4567)).toBe("46%");
    expect(formatRate(null)).toBe("–");
    expect(formatCohortCell(2, 3)).toBe("2 of 3 (67%)");
    expect(formatCohortCell(null, 3)).toBe("–");
    expect(formatMonthKey("2026-09")).toMatch(/Sep/);
    expect(featureLabel("student_story")).toBe("Student story");
  });
});
