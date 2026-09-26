import { pool } from "../db.ts";
import { validateEventProperties, type EventProperties, type ProductEventName } from "../../shared/analyticsEvents.ts";

// C-07 (EXECUTION_PLAN.md Step 32): the one way anything writes to
// product_events (D-11: our own Postgres, no third-party analytics).
//
// Enforces the payload rule written at the top of shared/analyticsEvents.ts
// before every insert: an event whose properties carry anything but record
// ids, counts, paise, booleans or fixed enum values is refused and not
// written, so no name, phone, message text or student/parent id can land in
// the table.
//
// Best-effort, like writeAudit: analytics must never fail the action it
// describes. Call it after the action's transaction has committed (never
// inside one, where a failed insert would abort the whole transaction), and
// it logs and swallows any failure, including the table not existing yet on
// a database this step's migration has not reached.

export interface TrackEventInput {
  organizationId: string | null;
  actorUserId?: string | null;
  name: ProductEventName;
  properties?: EventProperties;
  /** Makes the event land at most once; a repeat is silently skipped. */
  dedupeKey?: string;
  /** When it happened, if not now (the rollup records org.activated at the moment activation was reached). */
  occurredAt?: string;
}

export type TrackResult = "recorded" | "duplicate" | "refused" | "failed";

export async function trackEvent(input: TrackEventInput): Promise<TrackResult> {
  const properties = input.properties ?? {};
  const problem = validateEventProperties(input.name, properties);
  if (problem) {
    console.error(`product event ${input.name} refused by the payload rule: ${problem}`);
    return "refused";
  }
  if (input.organizationId === null && !input.name.startsWith("onboarding.")) {
    console.error(`product event ${input.name} refused: only onboarding events may be written without an org`);
    return "refused";
  }
  try {
    const res = await pool.query(
      `insert into product_events (organization_id, actor_user_id, name, properties, dedupe_key, occurred_at)
       values ($1, $2, $3, $4::jsonb, $5, coalesce($6::timestamptz, now()))
       on conflict do nothing`,
      [input.organizationId, input.actorUserId ?? null, input.name, JSON.stringify(properties), input.dedupeKey ?? null, input.occurredAt ?? null]
    );
    return (res.rowCount ?? 0) > 0 ? "recorded" : "duplicate";
  } catch (error) {
    console.error(`Failed to write product event ${input.name}`, error);
    return "failed";
  }
}

/** YYYY-MM-DD (UTC) for once-per-day dedupe keys. */
export function utcDayKey(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}
