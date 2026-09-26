import { cleanupRun } from "./support/admin";

// Deletes every org and auth user this run created, pass or fail. If this
// never runs (a cancelled CI job), the next run's global setup sweeps it.
export default async function globalTeardown(): Promise<void> {
  const id = process.env.E2E_RUN_ID;
  if (!id) return;
  if (process.env.E2E_KEEP_DATA === "1") {
    console.log(`[e2e] E2E_KEEP_DATA=1: leaving run ${id}'s data in staging (the next run sweeps it after 2h)`);
    return;
  }
  const removed = await cleanupRun(id);
  console.log(`[e2e] cleaned up run ${id}: ${removed.orgs} orgs, ${removed.users} users`);
}
