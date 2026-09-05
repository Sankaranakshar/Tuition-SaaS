// D-07 (MASTER_PLAN.md §5) / B-04: per-org credit expiry policy, stored at
// organizations.settings->creditExpiry. Pure, Zod-free logic (same rule as
// shared/cancellationPolicy.ts and shared/money.ts — a shared/ file that
// builds Zod schemas drags Zod into the client bundle) so the Settings UI
// and the expiry cron agree on exactly when a lot lapses instead of
// duplicating the FIFO walk on each side.
//
// The founder's decision (Step 8): a center opts in by setting a window in
// Settings; there is no platform default (credits stay immortal until an org
// configures this), no floor and no cap, and the clock runs from each
// top-up / purchase DATE, not from last activity. That last point is why
// this can't work off the scalar wallet balance — credit arrives as
// wallet_ledger rows ("lots"), each dated, and consumption has to be
// attributed FIFO to specific lots so the job knows how much of each dated
// lot is still unspent.

export interface CreditExpiryPolicy {
  enabled: boolean;
  windowDays: number;
}

// No platform default: an org that has never configured this keeps immortal
// credits, which is today's behaviour.
export const DEFAULT_CREDIT_EXPIRY_POLICY: CreditExpiryPolicy = { enabled: false, windowDays: 0 };

/**
 * Resolve a possibly-missing / possibly-partial `settings.creditExpiry` blob.
 * `enabled` is only ever true when the org explicitly set `enabled: true`
 * AND a positive whole-day window — a truthy toggle with a zero/garbage
 * window is treated as "not configured" rather than "expire everything now".
 * No floor and no cap are applied (founder chose neither).
 */
export function resolveCreditExpiryPolicy(raw: unknown): CreditExpiryPolicy {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const windowDays =
    typeof obj.windowDays === "number" && Number.isFinite(obj.windowDays) && obj.windowDays > 0
      ? Math.floor(obj.windowDays)
      : 0;
  const enabled = obj.enabled === true && windowDays > 0;
  return { enabled, windowDays };
}

// ---- FIFO lot walk --------------------------------------------------------

export interface LedgerRow {
  id: string;
  credits: number; // signed delta
  paise: number; // signed delta
  at: string | number | Date;
}

export type LotDenom = "credits" | "paise";

export interface ExpiredLot {
  lotLedgerId: string;
  denom: LotDenom;
  /** Positive magnitude of the unspent remainder to break. */
  amount: number;
  /** ISO date of the lot's originating top-up. */
  lotDate: string;
}

export interface ExpiryWarning {
  lotLedgerId: string;
  denom: LotDenom;
  /** Days before lapse this warning is for. */
  stage: 7 | 30;
  /** Positive magnitude still sitting in the lot. */
  remaining: number;
  /** ISO instant the lot lapses. */
  expiresAt: string;
}

export interface ExpiryComputation {
  expired: ExpiredLot[];
  warnings: ExpiryWarning[];
}

const DAY_MS = 86_400_000;

interface Delta {
  id: string;
  amount: number;
  at: number;
}

function runDenom(deltas: Delta[], windowMs: number, nowMs: number, denom: LotDenom): ExpiryComputation {
  // Open lots, oldest first (deltas arrive already sorted by date).
  const lots: { id: string; at: number; remaining: number }[] = [];

  for (const d of deltas) {
    if (d.amount > 0) {
      // Every positive delta is a fresh lot dated when it landed: a top-up,
      // an overpayment credited to the wallet, or the currency credited back
      // by an attendance reversal. A reversal starting a new lot resets the
      // clock on money that was just returned, which is the conservative
      // choice (it never expires credit the center just handed back).
      lots.push({ id: d.id, at: d.at, remaining: d.amount });
    } else if (d.amount < 0) {
      // Draw the debit down against the oldest open lots first. This also
      // consumes any credit_expiry row a previous run wrote — that lot's
      // remainder was already zeroed then, so replaying it here just keeps
      // the walk consistent and makes the job idempotent.
      let need = -d.amount;
      for (const lot of lots) {
        if (need <= 0) break;
        const take = Math.min(lot.remaining, need);
        lot.remaining -= take;
        need -= take;
      }
      // A debit that outruns every recorded lot means spend predating any
      // tracked top-up. Nothing to attribute it to; the leftover is dropped.
      // A genuinely broken balance is B-03's reconciliation job to surface,
      // not this one's to paper over.
    }
  }

  const expired: ExpiredLot[] = [];
  const warnings: ExpiryWarning[] = [];

  for (const lot of lots) {
    if (lot.remaining <= 0) continue;
    const expiresAtMs = lot.at + windowMs;
    if (expiresAtMs <= nowMs) {
      expired.push({
        lotLedgerId: lot.id,
        denom,
        amount: lot.remaining,
        lotDate: new Date(lot.at).toISOString(),
      });
      continue;
    }
    const msLeft = expiresAtMs - nowMs;
    // One warning per lot per stage: the 7-day window takes precedence so a
    // lot never fires both in the same run, and each stage fires once
    // regardless of how often the cron runs (the caller dedupes on
    // lotLedgerId + stage against notifications already written).
    if (msLeft <= 7 * DAY_MS) {
      warnings.push({ lotLedgerId: lot.id, denom, stage: 7, remaining: lot.remaining, expiresAt: new Date(expiresAtMs).toISOString() });
    } else if (msLeft <= 30 * DAY_MS) {
      warnings.push({ lotLedgerId: lot.id, denom, stage: 30, remaining: lot.remaining, expiresAt: new Date(expiresAtMs).toISOString() });
    }
  }

  return { expired, warnings };
}

/**
 * Given a wallet's full `wallet_ledger` history, the org's window, and the
 * current time, return the lots to break now and the lots to warn about.
 * `credits` and `paise` are tracked as independent FIFO queues since a
 * ledger row only ever carries one denomination.
 */
export function computeCreditExpiry(rows: LedgerRow[], windowDays: number, now: Date): ExpiryComputation {
  const sorted = [...rows].sort((a, b) => {
    const at = new Date(a.at).getTime() - new Date(b.at).getTime();
    if (at !== 0) return at;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });

  const windowMs = windowDays * DAY_MS;
  const nowMs = now.getTime();

  const credits = runDenom(
    sorted.map((r) => ({ id: r.id, amount: r.credits, at: new Date(r.at).getTime() })),
    windowMs,
    nowMs,
    "credits",
  );
  const paise = runDenom(
    sorted.map((r) => ({ id: r.id, amount: r.paise, at: new Date(r.at).getTime() })),
    windowMs,
    nowMs,
    "paise",
  );

  return {
    expired: [...credits.expired, ...paise.expired],
    warnings: [...credits.warnings, ...paise.warnings],
  };
}
