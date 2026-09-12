import { describe, it, expect } from "vitest";
import { computeSessionEarningsPaise, computeTdsPaise } from "../../shared/payouts.ts";
import { resolvePayoutSettings, DEFAULT_PAYOUT_SETTINGS } from "../../shared/payoutSettings.ts";

describe("computeSessionEarningsPaise (B-08, EXECUTION_PLAN.md Step 21)", () => {
  it("computes hourly rate x duration", () => {
    expect(computeSessionEarningsPaise(50000, 60)).toBe(50000); // ₹500/hr, 60 min
    expect(computeSessionEarningsPaise(50000, 30)).toBe(25000); // half an hour
  });

  it("rounds to the nearest paisa", () => {
    expect(computeSessionEarningsPaise(10000, 45)).toBe(7500); // ₹100/hr, 45 min = 75
    expect(computeSessionEarningsPaise(33333, 20)).toBe(11111); // 33333 * 20/60 = 11111
  });

  it("is zero for a zero-length session or zero rate", () => {
    expect(computeSessionEarningsPaise(50000, 0)).toBe(0);
    expect(computeSessionEarningsPaise(0, 60)).toBe(0);
  });
});

describe("computeTdsPaise", () => {
  it("computes a percentage of the gross, rounded", () => {
    expect(computeTdsPaise(100000, 10)).toBe(10000);
    expect(computeTdsPaise(99999, 10)).toBe(10000); // rounds
  });

  it("is zero at 0% TDS", () => {
    expect(computeTdsPaise(100000, 0)).toBe(0);
  });
});

describe("resolvePayoutSettings (no platform default, same posture as D-07 credit expiry)", () => {
  it("defaults to 0% TDS when settings.payouts has never been configured", () => {
    expect(resolvePayoutSettings(undefined)).toEqual(DEFAULT_PAYOUT_SETTINGS);
    expect(resolvePayoutSettings(null)).toEqual(DEFAULT_PAYOUT_SETTINGS);
    expect(resolvePayoutSettings({})).toEqual(DEFAULT_PAYOUT_SETTINGS);
  });

  it("honors a configured tdsPercent", () => {
    expect(resolvePayoutSettings({ tdsPercent: 10 })).toEqual({ tdsPercent: 10 });
  });

  it("falls back to the default on a garbage value rather than inventing a number", () => {
    expect(resolvePayoutSettings({ tdsPercent: -5 })).toEqual(DEFAULT_PAYOUT_SETTINGS);
    expect(resolvePayoutSettings({ tdsPercent: "ten" })).toEqual(DEFAULT_PAYOUT_SETTINGS);
  });
});
