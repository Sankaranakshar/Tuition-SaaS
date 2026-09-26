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

describe("leaveDateRangeToTimestampBounds (B-13, C-01)", () => {
  const IST = "Asia/Kolkata";

  // A session is "in" the leave when it overlaps [start, end), the same test
  // server/routes/leave.ts's affected-sessions query applies.
  const overlaps = (bounds: { start: string; end: string }, startIso: string, endIso: string) =>
    new Date(startIso) < new Date(bounds.end) && new Date(endIso) > new Date(bounds.start);

  it("returns local-midnight [inclusive, exclusive) bounds for a same-day IST leave", () => {
    const bounds = leaveDateRangeToTimestampBounds("2026-09-15", "2026-09-15", IST);
    expect(bounds.start).toBe("2026-09-14T18:30:00.000Z"); // 00:00 IST on the 15th
    expect(bounds.end).toBe("2026-09-15T18:30:00.000Z"); // 00:00 IST on the 16th
  });

  it("spans a multi-day range end-exclusive on the local day after end_date", () => {
    const bounds = leaveDateRangeToTimestampBounds("2026-09-15", "2026-09-20", IST);
    expect(bounds.start).toBe("2026-09-14T18:30:00.000Z");
    expect(bounds.end).toBe("2026-09-20T18:30:00.000Z");
  });

  it("rolls the end bound over a month boundary correctly", () => {
    const bounds = leaveDateRangeToTimestampBounds("2026-09-29", "2026-09-30", IST);
    expect(bounds.end).toBe("2026-09-30T18:30:00.000Z"); // 00:00 IST on Oct 1
  });

  it("covers a 00:30 IST session on the leave day (missed by the old UTC-day bounds)", () => {
    const bounds = leaveDateRangeToTimestampBounds("2026-09-27", "2026-09-27", IST);
    // 00:30-01:30 IST on the 27th = 19:00-20:00 UTC on the 26th.
    expect(overlaps(bounds, "2026-09-26T19:00:00.000Z", "2026-09-26T20:00:00.000Z")).toBe(true);
  });

  it("excludes a 00:30 IST session the day after the leave (wrongly caught by the old UTC-day bounds)", () => {
    const bounds = leaveDateRangeToTimestampBounds("2026-09-27", "2026-09-27", IST);
    // 00:30-01:30 IST on the 28th = 19:00-20:00 UTC on the 27th.
    expect(overlaps(bounds, "2026-09-27T19:00:00.000Z", "2026-09-27T20:00:00.000Z")).toBe(false);
  });

  it("reads the zone argument, not the process zone (UTC org gets UTC midnights)", () => {
    const bounds = leaveDateRangeToTimestampBounds("2026-09-15", "2026-09-15", "UTC");
    expect(bounds.start).toBe("2026-09-15T00:00:00.000Z");
    expect(bounds.end).toBe("2026-09-16T00:00:00.000Z");
  });

  it("uses each day's own offset across a DST change (New York, 2026-03-08)", () => {
    const bounds = leaveDateRangeToTimestampBounds("2026-03-07", "2026-03-08", "America/New_York");
    expect(bounds.start).toBe("2026-03-07T05:00:00.000Z"); // EST, UTC-5
    expect(bounds.end).toBe("2026-03-09T04:00:00.000Z"); // EDT, UTC-4
  });
});
