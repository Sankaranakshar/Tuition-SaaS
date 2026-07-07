import { describe, it, expect } from "vitest";
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
    expect(formatRelativeDays(new Date())).toBe("today");
    expect(formatRelativeDays(new Date(Date.now() + 86_400_000))).toBe("tomorrow");
  });
  it("counts past days", () => {
    expect(formatRelativeDays(new Date(Date.now() - 3 * 86_400_000))).toBe("3 days ago");
  });
});
