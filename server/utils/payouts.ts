// B-08 (EXECUTION_PLAN.md Step 21): DB-touching reads for the payouts route.
// The pure math/merge logic lives in shared/payouts.ts and
// shared/payoutSettings.ts (so the enforcement point here and any client
// rendering the same numbers agree), same split as
// server/utils/cancellationPolicy.ts / creditExpiry.ts.
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { resolvePayoutSettings, type PayoutSettings } from "../../shared/payoutSettings.ts";

export { DEFAULT_PAYOUT_SETTINGS } from "../../shared/payoutSettings.ts";
export type { PayoutSettings };

/** A tutor's configured hourly rate at this org, or 0 if never configured (closed by default). */
export async function getCompensationRatePaise(tutorId: string, organizationId: string): Promise<number> {
  const { data, error } = await supabaseAdmin
    .from("tutor_compensation_rates")
    .select("hourly_rate_paise")
    .eq("tutor_id", tutorId)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return data?.hourly_rate_paise ?? 0;
}

/** An org's payout settings (currently just TDS%), defaulting to 0% when never configured. */
export async function getPayoutSettings(organizationId: string): Promise<PayoutSettings> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("settings")
    .eq("id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return resolvePayoutSettings((data?.settings as Record<string, unknown> | null)?.payouts);
}
