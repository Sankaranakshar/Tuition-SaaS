import { vi } from "vitest";

// Registered once for the whole contract-test run (vitest.contract.config.ts
// setupFiles) so every test file's `import ... from "../../server/app.ts"`
// (and anything it transitively imports) resolves `../db.ts` and
// `../supabaseAdmin.ts` to the PGlite-backed shims instead of a real
// `pg.Pool` / live Supabase project.
vi.mock("../../server/db.ts", async () => {
  const shim = await import("./dbShim.ts");
  return { pool: shim.pool, withTransaction: shim.withTransaction };
});

vi.mock("../../server/supabaseAdmin.ts", async () => {
  const shim = await import("./supabaseShim.ts");
  return { supabaseAdmin: shim.supabaseAdmin };
});
