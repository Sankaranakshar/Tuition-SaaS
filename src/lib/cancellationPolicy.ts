import { supabase } from "../supabase";
import { resolveCancellationPolicy, type CancellationPolicy } from "../../shared/cancellationPolicy";

export type { CancellationPolicy };

// Step 3 (EXECUTION_PLAN.md): the client-side read of D-08's per-org policy,
// mirroring server/utils/cancellationPolicy.ts's getCancellationPolicy() but
// through the client's own RLS-gated `organizations` select (org_select:
// any org member, including a parent, can read; org_update stays owner/
// admin-only) rather than the service-role Express route, since this is a
// read-only disclosure, not a money mutation.
export async function getOrgCancellationPolicy(orgId: string): Promise<CancellationPolicy> {
  const { data, error } = await supabase.from("organizations").select("settings").eq("id", orgId).maybeSingle();
  if (error) throw error;
  return resolveCancellationPolicy((data?.settings as Record<string, unknown> | undefined)?.cancellation);
}
