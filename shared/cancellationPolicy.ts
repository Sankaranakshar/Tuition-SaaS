// D-08 (MASTER_PLAN.md §5): per-org cancellation/no-show policy, stored at
// organizations.settings->cancellation. Pure, Zod-free logic (no zod here,
// see HANDOFF rule on shared/ files that build zod schemas staying out of
// the client bundle, same convention as shared/money.ts) so the server's
// reversal route (server/utils/cancellationPolicy.ts) and the client-side
// disclosure (EXECUTION_PLAN.md Step 3) resolve the same defaults
// identically instead of duplicating the merge logic on each side.
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

/** The instant free cancellation ends for a session starting at `sessionStart`. */
export function cancellationCutoff(sessionStart: string | number | Date, freeHours: number): Date {
  return new Date(new Date(sessionStart).getTime() - freeHours * 60 * 60 * 1000);
}
