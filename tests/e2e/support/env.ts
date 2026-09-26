// Environment for the Playwright suite (EXECUTION_PLAN.md Step 31).
//
// The suite creates and deletes real auth users and organizations, so it must
// never run against production. Every entry point (config, global setup, the
// fixture client) goes through requireStagingEnv(), which refuses to continue
// unless every Supabase and Postgres credential names the classstackr-staging
// project ref. The production ref is also named explicitly so a copy-pasted
// production value fails loudly rather than by omission.

export const STAGING_REF = "fcshxorkxsaerwnuqrjh";
export const PRODUCTION_REF = "cwugpiernnwrhcximjwh";

export const E2E_PORT = Number(process.env.E2E_PORT) || 3201;
export const BASE_URL = process.env.E2E_BASE_URL || `http://localhost:${E2E_PORT}`;

export interface StagingEnv {
  supabaseUrl: string;
  anonKey: string;
  serviceRoleKey: string;
  databaseUrl: string;
}

export function requireStagingEnv(): StagingEnv {
  const env = {
    supabaseUrl: process.env.SUPABASE_URL || "",
    anonKey: process.env.VITE_SUPABASE_ANON_KEY || "",
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || "",
    databaseUrl: process.env.DATABASE_URL || "",
  };
  const missing = Object.entries({
    SUPABASE_URL: env.supabaseUrl,
    VITE_SUPABASE_URL: process.env.VITE_SUPABASE_URL || "",
    VITE_SUPABASE_ANON_KEY: env.anonKey,
    SUPABASE_SERVICE_ROLE_KEY: env.serviceRoleKey,
    DATABASE_URL: env.databaseUrl,
  })
    .filter(([, v]) => !v)
    .map(([k]) => k);
  if (missing.length > 0) {
    throw new Error(
      `E2E: missing ${missing.join(", ")}. Locally, run through ` +
        "`npx dotenvx run -f .env.staging -- npm run test:e2e`; in CI these come from the STAGING_* GitHub secrets.",
    );
  }
  for (const [name, value] of [
    ["SUPABASE_URL", env.supabaseUrl],
    ["VITE_SUPABASE_URL", process.env.VITE_SUPABASE_URL || ""],
    ["DATABASE_URL", env.databaseUrl],
  ] as const) {
    if (value.includes(PRODUCTION_REF) || !value.includes(STAGING_REF)) {
      throw new Error(`E2E: ${name} does not point at classstackr-staging (${STAGING_REF}). Refusing to run.`);
    }
  }
  return env;
}

/** This run's namespace. Set once by global setup and inherited by workers. */
export function runId(): string {
  const id = process.env.E2E_RUN_ID;
  if (!id) throw new Error("E2E_RUN_ID is not set; global setup did not run.");
  return id;
}

/** Every auth user this suite creates has an email starting with this. */
export const EMAIL_PREFIX = "e2e.";
/** Every organization this suite creates has a name starting with this. */
export const ORG_PREFIX = "E2E ";

export function runEmailPrefix(id = runId()): string {
  return `${EMAIL_PREFIX}${id}.`;
}

export function runOrgPrefix(id = runId()): string {
  return `${ORG_PREFIX}${id} `;
}
