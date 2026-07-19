import { PLAN_CATALOG, type PlanId } from "../../shared/plans";
import { formatPaise } from "./format";

export { PLAN_CATALOG };
export type { PlanId };

const NEAR_LIMIT_THRESHOLD = 0.8;

/** Percentage of the plan's student cap in use, 0-100. Unlimited plans are always 0 (never "near" anything). */
export function usagePercent(activeStudentCount: number, studentLimit: number | null): number {
  if (studentLimit === null || studentLimit <= 0) return 0;
  return Math.min(100, Math.round((activeStudentCount / studentLimit) * 100));
}

export function isNearLimit(activeStudentCount: number, studentLimit: number | null): boolean {
  if (studentLimit === null) return false;
  return activeStudentCount / studentLimit >= NEAR_LIMIT_THRESHOLD && activeStudentCount < studentLimit;
}

export function isOverLimit(activeStudentCount: number, studentLimit: number | null): boolean {
  if (studentLimit === null) return false;
  return activeStudentCount >= studentLimit;
}

export function formatPlanPrice(pricePaise: number): string {
  return pricePaise === 0 ? "Free" : `${formatPaise(pricePaise)}/mo`;
}

/** Plans priced above the given plan, in catalog order — the upgrade path shown in the UI. */
export function upgradeOptions(currentPlan: PlanId): PlanId[] {
  const order: PlanId[] = ["free", "growth", "scale"];
  const idx = order.indexOf(currentPlan);
  return idx === -1 ? order : order.slice(idx + 1);
}

/**
 * Turns the plan-limit trigger's Postgres error message
 * ("plan_limit_exceeded: ...") into a friendly, user-facing string. Returns
 * null if the error isn't a plan-limit rejection, so callers can fall back
 * to their normal error handling.
 */
export function planLimitErrorMessage(errorMessage: string | undefined | null): string | null {
  if (!errorMessage || !errorMessage.includes("plan_limit_exceeded")) return null;
  return "You've reached your plan's active-student limit. Upgrade in Settings → Plan & Billing to add more.";
}
