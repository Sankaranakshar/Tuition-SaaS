// Pure derivations for the Money workspace (DEV_PLAN Epic 13 / Stage 2 item 3,
// REDESIGN §6.4). Same discipline as src/lib/today.ts and src/lib/people.ts:
// no React, no Supabase reads, every function takes plain data plus an
// explicit `now` so the whole module is unit-testable and the clock is
// injectable. Reuses today.ts's paise/overdue math rather than re-deriving it.

import { daysOverdue, invoiceOutstandingPaise, invoicePaidPaise, type TodayInvoice } from "./today";

export interface MoneyInvoice extends TodayInvoice {
  items?: { description: string }[];
}

export interface MoneyStudent {
  id: string;
  name: string;
  parentName?: string | null;
}

// ---- Outstanding, grouped by payer (REDESIGN §6.4) -------------------------

export type AgingBucket = "current" | "0-7" | "8-30" | "30+";

/** Matches the AgedBadge component's visual temperature thresholds. */
export function agingBucket(days: number): AgingBucket {
  if (days <= 0) return "current";
  if (days <= 7) return "0-7";
  if (days <= 30) return "8-30";
  return "30+";
}

export interface OutstandingLine {
  invoice: MoneyInvoice;
  outstandingPaise: number;
  daysOverdue: number;
  bucket: AgingBucket;
}

export interface PayerGroup {
  studentId: string;
  studentName: string;
  lines: OutstandingLine[];
  totalOutstandingPaise: number;
  maxDaysOverdue: number;
}

const OPEN_INVOICE = new Set(["unpaid", "partially_paid", "sent", "overdue", "pending"]);

/**
 * Open invoices grouped by payer (student), each line aged. Groups sort by
 * worst overdue first, then by amount outstanding — the payers who most need
 * a nudge float to the top of the Outstanding segment.
 */
export function groupOutstandingByPayer(
  invoices: MoneyInvoice[],
  students: MoneyStudent[],
  now: Date
): PayerGroup[] {
  const nameOf = new Map(students.map((s) => [s.id, s.name]));
  const byStudent = new Map<string, OutstandingLine[]>();

  for (const inv of invoices) {
    if (!inv.studentId) continue;
    if (!OPEN_INVOICE.has(inv.status || "")) continue;
    const outstandingPaise = invoiceOutstandingPaise(inv);
    if (outstandingPaise <= 0) continue;
    const days = daysOverdue(inv, now);
    const line: OutstandingLine = { invoice: inv, outstandingPaise, daysOverdue: days, bucket: agingBucket(days) };
    if (!byStudent.has(inv.studentId)) byStudent.set(inv.studentId, []);
    byStudent.get(inv.studentId)!.push(line);
  }

  const groups: PayerGroup[] = Array.from(byStudent.entries()).map(([studentId, lines]) => {
    lines.sort((a, b) => b.daysOverdue - a.daysOverdue);
    return {
      studentId,
      studentName: nameOf.get(studentId) || "Unknown student",
      lines,
      totalOutstandingPaise: lines.reduce((sum, l) => sum + l.outstandingPaise, 0),
      maxDaysOverdue: Math.max(...lines.map((l) => l.daysOverdue)),
    };
  });

  return groups.sort(
    (a, b) => b.maxDaysOverdue - a.maxDaysOverdue || b.totalOutstandingPaise - a.totalOutstandingPaise
  );
}

/** Sticky-footer selection total: "₹27,300 across 6 invoices" (REDESIGN §6.4). */
export function selectionTotal(
  groups: PayerGroup[],
  selectedInvoiceIds: Set<string>
): { count: number; totalPaise: number } {
  let count = 0;
  let totalPaise = 0;
  for (const group of groups) {
    for (const line of group.lines) {
      if (selectedInvoiceIds.has(line.invoice.id)) {
        count++;
        totalPaise += line.outstandingPaise;
      }
    }
  }
  return { count, totalPaise };
}

// ---- Wallets: projected depletion (REDESIGN §6.4) --------------------------

export interface MoneyWallet {
  studentId: string;
  studentName: string;
  balanceCredits: number;
  balanceCurrencyPaise: number;
}

const LOW_SESSIONS_THRESHOLD = 2;

/**
 * How many more sessions a wallet covers. Session-credit packs are exact;
 * a rupee balance is divided by the org's average per-session fee. Returns
 * null when neither credits nor a usable average fee are available — the UI
 * should render that as "balance only", not a guess.
 */
export function projectSessionsCovered(wallet: MoneyWallet, avgSessionFeePaise: number): number | null {
  if (wallet.balanceCredits > 0) return wallet.balanceCredits;
  if (avgSessionFeePaise > 0) return Math.floor(wallet.balanceCurrencyPaise / avgSessionFeePaise);
  return null;
}

export interface RankedWallet {
  wallet: MoneyWallet;
  sessionsCovered: number | null;
  isLow: boolean;
}

/** Wallets sorted so the ones closest to running out (and threshold alerts) come first. */
export function rankWalletsByDepletion(wallets: MoneyWallet[], avgSessionFeePaise: number): RankedWallet[] {
  return wallets
    .map((wallet): RankedWallet => {
      const sessionsCovered = projectSessionsCovered(wallet, avgSessionFeePaise);
      return { wallet, sessionsCovered, isLow: sessionsCovered !== null && sessionsCovered < LOW_SESSIONS_THRESHOLD };
    })
    .sort((a, b) => (a.sessionsCovered ?? Infinity) - (b.sessionsCovered ?? Infinity));
}

// ---- Insights (REDESIGN §6.4) -----------------------------------------------

export interface MoneyPayment {
  amountPaise: number;
  at: string; // ISO
}

export interface MonthlyRevenue {
  month: string; // "2026-07"
  totalPaise: number;
}

function monthKey(iso: string): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

/** Collected revenue per calendar month, oldest first, for a trailing window. */
export function revenueTrend(payments: MoneyPayment[], now: Date, months = 6): MonthlyRevenue[] {
  const buckets: MonthlyRevenue[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    buckets.push({ month: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, totalPaise: 0 });
  }
  const byMonth = new Map(buckets.map((b) => [b.month, b]));
  for (const p of payments) {
    const bucket = byMonth.get(monthKey(p.at));
    if (bucket) bucket.totalPaise += p.amountPaise;
  }
  return buckets;
}

/** Collected / (collected + outstanding), across non-void invoices, as a whole percentage. */
export function collectionRate(invoices: MoneyInvoice[]): number {
  let collected = 0;
  let outstanding = 0;
  for (const inv of invoices) {
    if (inv.status === "void") continue;
    collected += invoicePaidPaise(inv);
    outstanding += invoiceOutstandingPaise(inv);
  }
  const total = collected + outstanding;
  return total > 0 ? Math.round((collected / total) * 100) : 0;
}

export interface LineItemRevenue {
  label: string;
  totalPaise: number;
}

/** Collected revenue grouped by each invoice's first line-item description — a proxy for "revenue by class type" until invoices carry a real class_type link. */
export function revenueByLineItem(invoices: MoneyInvoice[]): LineItemRevenue[] {
  const byLabel = new Map<string, number>();
  for (const inv of invoices) {
    if (inv.status === "void") continue;
    const paid = invoicePaidPaise(inv);
    if (paid <= 0) continue;
    const label = inv.items?.[0]?.description?.trim() || "General tuition";
    byLabel.set(label, (byLabel.get(label) || 0) + paid);
  }
  return Array.from(byLabel, ([label, totalPaise]) => ({ label, totalPaise })).sort(
    (a, b) => b.totalPaise - a.totalPaise
  );
}
