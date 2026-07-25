import jwt from "jsonwebtoken";
import type { PGlite } from "@electric-sql/pglite";
import { bootDb } from "../integration/db.ts";
import { seed } from "../integration/fixtures.ts";
import { setBackend } from "./pgliteBackend.ts";

const JWT_SECRET = "contract-test-secret-do-not-use-in-prod"; // matches vitest.contract.config.ts's env

/** Signs an HS256 access token shaped like a real Supabase JWT — enough
 *  for authenticateToken's HS256 verification path (server/middleware/auth.ts). */
export function signToken(userId: string | null, email = "test@example.com"): string {
  return jwt.sign({ sub: userId ?? undefined, email }, JWT_SECRET, { algorithm: "HS256", expiresIn: "1h" });
}

export function authHeader(userId: string | null, email?: string): [string, string] {
  return ["Authorization", `Bearer ${signToken(userId, email)}`];
}

/**
 * Boots a fresh PGlite instance with every migration applied, seeds the
 * standard RLS-suite fixtures (tests/integration/fixtures.ts — same org,
 * same users, same ids, so both suites read the same mental model), points
 * the pool/supabaseAdmin shims at it, and returns the real Express app
 * (server/app.ts's createApp()) for supertest to drive.
 *
 * One instance per test file (call from beforeAll), not per test — PGlite
 * boot is the slow part. Tests that mutate shared fixture rows should
 * create their own throwaway entities rather than relying on rollback-per-test
 * isolation (there isn't any here, unlike the RLS suite's scenario()).
 */
export async function createTestApp() {
  const db: PGlite = await bootDb();
  setBackend(db);
  await seed(db as any);

  // Imported dynamically, after the mocks in setup.ts and the backend above
  // are both in place — server/app.ts transitively imports every route,
  // which imports ../db.ts / ../supabaseAdmin.ts at module-load time.
  const { createApp } = await import("../../server/app.ts");
  const app = createApp();
  return { app, db };
}
