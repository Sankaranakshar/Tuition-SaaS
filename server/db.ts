import { Pool, type PoolClient } from "pg";

// Direct Postgres connection (bypasses PostgREST) for routes that need real
// multi-statement transactions with row locking — the equivalent of
// Firestore's db.runTransaction(). PostgREST/supabase-js is one request per
// call, so it can't hold a lock across a read-then-write like these routes
// need; a raw `pg` connection can.
const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.warn("DATABASE_URL not set — transactional Postgres routes will fail.");
}

// Cap connections per process: on serverless (Vercel) many function instances
// run concurrently, each with its own pool, so a large max would exhaust the
// Supabase pooler. Point DATABASE_URL at Supabase's transaction pooler (port
// 6543), not the direct 5432 connection, when deploying serverless.
export const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX) || 3,
});

/**
 * Run `fn` inside a single Postgres transaction. Commits on success, rolls
 * back on any thrown error (mirrors Firestore's runTransaction semantics:
 * the callback's writes only take effect if it returns without throwing).
 */
export async function withTransaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}
