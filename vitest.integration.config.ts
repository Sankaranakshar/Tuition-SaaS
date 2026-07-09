import { defineConfig } from "vitest/config";

// RLS/RBAC integration suite: runs against a real Postgres engine (PGlite)
// with every supabase/migrations/*.sql file applied — no Docker/GoTrue
// needed. Separate from the default `npm test` config since these tests are
// slower (boot a fresh Postgres instance) and depend on migration files.
export default defineConfig({
  test: {
    include: ["tests/integration/**/*.test.ts"],
    environment: "node",
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
