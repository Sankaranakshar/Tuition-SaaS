import { pool } from "../db.ts";

// Append-only audit trail, written exclusively server-side (service_role) —
// no client insert policy exists on audit_events, matching the old
// Firestore-rules-enforced write path.
//
// Goes over `pg` rather than PostgREST: nearly every mutating route awaits
// this before responding, so an outbound HTTPS call to the Supabase REST API
// was tacked onto the tail of each one. Failures stay non-fatal (logged, not
// thrown) exactly as before — a write that succeeded should not 500 because
// its audit row didn't land.
/**
 * Who performed an audited action.
 *
 * A plain string is an auth.users uuid. Non-user actors — payment webhooks,
 * schedulers — cannot go in actor_id at all: the column is
 * `uuid references auth.users(id)`, so a tag like "razorpay_webhook" fails
 * the uuid cast and any invented uuid fails the foreign key. They are
 * recorded as actor_id = null plus a `systemActor` key on the payload.
 *
 * That payload key is what lets a reader tell a system action apart from a
 * user who was later deleted: actor_id is `on delete set null`, so null on
 * its own is ambiguous.
 */
export type AuditActor = string | { system: string };

export async function writeAudit(
  organizationId: string,
  actor: AuditActor,
  action: string,
  entityType: string,
  entityId: string,
  summary: Record<string, unknown>
) {
  const systemActor = typeof actor === "object" ? actor.system : null;
  try {
    await pool.query(
      `insert into audit_events (organization_id, actor_id, action, payload)
       values ($1, $2, $3, $4::jsonb)`,
      [
        organizationId,
        systemActor ? null : actor,
        action,
        // systemActor goes after ...summary so a caller's summary key can
        // never shadow it — the audit viewer reads it to label the row.
        JSON.stringify({ entityType, entityId, ...summary, ...(systemActor ? { systemActor } : {}) }),
      ]
    );
  } catch (error) {
    console.error("Failed to write audit event", error);
  }
}
