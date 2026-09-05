// D-07 (MASTER_PLAN.md §5) / B-04: per-org credit expiry policy, stored at
// organizations.settings->creditExpiry. The pure resolve + FIFO-walk logic
// lives in shared/creditExpiry.ts (so the Settings UI and this cron agree);
// this file adds only the DB-touching read, which is server-only — same
// split as server/utils/cancellationPolicy.ts.
import { supabaseAdmin } from "../supabaseAdmin.ts";
import {
  resolveCreditExpiryPolicy,
  DEFAULT_CREDIT_EXPIRY_POLICY,
  type CreditExpiryPolicy,
} from "../../shared/creditExpiry.ts";

export { resolveCreditExpiryPolicy, DEFAULT_CREDIT_EXPIRY_POLICY };
export type { CreditExpiryPolicy };

/** Reads an org's credit-expiry policy, defaulting to "never expires". */
export async function getCreditExpiryPolicy(orgId: string): Promise<CreditExpiryPolicy> {
  const { data, error } = await supabaseAdmin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  if (error) throw error;
  return resolveCreditExpiryPolicy((data?.settings as Record<string, unknown> | undefined)?.creditExpiry);
}
