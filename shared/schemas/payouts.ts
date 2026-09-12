import { z } from "zod";

// Request/response contracts for server/routes/payouts.ts (B-08,
// EXECUTION_PLAN.md Step 21). Money fields are paise (integer) throughout,
// same rule as shared/schemas/billing.ts.

export const setCompensationRateRequestSchema = z.object({
  hourlyRatePaise: z.number().int().nonnegative(),
});
export type SetCompensationRateRequest = z.infer<typeof setCompensationRateRequestSchema>;

export const runPayoutRequestSchema = z.object({
  tutorId: z.string().uuid(),
  periodStart: z.string(), // ISO date, e.g. "2026-09-01"
  periodEnd: z.string(),   // ISO date, exclusive
});
export type RunPayoutRequest = z.infer<typeof runPayoutRequestSchema>;

export interface TutorRateRow {
  tutorId: string;
  hourlyRatePaise: number;
}

export interface EarningsLedgerRow {
  id: string;
  sessionId: string;
  sessionStart: string;
  durationMinutes: number;
  ratePaisePerHour: number;
  amountPaise: number;
  payoutId: string | null;
}

export interface PayoutRun {
  id: string;
  tutorId: string;
  periodStart: string;
  periodEnd: string;
  grossPaise: number;
  tdsPercent: number;
  tdsPaise: number;
  netPaise: number;
  status: "issued" | "paid";
  paidAt: string | null;
  createdAt: string;
}
