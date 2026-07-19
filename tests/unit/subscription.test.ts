import { describe, it, expect } from "vitest";
import {
  usagePercent,
  isNearLimit,
  isOverLimit,
  formatPlanPrice,
  upgradeOptions,
  planLimitErrorMessage,
} from "../../src/lib/subscription";

describe("usagePercent", () => {
  it("computes a rounded percentage against the cap", () => {
    expect(usagePercent(3, 15)).toBe(20);
    expect(usagePercent(15, 15)).toBe(100);
  });

  it("never exceeds 100 even if over the cap", () => {
    expect(usagePercent(20, 15)).toBe(100);
  });

  it("is always 0 for an unlimited plan", () => {
    expect(usagePercent(500, null)).toBe(0);
  });
});

describe("isNearLimit / isOverLimit", () => {
  it("flags near-limit at 80% and above, but not once actually at the cap", () => {
    expect(isNearLimit(11, 15)).toBe(false); // 73%
    expect(isNearLimit(12, 15)).toBe(true); // 80%
    expect(isNearLimit(15, 15)).toBe(false); // at cap, "over" not "near"
  });

  it("flags over-limit only once at or past the cap", () => {
    expect(isOverLimit(14, 15)).toBe(false);
    expect(isOverLimit(15, 15)).toBe(true);
    expect(isOverLimit(16, 15)).toBe(true);
  });

  it("unlimited plans are never near or over", () => {
    expect(isNearLimit(10000, null)).toBe(false);
    expect(isOverLimit(10000, null)).toBe(false);
  });
});

describe("formatPlanPrice", () => {
  it("shows Free for a zero price", () => {
    expect(formatPlanPrice(0)).toBe("Free");
  });

  it("formats a paid plan as rupees per month", () => {
    expect(formatPlanPrice(149900)).toBe("₹1,499/mo");
  });
});

describe("upgradeOptions", () => {
  it("lists plans above the current one, in catalog order", () => {
    expect(upgradeOptions("free")).toEqual(["growth", "scale"]);
    expect(upgradeOptions("growth")).toEqual(["scale"]);
    expect(upgradeOptions("scale")).toEqual([]);
  });
});

describe("planLimitErrorMessage", () => {
  it("recognizes the trigger's error and returns a friendly message", () => {
    expect(planLimitErrorMessage("plan_limit_exceeded: this organization's plan allows 15 active students"))
      .toMatch(/upgrade/i);
  });

  it("returns null for unrelated errors", () => {
    expect(planLimitErrorMessage("duplicate key value violates unique constraint")).toBeNull();
    expect(planLimitErrorMessage(undefined)).toBeNull();
  });
});
