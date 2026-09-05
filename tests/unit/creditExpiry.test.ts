import { describe, it, expect, beforeEach } from "vitest";
import {
  resolveCreditExpiryPolicy,
  DEFAULT_CREDIT_EXPIRY_POLICY,
  computeCreditExpiry,
  type LedgerRow,
} from "../../shared/creditExpiry.ts";

const DAY = 86_400_000;
const NOW = new Date("2026-06-01T00:00:00Z");
const at = (daysAgo: number) => new Date(NOW.getTime() - daysAgo * DAY).toISOString();

let seq = 0;
function topup(paise: number, daysAgo: number): LedgerRow {
  return { id: `L${String(++seq).padStart(4, "0")}`, credits: 0, paise, at: at(daysAgo) };
}
function debit(paise: number, daysAgo: number): LedgerRow {
  return { id: `L${String(++seq).padStart(4, "0")}`, credits: 0, paise: -paise, at: at(daysAgo) };
}
function creditPack(credits: number, daysAgo: number): LedgerRow {
  return { id: `L${String(++seq).padStart(4, "0")}`, credits, paise: 0, at: at(daysAgo) };
}

describe("resolveCreditExpiryPolicy (D-07)", () => {
  it("defaults to disabled when the key is missing entirely", () => {
    expect(resolveCreditExpiryPolicy(undefined)).toEqual(DEFAULT_CREDIT_EXPIRY_POLICY);
    expect(resolveCreditExpiryPolicy(null)).toEqual(DEFAULT_CREDIT_EXPIRY_POLICY);
  });

  it("stays disabled when toggled on but the window is zero or garbage", () => {
    expect(resolveCreditExpiryPolicy({ enabled: true, windowDays: 0 })).toEqual({ enabled: false, windowDays: 0 });
    expect(resolveCreditExpiryPolicy({ enabled: true, windowDays: -30 })).toEqual({ enabled: false, windowDays: 0 });
    expect(resolveCreditExpiryPolicy({ enabled: true, windowDays: "90" })).toEqual({ enabled: false, windowDays: 0 });
  });

  it("stays disabled when a window is set but the toggle is off", () => {
    expect(resolveCreditExpiryPolicy({ enabled: false, windowDays: 90 })).toEqual({ enabled: false, windowDays: 90 });
  });

  it("enables with a positive whole-day window, no floor or cap applied", () => {
    expect(resolveCreditExpiryPolicy({ enabled: true, windowDays: 1 })).toEqual({ enabled: true, windowDays: 1 });
    expect(resolveCreditExpiryPolicy({ enabled: true, windowDays: 90.7 })).toEqual({ enabled: true, windowDays: 90 });
    expect(resolveCreditExpiryPolicy({ enabled: true, windowDays: 100000 })).toEqual({ enabled: true, windowDays: 100000 });
  });
});

describe("computeCreditExpiry (B-04 FIFO lot walk)", () => {
  beforeEach(() => {
    seq = 0;
  });

  it("does nothing when no lot is older than the window", () => {
    const rows = [topup(50000, 10)];
    expect(computeCreditExpiry(rows, 90, NOW)).toEqual({ expired: [], warnings: [] });
  });

  it("expires the whole remainder of an untouched lot past its window", () => {
    const rows = [topup(50000, 100)];
    const { expired, warnings } = computeCreditExpiry(rows, 90, NOW);
    expect(warnings).toEqual([]);
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ lotLedgerId: "L0001", denom: "paise", amount: 50000 });
  });

  it("expires only the unspent remainder when a lot was partly consumed", () => {
    const rows = [topup(50000, 100), debit(30000, 50)];
    const { expired } = computeCreditExpiry(rows, 90, NOW);
    expect(expired).toHaveLength(1);
    expect(expired[0].amount).toBe(20000);
  });

  it("attributes debits FIFO — an old lot fully spent by a later debit is not expired", () => {
    const rows = [topup(50000, 100), topup(50000, 10), debit(50000, 5)];
    const { expired } = computeCreditExpiry(rows, 90, NOW);
    // The 5-day-ago debit drains the oldest (100-day-ago) lot first.
    expect(expired).toEqual([]);
  });

  it("leaves the newer lot alone while expiring the older one", () => {
    const rows = [topup(50000, 100), topup(40000, 10)];
    const { expired } = computeCreditExpiry(rows, 90, NOW);
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ lotLedgerId: "L0001", amount: 50000 });
  });

  it("is idempotent — replaying a prior run's credit_expiry debit expires nothing more", () => {
    const rows = [topup(50000, 100), { id: "L0002", credits: 0, paise: -50000, at: at(0) }];
    expect(computeCreditExpiry(rows, 90, NOW)).toEqual({ expired: [], warnings: [] });
  });

  it("fires a 30-day warning for a lot 25 days from lapse, not a 7-day one", () => {
    const rows = [topup(50000, 65)]; // window 90 → lapses in 25 days
    const { expired, warnings } = computeCreditExpiry(rows, 90, NOW);
    expect(expired).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatchObject({ stage: 30, remaining: 50000, denom: "paise" });
  });

  it("fires a 7-day warning for a lot 5 days from lapse", () => {
    const rows = [topup(50000, 85)]; // window 90 → lapses in 5 days
    const { warnings } = computeCreditExpiry(rows, 90, NOW);
    expect(warnings).toHaveLength(1);
    expect(warnings[0].stage).toBe(7);
  });

  it("does not warn about a lot still far from lapse", () => {
    const rows = [topup(50000, 30)]; // 60 days out
    expect(computeCreditExpiry(rows, 90, NOW).warnings).toEqual([]);
  });

  it("tracks credit packs and currency lots as independent FIFO queues", () => {
    const rows = [creditPack(10, 100), topup(50000, 100), debit(50000, 20)];
    const { expired } = computeCreditExpiry(rows, 90, NOW);
    // Currency lot fully spent; the credit pack still lapses.
    expect(expired).toHaveLength(1);
    expect(expired[0]).toMatchObject({ denom: "credits", amount: 10 });
  });
});
