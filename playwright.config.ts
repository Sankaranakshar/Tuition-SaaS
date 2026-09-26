import { randomBytes } from "node:crypto";
import { defineConfig, devices } from "@playwright/test";
import { BASE_URL, E2E_PORT, requireStagingEnv } from "./tests/e2e/support/env";

// Playwright golden journeys, the eighth gate (EXECUTION_PLAN.md Step 31).
//
// Serves the app's production build the way Vercel does (tests/e2e/server.ts)
// locally or inside the CI job, pointed at classstackr-staging, and drives it
// in Chromium. See Step 31's "Decisions" for why this does not target the PR's
// Vercel Preview URL, and HANDOFF.md §4 for how to run it.
//
// Local:  npx dotenvx run -f .env.staging -- npm run test:e2e
// CI:     the `e2e` job in .github/workflows/ci.yml

requireStagingEnv();

const isCI = !!process.env.CI;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: /.*\.spec\.ts$/,
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  fullyParallel: false,
  workers: isCI ? 3 : 2,
  retries: isCI ? 1 : 0,
  forbidOnly: isCI,
  timeout: 120_000,
  expect: { timeout: 15_000 },
  reporter: isCI ? [["github"], ["list"], ["html", { open: "never" }]] : [["list"]],
  use: {
    baseURL: BASE_URL,
    // Every org defaults to Asia/Kolkata, and the whole customer base is in
    // India. Pinning the browser zone makes the suite behave the same on a UTC
    // CI runner and an IST laptop (HANDOFF.md §8's timezone trap).
    timezoneId: "Asia/Kolkata",
    locale: "en-IN",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: process.env.E2E_BASE_URL
    ? undefined
    : {
        // CI builds in its own step (with the staging VITE_* env) so a build
        // failure is reported as one; locally, build here.
        command: isCI ? "npx tsx tests/e2e/server.ts" : "npx vite build && npx tsx tests/e2e/server.ts",
        url: `${BASE_URL}/api/health`,
        timeout: 180_000,
        reuseExistingServer: false,
        stdout: "ignore",
        stderr: "pipe",
        env: {
          NODE_ENV: "production",
          PORT: String(E2E_PORT),
          APP_URL: BASE_URL,
          // tests/e2e/server.ts never loads .env (a developer's .env points at
          // production): only the staging values in this process's env and
          // the throwaway secrets below apply.
          JWT_SECRET: process.env.JWT_SECRET_E2E || randomBytes(32).toString("hex"),
          ENCRYPTION_KEY: process.env.ENCRYPTION_KEY_E2E || randomBytes(32).toString("hex"),
          CRON_SECRET: randomBytes(32).toString("hex"),
          SUPABASE_JWT_SECRET: "",
          SENTRY_DSN: "",
          VITE_SENTRY_DSN: "",
          PG_POOL_MAX: "3",
        },
      },
});
