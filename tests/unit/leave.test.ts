import { describe, it, expect } from "vitest";
import { isValidLeaveRange, leaveDateRangeToTimestampBounds } from "../../shared/leave.ts";

describe("isValidLeaveRange (B-13)", () => {
  it("accepts a same-day leave request", () => {
    expect(isValidLeaveRange("2026-09-15", "2026-09-15")).toBe(true);
  });

  it("accepts a multi-day range", () => {
    expect(isValidLeaveRange("2026-09-15", "2026-09-20")).toBe(true);
  });

  it("rejects an end date before the start date", () => {
    expect(isValidLeaveRange("2026-09-20", "2026-09-15")).toBe(false);
  });

  it("handles a range spanning a month/year rollover", () => {
    expect(isValidLeaveRange("2026-12-30", "2027-01-02")).toBe(true);
  });

  it("rejects malformed dates instead of coercing them", () => {
    expect(isValidLeaveRange("not-a-date", "2026-09-15")).toBe(false);
    expect(isValidLeaveRange("2026-09-15", "also-not-a-date")).toBe(false);
  });
});

describe("leaveDateRangeToTimestampBounds (B-13)", () => {
  it("returns an [inclusive, exclusive) bound covering the full end date", () => {
    const bounds = leaveDateRangeToTimestampBounds("2026-09-15", "2026-09-15");
    expect(bounds.start).toBe("2026-09-15T00:00:00.000Z");
    expect(bounds.end).toBe("2026-09-16T00:00:00.000Z");
  });

  it("spans a multi-day range end-exclusive on the day after end_date", () => {
    const bounds = leaveDateRangeToTimestampBounds("2026-09-15", "2026-09-20");
    expect(bounds.start).toBe("2026-09-15T00:00:00.000Z");
    expect(bounds.end).toBe("2026-09-21T00:00:00.000Z");
  });

  it("rolls the end bound over a month boundary correctly", () => {
    const bounds = leaveDateRangeToTimestampBounds("2026-09-29", "2026-09-30");
    expect(bounds.end).toBe("2026-10-01T00:00:00.000Z");
  });
});
