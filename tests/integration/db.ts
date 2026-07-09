import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const REPO_ROOT = join(import.meta.dirname, "..", "..");
const MIGRATIONS_DIR = join(REPO_ROOT, "supabase", "migrations");
const AUTH_SHIM = join(REPO_ROOT, "supabase", "test", "auth_shim.sql");

/**
 * Boots a fresh in-memory Postgres (PGlite — real Postgres compiled to WASM,
 * not an emulation) with the auth shim + every supabase/migrations/*.sql
 * file applied, in filename order — the same migrations that ship to the
 * real self-hosted Supabase instance. This is what actually lets RLS get
 * *tested*, not just manually reasoned about.
 */
export async function bootDb(): Promise<PGlite> {
  const db = new PGlite({ extensions: { pgcrypto } });

  // auth schema/table/roles must exist before the schema migration's `references
  // auth.users(id)` foreign keys; the grant statement inside is a harmless
  // no-op here since no public tables exist yet.
  await db.exec(readFileSync(AUTH_SHIM, "utf8"));

  // The storage migration targets storage.buckets, part of the real Supabase
  // Storage extension's schema — not present here and irrelevant to RLS/RBAC
  // testing (it creates a bucket row, not a policy). Matched by suffix so the
  // timestamp prefix (see `supabase db push` naming) doesn't matter.
  const SKIP = (f: string) => f.endsWith("_storage.sql");
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql") && !SKIP(f)).sort();
  for (const file of files) {
    await db.exec(readFileSync(join(MIGRATIONS_DIR, file), "utf8"));
  }

  // Re-run so the "grant all on all tables in schema public" now covers the
  // tables the migrations just created.
  await db.exec(readFileSync(AUTH_SHIM, "utf8"));

  return db;
}

export type Role = "anon" | "authenticated" | "service_role";

/** Switches the acting identity for the rest of the current transaction. */
export type As = (userId: string | null, role: Role) => Promise<void>;

/**
 * Runs `fn(tx, as)` inside a single transaction, always rolled back at the
 * end — so a scenario can seed fixtures as service_role, switch identity
 * with `as(userId, role)` as many times as it needs (SET LOCAL ROLE +
 * a per-request GUC, mirroring how PostgREST handles a real request), and
 * make assertions, all without any of it leaking into the next test or
 * needing a manual reset/truncate step between tests.
 */
export async function scenario<T>(db: PGlite, fn: (tx: PGlite, as: As) => Promise<T>): Promise<T> {
  let result!: T;
  let sentinel: unknown;
  try {
    await db.transaction(async (tx) => {
      const as: As = async (userId, role) => {
        await tx.exec(`set local role ${role};`);
        await tx.query(`select set_config('request.jwt.claim.sub', $1, true);`, [userId ?? ""]);
      };
      result = await fn(tx as unknown as PGlite, as);
      sentinel = Symbol("rollback");
      throw sentinel;
    });
  } catch (err) {
    if (err !== sentinel) throw err;
  }
  return result;
}

/**
 * Asserts `fn()` is denied (throws or is otherwise rejected by RLS). Runs it
 * inside a SAVEPOINT and always rolls back to it afterward — Postgres marks
 * a whole transaction "aborted" after any error, so without this, a second
 * query later in the same test would fail with "current transaction is
 * aborted" instead of running at all. This lets a single scenario() make
 * several independent "this should be denied" assertions in sequence.
 */
export async function expectDenied(tx: PGlite, fn: () => Promise<unknown>): Promise<void> {
  await tx.exec(`savepoint expect_denied;`);
  let threw = false;
  try {
    await fn();
  } catch {
    threw = true;
  }
  await tx.exec(`rollback to savepoint expect_denied; release savepoint expect_denied;`);
  if (!threw) {
    throw new Error("Expected the operation to be denied by RLS, but it succeeded");
  }
}
