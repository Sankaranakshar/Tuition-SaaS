// B-08 (MASTER_PLAN.md §3 R2 / EXECUTION_PLAN.md Step 21): pure earnings/
// payout math, Zod-free (same rule as shared/money.ts) so it stays
// importable from the client bundle. Money is integer paise throughout
// (HANDOFF invariant #4).

/** A session's earnings: hourly rate x duration, rounded to the nearest paisa. */
export function computeSessionEarningsPaise(ratePaisePerHour: number, durationMinutes: number): number {
  return Math.round((ratePaisePerHour * durationMinutes) / 60);
}

/** TDS withheld from a gross payout amount, rounded to the nearest paisa. */
export function computeTdsPaise(grossPaise: number, tdsPercent: number): number {
  return Math.round((grossPaise * tdsPercent) / 100);
}
