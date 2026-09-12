import { describe, it, expect } from "vitest";
import { resolveMonthRange, computeAttendanceSummary } from "../../shared/progressReport.ts";

describe("resolveMonthRange (B-12, EXECUTION_PLAN.md Step 22)", () => {
  it("resolves a valid YYYY-MM into a [start, end) range", () => {
    expect(resolveMonthRange("2026-09")).toEqual({ start: "2026-09-01", end: "2026-10-01" });
  });

  it("rolls December over into January of the following year", () => {
    expect(resolveMonthRange("2026-12")).toEqual({ start: "2026-12-01", end: "2027-01-01" });
  });

  it("handles a leap-year February correctly (end is still the 1st of March)", () => {
    expect(resolveMonthRange("2028-02")).toEqual({ start: "2028-02-01", end: "2028-03-01" });
  });

  it("rejects malformed input rather than guessing", () => {
    expect(resolveMonthRange("2026-9")).toBeNull(); // month must be 2 digits
    expect(resolveMonthRange("2026/09")).toBeNull();
    expect(resolveMonthRange("2026-13")).toBeNull(); // out of range
    expect(resolveMonthRange("2026-00")).toBeNull();
    expect(resolveMonthRange("")).toBeNull();
    expect(resolveMonthRange("not-a-month")).toBeNull();
  });
});

describe("computeAttendanceSummary", () => {
  it("counts each status and computes a rate where late counts as attended, excused is dropped from the denominator", () => {
    const summary = computeAttendanceSummary([
      { status: "present" }, { status: "present" }, { status: "present" },
      { status: "late" },
      { status: "absent" },
      { status: "excused" },
    ]);
    expect(summary).toEqual({
      present: 3, late: 1, absent: 1, excused: 1,
      countedTotal: 5, // present+late+absent, excused excluded
      attendanceRatePct: 80, // (3+1)/5
    });
  });

  it("defaults to 100% when there is no data yet, matching src/lib/studentStory.ts's convention", () => {
    expect(computeAttendanceSummary([]).attendanceRatePct).toBe(100);
  });

  it("is 100% when every record is excused (nothing counted against the student)", () => {
    const summary = computeAttendanceSummary([{ status: "excused" }, { status: "excused" }]);
    expect(summary.countedTotal).toBe(0);
    expect(summary.attendanceRatePct).toBe(100);
  });

  it("is 0% when every counted record is an unexcused absence", () => {
    const summary = computeAttendanceSummary([{ status: "absent" }, { status: "absent" }]);
    expect(summary.attendanceRatePct).toBe(0);
  });
});
