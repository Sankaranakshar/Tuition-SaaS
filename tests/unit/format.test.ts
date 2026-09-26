import { describe, it, expect, vi, afterEach } from "vitest";
import { formatINR, formatPaise, formatRelativeDays } from "../../src/lib/format";

describe("money formatting", () => {
  it("renders rupees with Indian digit grouping", () => {
    expect(formatINR(123450)).toContain("1,23,450");
    expect(formatINR(123450)).toContain("₹");
  });
  it("never renders a dollar sign", () => {
    expect(formatINR(99.5)).not.toContain("$");
    expect(formatPaise(9950)).not.toContain("$");
  });
  it("converts paise to rupees exactly", () => {
    expect(formatPaise(300000)).toContain("3,000");
    expect(formatPaise(1)).toContain("0.01");
  });
  it("handles null/undefined as zero", () => {
    expect(formatINR(undefined)).toContain("0");
    expect(formatPaise(null)).toContain("0");
  });
});

describe("relative dates", () => {
  it("labels today and tomorrow", () => {
    expect(formatRelativeDays(new Date(), "UTC")).toBe("today");
    expect(formatRelativeDays(new Date(Date.now() + 86_400_000), "UTC")).toBe("tomorrow");
  });
  it("counts past days", () => {
    expect(formatRelativeDays(new Date(Date.now() - 3 * 86_400_000), "UTC")).toBe("3 days ago");
  });
});

// C-01 follow-up (2026-09-27): relative days count the org's calendar. The
// system clock is pinned so the only thing that can differ is the zone.
describe("relative dates near midnight (C-01)", () => {
  afterEach(() => vi.useRealTimers());

  it("a 00:30 IST class is tomorrow in IST at 23:30, and today in New York", () => {
    const now = new Date("2026-07-07T18:00:00Z"); // 23:30 IST, 14:00 New York
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const start = new Date("2026-07-07T19:00:00Z"); // 00:30 IST 8 Jul, 15:00 New York 7 Jul
    expect(formatRelativeDays(start, "Asia/Kolkata", now)).toBe("tomorrow");
    expect(formatRelativeDays(start, "America/New_York", now)).toBe("today");
  });

  it("a 23:30 New York class is today there and tomorrow in IST", () => {
    const now = new Date("2026-07-07T16:00:00Z"); // 12:00 New York, 21:30 IST
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const start = new Date("2026-07-08T03:30:00Z"); // 23:30 New York 7 Jul, 09:00 IST 8 Jul
    expect(formatRelativeDays(start, "America/New_York", now)).toBe("today");
    expect(formatRelativeDays(start, "Asia/Kolkata", now)).toBe("tomorrow");
  });
});
