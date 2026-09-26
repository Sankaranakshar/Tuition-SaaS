import { expect, test } from "@playwright/test";
import { admin } from "./admin";

// Step 32 (C-07): reading product_events on staging, for the journeys that
// assert which events they emit.
//
// This suite always runs against classstackr-staging, and a migration
// reaches staging only when the founder applies it. Until
// 20260926130000_product_analytics.sql is there, the event checks are
// skipped, loudly (a test annotation and a console line on every run), and
// everything else in each journey still runs. The moment the table exists
// the checks run and fail like any other assertion; nothing needs switching
// back on.

let present: boolean | null = null;

export async function analyticsMigrated(): Promise<boolean> {
  if (present !== null) return present;
  // A plain GET, not a HEAD request: PostgREST answers HEAD for a missing
  // table with a bodiless 404, which supabase-js does not report as an error.
  const { data, error } = await admin().from("product_events").select("id").limit(1);
  if (!error && Array.isArray(data)) return (present = true);
  // PostgREST's "table not in the schema cache" / Postgres's "relation does not exist".
  if (error && (error.code === "PGRST205" || error.code === "42P01")) return (present = false);
  throw new Error(`E2E: checking for product_events failed: ${JSON.stringify(error)}`);
}

/** Runs `checks` if staging has the analytics tables; otherwise records why they were skipped. */
export async function whenAnalyticsMigrated(what: string, checks: () => Promise<void>): Promise<void> {
  if (!(await analyticsMigrated())) {
    const note = `${what}: skipped, product_events is not on staging yet (apply Step 32's migration there)`;
    test.info().annotations.push({ type: "analytics-skipped", description: note });
    console.log(`[e2e] ${note}`);
    return;
  }
  await checks();
}

export interface EventRow {
  organization_id: string | null;
  actor_user_id: string | null;
  name: string;
  properties: Record<string, unknown>;
}

export async function productEvents(filter: { organizationId?: string; actorUserId?: string; name?: string }): Promise<EventRow[]> {
  let q = admin().from("product_events").select("organization_id, actor_user_id, name, properties").order("occurred_at");
  if (filter.organizationId) q = q.eq("organization_id", filter.organizationId);
  if (filter.actorUserId) q = q.eq("actor_user_id", filter.actorUserId);
  if (filter.name) q = q.eq("name", filter.name);
  const { data, error } = await q;
  if (error) throw new Error(`E2E: reading product_events failed: ${JSON.stringify(error)}`);
  return data as EventRow[];
}

/** Waits for fire-and-forget browser events to land, then returns them. */
export async function eventuallyEvents(
  filter: Parameters<typeof productEvents>[0],
  atLeast: number,
): Promise<EventRow[]> {
  let rows: EventRow[] = [];
  await expect.poll(async () => (rows = await productEvents(filter)).length, { timeout: 10_000 }).toBeGreaterThanOrEqual(atLeast);
  return rows;
}
