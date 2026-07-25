import { defineConfig } from "vitest/config";

// Route-contract suite (DEV_PLAN §9, Tech Debt / Epic 17 hardening gauntlet):
// exercises the real Express app + real route handlers with supertest,
// against a PGlite-backed `pool`/`supabaseAdmin` (tests/contract/*Shim.ts)
// instead of a live Supabase project — same "no Docker/GoTrue needed"
// posture as the RLS suite, but through the actual HTTP layer so it also
// covers auth-matrix behavior (401/403/200/409/422) the RLS suite can't see.
export default defineConfig({
  test: {
    include: ["tests/contract/**/*.test.ts"],
    setupFiles: ["tests/contract/setup.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 30000,
    env: {
      SUPABASE_JWT_SECRET: "contract-test-secret-do-not-use-in-prod",
      SUPABASE_URL: "http://localhost:54321",
      SUPABASE_SERVICE_ROLE_KEY: "test-service-role-key",
      DATABASE_URL: "postgres://unused-in-contract-tests",
    },
  },
});
