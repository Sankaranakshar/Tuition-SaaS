import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";

// B-02 (MASTER_PLAN.md §3, R1): apiLimiter used to key exclusively on IP
// because it ran before any route's authenticateToken populated req.user.
// identifyUser (server/middleware/auth.ts) now runs ahead of it, so two
// authenticated users behind the same IP (as any two requests from this test
// process necessarily are) must get independent buckets instead of sharing
// one — a coaching center behind a single NAT should not share 120 req/min.
let app: any;
let db: PGlite;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
});

afterAll(async () => {
  await db.close();
});

function remaining(res: request.Response): number {
  const header = res.headers["ratelimit-remaining"];
  expect(header).toBeDefined();
  return Number(header);
}

describe("apiLimiter keying", () => {
  it("gives each authenticated user their own bucket instead of sharing the requesting IP's", async () => {
    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1), ($2)`, [userA, userB]);

    const first = await request(app).get("/api/health").set(...authHeader(userA));
    const firstRemaining = remaining(first);

    // A fresh user, same process (same IP) — must start from the same
    // full bucket as userA did, not from userA's already-decremented one.
    const second = await request(app).get("/api/health").set(...authHeader(userB));
    expect(remaining(second)).toBe(firstRemaining);

    // Back to userA: their own bucket should have advanced independently.
    const third = await request(app).get("/api/health").set(...authHeader(userA));
    expect(remaining(third)).toBe(firstRemaining - 1);
  });

  it("still rate-limits unauthenticated requests by IP", async () => {
    const first = await request(app).get("/api/health");
    const second = await request(app).get("/api/health");
    expect(remaining(second)).toBe(remaining(first) - 1);
  });
});
