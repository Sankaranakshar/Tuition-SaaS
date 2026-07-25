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
  // Every `.rowCount` check in the routes under test (grepped, not guessed)
  // is against a SELECT's row count, where node-postgres's rowCount equals
  // rows.length — unlike PGlite's own `affectedRows`, which is 0 for a
  // SELECT (an UPDATE/INSERT/DELETE row count, not a "how many came back"
  // count) and would make `rowCount === 0` checks wrongly true even when
  // rows were actually returned.
  return { rows: res.rows as any[], rowCount: (res.rows as any[]).length };
}
