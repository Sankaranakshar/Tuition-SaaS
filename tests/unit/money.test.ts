import { describe, it, expect } from "vitest";
import {
  agingBucket,
  groupOutstandingByPayer,
  selectionTotal,
  projectSessionsCovered,
  rankWalletsByDepletion,
  revenueTrend,
  collectionRate,
  revenueByLineItem,
  type MoneyInvoice,
  type MoneyStudent,
  type MoneyWallet,
} from "../../src/lib/money";

const NOW = new Date("2026-07-10T12:00:00Z");

describe("agingBucket (REDESIGN §6.4)", () => {
  it("buckets at the escalating-temperature thresholds", () => {
    expect(agingBucket(0)).toBe("current");
    expect(agingBucket(-5)).toBe("current");
    expect(agingBucket(1)).toBe("0-7");
    expect(agingBucket(7)).toBe("0-7");
    expect(agingBucket(8)).toBe("8-30");
    expect(agingBucket(30)).toBe("8-30");
    expect(agingBucket(31)).toBe("30+");
  });
});

const students: MoneyStudent[] = [
  { id: "s1", name: "Amy" },
  { id: "s2", name: "Zed" },
];

describe("groupOutstandingByPayer", () => {
  it("groups open invoices by student, dropping paid/void/fully-settled ones", () => {
    const invoices: MoneyInvoice[] = [
      { id: "i1", studentId: "s1", status: "unpaid", dueDate: "2026-07-01", totalPaise: 1000, paidPaise: 0 }, // 9d overdue
      { id: "i2", studentId: "s1", status: "paid", dueDate: "2026-06-01", totalPaise: 500, paidPaise: 500 },
      { id: "i3", studentId: "s2", status: "unpaid", dueDate: "2026-07-09", totalPaise: 2000, paidPaise: 0 }, // 1d overdue
      { id: "i4", studentId: "s2", status: "void", dueDate: "2026-06-01", totalPaise: 999, paidPaise: 0 },
    ];
    const groups = groupOutstandingByPayer(invoices, students, NOW);
    expect(groups.map((g) => g.studentId)).toEqual(["s1", "s2"]); // s1 worse overdue first
    expect(groups[0].lines).toHaveLength(1);
    expect(groups[0].totalOutstandingPaise).toBe(1000);
    expect(groups[0].maxDaysOverdue).toBe(9);
    expect(groups[1].lines[0].bucket).toBe("0-7");
  });

  it("ranks by total outstanding when max overdue ties", () => {
    const invoices: MoneyInvoice[] = [
      { id: "i1", studentId: "s1", status: "unpaid", dueDate: "2026-07-05", totalPaise: 500, paidPaise: 0 },
      { id: "i2", studentId: "s2", status: "unpaid", dueDate: "2026-07-05", totalPaise: 5000, paidPaise: 0 },
    ];
    const groups = groupOutstandingByPayer(invoices, students, NOW);
    expect(groups[0].studentId).toBe("s2");
  });
});

describe("selectionTotal", () => {
  it("sums only selected invoices across all groups", () => {
    const invoices: MoneyInvoice[] = [
      { id: "i1", studentId: "s1", status: "unpaid", dueDate: "2026-07-01", totalPaise: 1000, paidPaise: 0 },
      { id: "i2", studentId: "s2", status: "unpaid", dueDate: "2026-07-01", totalPaise: 2000, paidPaise: 500 },
    ];
    const groups = groupOutstandingByPayer(invoices, students, NOW);
    const result = selectionTotal(groups, new Set(["i1", "i2"]));
    expect(result).toEqual({ count: 2, totalPaise: 1000 + 1500 });
  });
});

describe("projectSessionsCovered", () => {
  it("prefers exact session-credit packs over a currency estimate", () => {
    const wallet: MoneyWallet = { studentId: "s1", studentName: "Amy", balanceCredits: 3, balanceCurrencyPaise: 100000 };
    expect(projectSessionsCovered(wallet, 50000)).toBe(3);
  });

  it("falls back to balance / average fee when there are no credit packs", () => {
    const wallet: MoneyWallet = { studentId: "s1", studentName: "Amy", balanceCredits: 0, balanceCurrencyPaise: 150000 };
    expect(projectSessionsCovered(wallet, 50000)).toBe(3);
  });

  it("returns null when there is nothing to project from", () => {
    const wallet: MoneyWallet = { studentId: "s1", studentName: "Amy", balanceCredits: 0, balanceCurrencyPaise: 100 };
    expect(projectSessionsCovered(wallet, 0)).toBeNull();
  });
});

describe("rankWalletsByDepletion", () => {
  it("sorts wallets closest to running out first and flags the low threshold", () => {
    const wallets: MoneyWallet[] = [
      { studentId: "s1", studentName: "Amy", balanceCredits: 5, balanceCurrencyPaise: 0 },
      { studentId: "s2", studentName: "Zed", balanceCredits: 1, balanceCurrencyPaise: 0 },
    ];
    const ranked = rankWalletsByDepletion(wallets, 0);
    expect(ranked.map((r) => r.wallet.studentId)).toEqual(["s2", "s1"]);
    expect(ranked[0].isLow).toBe(true);
    expect(ranked[1].isLow).toBe(false);
  });
});

describe("revenueTrend", () => {
  it("buckets collected payments by calendar month across a trailing window", () => {
    const payments = [
      { amountPaise: 1000, at: "2026-05-15T00:00:00Z" },
      { amountPaise: 2000, at: "2026-07-01T00:00:00Z" },
      { amountPaise: 500, at: "2026-07-09T00:00:00Z" },
    ];
    const trend = revenueTrend(payments, NOW, 3);
    expect(trend.map((t) => t.month)).toEqual(["2026-05", "2026-06", "2026-07"]);
    expect(trend[0].totalPaise).toBe(1000);
    expect(trend[1].totalPaise).toBe(0);
    expect(trend[2].totalPaise).toBe(2500);
  });
});

describe("collectionRate", () => {
  it("computes collected over collected+outstanding, ignoring void invoices", () => {
    const invoices: MoneyInvoice[] = [
      { id: "i1", status: "paid", totalPaise: 1000, paidPaise: 1000 },
      { id: "i2", status: "unpaid", totalPaise: 1000, paidPaise: 0 },
      { id: "i3", status: "void", totalPaise: 5000, paidPaise: 0 },
    ];
    expect(collectionRate(invoices)).toBe(50);
  });

  it("returns 0 when there is no money in play", () => {
    expect(collectionRate([])).toBe(0);
  });
});

describe("revenueByLineItem", () => {
  it("groups collected revenue by the first line item, ignoring void invoices", () => {
    const invoices: MoneyInvoice[] = [
      { id: "i1", status: "paid", totalPaise: 1000, paidPaise: 1000, items: [{ description: "Maths" }] },
      { id: "i2", status: "paid", totalPaise: 500, paidPaise: 500, items: [{ description: "Maths" }] },
      { id: "i3", status: "paid", totalPaise: 2000, paidPaise: 2000, items: [{ description: "Physics" }] },
      { id: "i4", status: "void", totalPaise: 9999, paidPaise: 0, items: [{ description: "Physics" }] },
      { id: "i5", status: "unpaid", totalPaise: 300, paidPaise: 0 },
    ];
    expect(revenueByLineItem(invoices)).toEqual([
      { label: "Physics", totalPaise: 2000 },
      { label: "Maths", totalPaise: 1500 },
    ]);
  });
});
