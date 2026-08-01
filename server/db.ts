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
//
// The timeouts below matter more here than they would on a fat pool. With
// max = 3, a single connection stuck on a slow query or parked in an
// abandoned transaction starves a third of the process's DB capacity, and a
// leaked BEGIN also holds every row lock it took (the attendance and invoice
// paths lock rows with FOR UPDATE) until the backend is reaped. Postgres
// enforces these server-side, so they hold even if the Node process is the
// thing that wedged.
export const pool = new Pool({
  connectionString,
  max: Number(process.env.PG_POOL_MAX) || 3,
  // Return idle connections to the Supabase pooler rather than pinning them
  // for the life of a serverless instance that may handle one request a minute.
  idleTimeoutMillis: Number(process.env.PG_IDLE_TIMEOUT_MS) || 10_000,
  // Fail fast when the pooler is saturated instead of queueing a request
  // behind a checkout that will never come.
  connectionTimeoutMillis: Number(process.env.PG_CONNECT_TIMEOUT_MS) || 5_000,
  keepAlive: true,
  application_name: "classstackr-api",
  // Ceiling on any single statement. Generous enough for the org export and
  // the cron materialize sweep, low enough that a pathological query can't
  // hold a pool slot indefinitely.
  statement_timeout: Number(process.env.PG_STATEMENT_TIMEOUT_MS) || 30_000,
  // Backstop for a transaction whose caller died mid-flight.
  idle_in_transaction_session_timeout: Number(process.env.PG_IDLE_TX_TIMEOUT_MS) || 30_000,
});

// Without a listener, an error raised on an *idle* pooled client (pooler
// restart, network drop) is an unhandled 'error' event on the Pool, which
// takes the whole process down. pg evicts the bad client on its own; this
// just keeps the crash from happening.
pool.on("error", (err) => {
  console.error("Idle Postgres client error (connection evicted):", err);
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
