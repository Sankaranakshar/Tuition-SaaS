import { randomBytes } from "node:crypto";
import { requireStagingEnv, BASE_URL, STAGING_REF, PRODUCTION_REF } from "./support/env";
import { sweepStale } from "./support/admin";

// Runs once per `playwright test` invocation, after the web server is up and
// before any worker starts. Workers inherit the E2E_RUN_ID set here.

const STALE_AFTER_MS = 2 * 60 * 60 * 1000;

export default async function globalSetup(): Promise<void> {
  requireStagingEnv();

  // Lowercase letters and digits only: it goes into email addresses and into
  // SQL LIKE patterns (where "_" and "%" would be wildcards).
  const ci = (process.env.GITHUB_RUN_ID || "local").replace(/[^a-z0-9]/gi, "").toLowerCase();
  process.env.E2E_RUN_ID = `${ci}${process.env.GITHUB_RUN_ATTEMPT || ""}x${randomBytes(3).toString("hex")}`;
  console.log(`[e2e] run ${process.env.E2E_RUN_ID} against ${BASE_URL}`);

  // A crashed or cancelled run never reaches its teardown. Anything suite-made
  // that is older than any run could plausibly still be using is removed here.
  const swept = await sweepStale(STALE_AFTER_MS);
  if (swept.orgs || swept.users) console.log(`[e2e] swept stale data: ${swept.orgs} orgs, ${swept.users} users`);

  // The browser talks to whichever Supabase project the SPA was *built*
  // against (Vite bakes VITE_* in at build time), which is independent of the
  // server env checked above. Prove the served bundle is the staging one.
  const html = await (await fetch(BASE_URL)).text();
  const entry = html.match(/src="(\/assets\/index-[^"]+\.js)"/)?.[1];
  if (!entry) throw new Error(`[e2e] could not find the SPA entry script at ${BASE_URL}`);
  const js = await (await fetch(new URL(entry, BASE_URL))).text();
  if (js.includes(PRODUCTION_REF) || !js.includes(STAGING_REF)) {
    throw new Error("[e2e] the served SPA was not built against classstackr-staging. Rebuild with the staging VITE_* env.");
  }
}
