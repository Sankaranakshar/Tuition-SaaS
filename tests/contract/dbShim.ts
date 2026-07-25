import { query } from "./pgliteBackend.ts";

// Stand-in for server/db.ts's `pool`/`withTransaction`, backed by the
// PGlite instance registered in pgliteBackend.ts instead of a real `pg.Pool`
// on DATABASE_URL. Route code only ever calls `pool.query(...)` or
// `withTransaction(client => client.query(...))`, so this only needs to
// cover that surface, not the full `pg.Pool`/`PoolClient` API.
//
// PGlite is a single in-process engine, not a connection pool — there's no
// real concurrency here. That's fine as long as contract tests issue one
// mutating request at a time (never `Promise.all` two writes); tests that
// need to exercise real concurrent-transaction behavior (advisory locks,
// row-lock races) belong in the k6/load-test layer, not here.
export const pool = {
  query: (text: string, params: any[] = []) => query(text, params),
  connect: async () => ({
    query: (text: string, params: any[] = []) => query(text, params),
    release: () => {},
  }),
};

export async function withTransaction<T>(fn: (client: typeof pool) => Promise<T>): Promise<T> {
  await query("begin");
  try {
    const result = await fn(pool);
    await query("commit");
    return result;
  } catch (err) {
    await query("rollback").catch(() => {});
    throw err;
  }
}
