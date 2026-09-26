import { describe, it, expect } from "vitest";
import {
  DEFAULT_ORG_TIMEZONE,
  zonedTimeToUtc,
  localDateKeyInZone,
  hourInZone,
  dayOfWeekInZone,
  civilDateSentinelInZone,
  civilDateKey,
  monthKeyInZone,
} from "../../shared/timezone.ts";

// C-01 (MASTER_PLAN.md §6.3, EXECUTION_PLAN.md Step 25). The whole point of
// this suite: every assertion here is computed from explicit zone
// arguments and UTC-based Date construction, never from `new Date()`
// wall-clock methods (getHours/getDate/setHours) or `process.env.TZ`. That
// means the file must pass identically no matter what timezone the test
// runner's own process happens to be in — verified by actually running
// `npx vitest run tests/unit/timezone.test.ts` under both `TZ=UTC` and
// `TZ=Asia/Kolkata` and diffing the output.

describe("DEFAULT_ORG_TIMEZONE", () => {
  it("is Asia/Kolkata, matching the migration's column default", () => {
    expect(DEFAULT_ORG_TIMEZONE).toBe("Asia/Kolkata");
  });
});

describe("zonedTimeToUtc", () => {
  it("IST (UTC+5:30, no DST): a 6:30pm class is 13:00 UTC the same day", () => {
    const instant = zonedTimeToUtc(2026, 7, 10, 18, 30, "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-07-10T13:00:00.000Z");
  });

  it("UTC: the wall-clock time and the UTC instant are identical", () => {
    const instant = zonedTimeToUtc(2026, 7, 10, 18, 30, "UTC");
    expect(instant.toISOString()).toBe("2026-07-10T18:30:00.000Z");
  });

  it("midnight boundary: 00:00 IST is the previous UTC calendar day", () => {
    const instant = zonedTimeToUtc(2026, 7, 10, 0, 0, "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-07-09T18:30:00.000Z");
  });

  it("23:30 boundary: 23:30 IST stays on the same UTC calendar day", () => {
    const instant = zonedTimeToUtc(2026, 7, 10, 23, 30, "Asia/Kolkata");
    expect(instant.toISOString()).toBe("2026-07-10T18:00:00.000Z");
  });

  it("a DST zone: the same 6:30pm wall-clock time resolves to different UTC offsets across a DST transition", () => {
    // America/New_York: EDT (UTC-4) in summer, EST (UTC-5) in winter. This
    // schema doesn't serve a DST zone today, but the helper must not assume
    // a fixed offset for one — a hand-rolled "always UTC-5" table would
    // silently misplace every summer session by an hour.
    const summer = zonedTimeToUtc(2026, 7, 10, 18, 30, "America/New_York"); // EDT, UTC-4
    const winter = zonedTimeToUtc(2026, 1, 10, 18, 30, "America/New_York"); // EST, UTC-5
    expect(summer.toISOString()).toBe("2026-07-10T22:30:00.000Z");
    expect(winter.toISOString()).toBe("2026-01-10T23:30:00.000Z");
  });
});

describe("localDateKeyInZone", () => {
  it("reads the calendar date a clock in the zone would show, not the instant's own UTC date", () => {
    // 2026-07-09T19:00:00Z is 2026-07-10T00:30 IST — an early-morning IST
    // session whose UTC calendar date is the day *before* its IST one. This
    // is exactly the boundary case the old ambient-TZ getFullYear/getMonth/
    // getDate implementation could get wrong depending on the host's zone.
    const instant = new Date("2026-07-09T19:00:00.000Z");
    expect(localDateKeyInZone(instant, "Asia/Kolkata")).toBe("2026-07-10");
    expect(localDateKeyInZone(instant, "UTC")).toBe("2026-07-09");
  });

  it("agrees with zonedTimeToUtc's own construction (round-trip)", () => {
    const instant = zonedTimeToUtc(2026, 12, 25, 18, 30, "Asia/Kolkata");
    expect(localDateKeyInZone(instant, "Asia/Kolkata")).toBe("2026-12-25");
  });
});

describe("monthKeyInZone", () => {
  it("reads the month a clock in the zone would show, on both sides of UTC", () => {
    // 00:00 UTC on 1 Jul is 05:30 1 Jul IST but 20:00 30 Jun EDT.
    const instant = new Date("2026-07-01T00:00:00.000Z");
    expect(monthKeyInZone(instant, "Asia/Kolkata")).toBe("2026-07");
    expect(monthKeyInZone(instant, "UTC")).toBe("2026-07");
    expect(monthKeyInZone(instant, "America/New_York")).toBe("2026-06");
  });
});

describe("hourInZone", () => {
  it("reads the hour a clock in the zone would show for a given instant", () => {
    const instant = zonedTimeToUtc(2026, 7, 10, 18, 30, "Asia/Kolkata");
    expect(hourInZone(instant, "Asia/Kolkata")).toBe(18);
    expect(hourInZone(instant, "UTC")).toBe(13);
  });
});

describe("dayOfWeekInZone", () => {
  it("matches Date#getDay()'s 0=Sunday convention, evaluated in the given zone", () => {
    // 2026-07-10 is a Friday.
    const instant = zonedTimeToUtc(2026, 7, 10, 18, 30, "Asia/Kolkata");
    expect(dayOfWeekInZone(instant, "Asia/Kolkata")).toBe(5); // Friday, IST view
    // The same instant, viewed from UTC (13:00), is still Friday...
    expect(dayOfWeekInZone(instant, "UTC")).toBe(5);
    // ...but the midnight-boundary instant from the localDateKeyInZone test
    // above genuinely disagrees across zones: 2026-07-09T19:00Z is Thursday
    // in UTC but already Friday in IST.
    const boundary = new Date("2026-07-09T19:00:00.000Z");
    expect(dayOfWeekInZone(boundary, "UTC")).toBe(4); // Thursday
    expect(dayOfWeekInZone(boundary, "Asia/Kolkata")).toBe(5); // Friday
  });
});

describe("civilDateSentinelInZone / civilDateKey", () => {
  it("returns a UTC-midnight sentinel for the zone's civil date, independent of the instant's own time", () => {
    // Same early-morning IST boundary instant as above: the org's "today"
    // at that moment is 2026-07-10 in IST, 2026-07-09 in UTC.
    const now = new Date("2026-07-09T19:00:00.000Z");
    const sentinel = civilDateSentinelInZone("Asia/Kolkata", now);
    expect(civilDateKey(sentinel)).toBe("2026-07-10");
    expect(civilDateSentinelInZone("UTC", now) && civilDateKey(civilDateSentinelInZone("UTC", now))).toBe("2026-07-09");
  });

  it("sentinel arithmetic walks calendar days safely with setUTCDate, regardless of the host's own zone", () => {
    const sentinel = civilDateSentinelInZone("Asia/Kolkata", new Date("2026-07-10T00:30:00.000Z"));
    const next = new Date(sentinel);
    next.setUTCDate(next.getUTCDate() + 1);
    // Advancing by exactly one calendar day never lands on a fractional
    // offset or skips/repeats a day — the sentinel is always UTC midnight.
    expect(next.getTime() - sentinel.getTime()).toBe(24 * 3600 * 1000);
  });
});
