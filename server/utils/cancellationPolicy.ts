// D-08 (MASTER_PLAN.md §5): per-org cancellation/no-show policy, stored at
// organizations.settings->cancellation. One pure function so B-01's reversal
// route and any other caller resolve the same defaults identically and the
// logic is unit-testable without a database.
import { supabaseAdmin } from "../supabaseAdmin.ts";

export interface CancellationPolicy {
  freeHours: number;
  lateFeePercent: number;
  noShowForfeitPercent: number;
}

export const DEFAULT_CANCELLATION_POLICY: CancellationPolicy = {
  freeHours: 24,
  lateFeePercent: 50,
  noShowForfeitPercent: 100,
};

function coerce(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

/**
 * Merge a possibly-missing, possibly-partial `settings.cancellation` blob
 * with the founder-set defaults (D-08). Missing keys, a missing object, or
 * an org that has never saved settings at all all resolve to the same
 * per-field default rather than failing closed.
 */
export function resolveCancellationPolicy(cancellation: unknown): CancellationPolicy {
  const raw = cancellation && typeof cancellation === "object" ? (cancellation as Record<string, unknown>) : {};
  return {
    freeHours: coerce(raw.freeHours, DEFAULT_CANCELLATION_POLICY.freeHours),
    lateFeePercent: coerce(raw.lateFeePercent, DEFAULT_CANCELLATION_POLICY.lateFeePercent),
    noShowForfeitPercent: coerce(raw.noShowForfeitPercent, DEFAULT_CANCELLATION_POLICY.noShowForfeitPercent),
  };
}

/** Reads an org's cancellation policy, falling back to defaults field-by-field. */
export async function getCancellationPolicy(orgId: string): Promise<CancellationPolicy> {
  const { data, error } = await supabaseAdmin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  if (error) throw error;
  return resolveCancellationPolicy((data?.settings as Record<string, unknown> | undefined)?.cancellation);
}
