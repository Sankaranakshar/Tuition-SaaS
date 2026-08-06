// D-08 (MASTER_PLAN.md §5): per-org cancellation/no-show policy, stored at
// organizations.settings->cancellation. The pure merge logic now lives in
// shared/cancellationPolicy.ts (Step 3, EXECUTION_PLAN.md) so the client's
// disclosure resolves the exact same defaults as this server-side reader
// instead of duplicating the fallback logic; this file adds only the
// DB-touching read, which is server-only.
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { resolveCancellationPolicy, DEFAULT_CANCELLATION_POLICY, type CancellationPolicy } from "../../shared/cancellationPolicy.ts";

export { resolveCancellationPolicy, DEFAULT_CANCELLATION_POLICY };
export type { CancellationPolicy };

/** Reads an org's cancellation policy, falling back to defaults field-by-field. */
export async function getCancellationPolicy(orgId: string): Promise<CancellationPolicy> {
  const { data, error } = await supabaseAdmin.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  if (error) throw error;
  return resolveCancellationPolicy((data?.settings as Record<string, unknown> | undefined)?.cancellation);
}
