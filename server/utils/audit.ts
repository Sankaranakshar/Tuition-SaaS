import { adminDb } from "../firebaseAdmin.ts";

// Append-only audit trail, written exclusively server-side.
// Firestore rules expose no client write path to audit_events.
export async function writeAudit(
  organizationId: string,
  actorUserId: string,
  action: string,
  entityType: string,
  entityId: string,
  summary: Record<string, unknown>
) {
  if (!adminDb) return;
  await adminDb.collection("audit_events").add({
    organizationId,
    actorUserId,
    action,
    entityType,
    entityId,
    summary,
    at: new Date(),
  });
}
