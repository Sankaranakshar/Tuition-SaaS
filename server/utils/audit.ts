import { supabaseAdmin } from "../supabaseAdmin.ts";

// Append-only audit trail, written exclusively server-side (service_role) —
// no client insert policy exists on audit_events, matching the old
// Firestore-rules-enforced write path.
export async function writeAudit(
  organizationId: string,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: Record<string, unknown>
) {
  const { error } = await supabaseAdmin.from("audit_events").insert({
    organization_id: organizationId,
    actor_id: actorUserId,
    action,
    payload: { entityType, entityId, ...summary },
  });
  if (error) console.error("Failed to write audit event", error);
}
