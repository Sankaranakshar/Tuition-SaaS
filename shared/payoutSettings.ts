// B-08: per-org payout settings, stored at organizations.settings->payouts.
// Pure, Zod-free logic (same convention as shared/cancellationPolicy.ts /
// shared/creditExpiry.ts) so the Settings UI and the payout-run route agree
// on the same default instead of duplicating the merge logic on each side.
//
// No platform-default TDS percentage: an org that has never configured this
// runs payouts at 0% TDS, the same "opt-in, no invented number" posture
// D-07 (§5) chose for credit expiry.
export interface PayoutSettings {
  tdsPercent: number;
}

export const DEFAULT_PAYOUT_SETTINGS: PayoutSettings = { tdsPercent: 0 };

/** Merge a possibly-missing, possibly-partial `settings.payouts` blob with the closed-by-default fallback. */
export function resolvePayoutSettings(payouts: unknown): PayoutSettings {
  const raw = payouts && typeof payouts === "object" ? (payouts as Record<string, unknown>) : {};
  const tdsPercent =
    typeof raw.tdsPercent === "number" && Number.isFinite(raw.tdsPercent) && raw.tdsPercent >= 0
      ? raw.tdsPercent
      : DEFAULT_PAYOUT_SETTINGS.tdsPercent;
  return { tdsPercent };
}
