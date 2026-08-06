import { describe, it, expect } from "vitest";
import { resolveCancellationPolicy, DEFAULT_CANCELLATION_POLICY } from "../../server/utils/cancellationPolicy.ts";

describe("resolveCancellationPolicy (D-08)", () => {
  it("falls back to the coded defaults when settings has no cancellation key at all", () => {
    expect(resolveCancellationPolicy(undefined)).toEqual(DEFAULT_CANCELLATION_POLICY);
  });

  it("falls back to the coded defaults for an org that has never saved settings", () => {
    expect(resolveCancellationPolicy(null)).toEqual(DEFAULT_CANCELLATION_POLICY);
  });

  it("uses the org's overrides when all three fields are set", () => {
    const policy = resolveCancellationPolicy({ freeHours: 12, lateFeePercent: 25, noShowForfeitPercent: 75 });
    expect(policy).toEqual({ freeHours: 12, lateFeePercent: 25, noShowForfeitPercent: 75 });
  });

  it("fills in missing fields individually rather than discarding the whole override", () => {
    const policy = resolveCancellationPolicy({ freeHours: 48 });
    expect(policy).toEqual({
      freeHours: 48,
      lateFeePercent: DEFAULT_CANCELLATION_POLICY.lateFeePercent,
      noShowForfeitPercent: DEFAULT_CANCELLATION_POLICY.noShowForfeitPercent,
    });
  });

  it("ignores non-numeric garbage and falls back to the default for that field", () => {
    const policy = resolveCancellationPolicy({ freeHours: "soon", lateFeePercent: 30, noShowForfeitPercent: NaN });
    expect(policy).toEqual({
      freeHours: DEFAULT_CANCELLATION_POLICY.freeHours,
      lateFeePercent: 30,
      noShowForfeitPercent: DEFAULT_CANCELLATION_POLICY.noShowForfeitPercent,
    });
  });
});
