import type { PGlite } from "@electric-sql/pglite";

// Singleton the vi.mock factories for server/db.ts and server/supabaseAdmin.ts
// close over — vi.mock factories are hoisted above imports and can't see a
// per-test `beforeAll`-scoped variable directly, so both mocks delegate to
// whatever PGlite instance the current test file registered here.
let current: PGlite | null = null;

export function setBackend(db: PGlite) {
  current = db;
}

export interface QueryResult {
  rows: any[];
  rowCount: number | null;
}

/**
 * Every query in these contract tests runs at PGlite's default bootstrap
 * role, which (like a real Supabase direct-Postgres connection on
 * DATABASE_URL) is a superuser and bypasses RLS — matching the actual trust
 * boundary of `pool`/`withTransaction` and the service-role `supabaseAdmin`
 * client in production. RLS itself is covered separately by
 * tests/integration/rbac.test.ts; this suite is about route auth/validation
 * behavior, not the RLS policies underneath it.
 */
export async function query(text: string, params: any[] = []): Promise<QueryResult> {
  if (!current) throw new Error("pgliteBackend: no PGlite instance registered — call setBackend() first");
  const res = await current.query(text, params);
  const rows = res.rows as any[];
  // node-postgres's rowCount means "how many rows this statement touched":
  // for a SELECT that's rows.length; for an UPDATE/INSERT/DELETE *without*
  // RETURNING it's the affected-row count even though rows is empty. PGlite
  // gives us both separately (`rows` and `affectedRows`, the latter 0 for a
  // bare SELECT) — prefer rows.length when it's non-zero (SELECT, or a
  // RETURNING clause), otherwise fall back to affectedRows so a rowCount
  // check on a plain UPDATE/DELETE (e.g. students.ts's redeem claim) sees
  // the real count instead of always reading 0.
  const rowCount = rows.length > 0 ? rows.length : (res.affectedRows ?? 0);
  return { rows, rowCount };
}
