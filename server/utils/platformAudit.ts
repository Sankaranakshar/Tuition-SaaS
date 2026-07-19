import { supabaseAdmin } from "../supabaseAdmin.ts";

// Append-only log for privileged platform-admin actions (impersonation,
// feature-flag toggles from the super-admin console) — the platform's own
// record, separate from any org's `audit_events`. Written exclusively
// server-side; platform_admin_actions has no client insert policy.
export async function writePlatformAudit(
  actorId: string,
  action: string,
  opts: { targetOrganizationId?: string; targetUserId?: string; payload?: Record<string, unknown> } = {}
) {
  const { error } = await supabaseAdmin.from("platform_admin_actions").insert({
    actor_id: actorId,
    action,
    target_organization_id: opts.targetOrganizationId ?? null,
    target_user_id: opts.targetUserId ?? null,
    payload: opts.payload ?? {},
  });
  if (error) console.error("Failed to write platform admin audit event", error);
}
