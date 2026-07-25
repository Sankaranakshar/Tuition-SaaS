import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { uids } from "../integration/fixtures.ts";

// /google/url and /google/callback (server/routes/settings.ts) are pure
// Google OAuth plumbing for Epic 8, which is founder-deferred (DEV_PLAN §2)
// — exercising them would mean mocking the `googleapis` client for a
// feature nobody is meant to be working on right now. /google/status and
// /google/disconnect don't touch Google at all (just the stored token row),
// so they're real, in-scope route contracts.

let app: any;
let db: PGlite;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());
});

afterAll(async () => {
  await db.close();
});

describe("GET /api/v1/settings/google/status", () => {
  it("401s with no token", async () => {
    const res = await request(app).get("/api/v1/settings/google/status");
    expectStatus(res, 401);
  });

  it("403s for a role outside owner/admin/tutor (parent)", async () => {
    const res = await request(app)
      .get("/api/v1/settings/google/status")
      .set(...authHeader(uids.parent));
    expectStatus(res, 403);
  });

  it("200s connected:false when no token row exists", async () => {
    const res = await request(app)
      .get("/api/v1/settings/google/status")
      .set(...authHeader(uids.admin));
    expectStatus(res, 200);
    expect(res.body.connected).toBe(false);
  });

  it("200s connected:true — fixtures.ts already seeds a token row for uids.tutor", async () => {
    const res = await request(app)
      .get("/api/v1/settings/google/status")
      .set(...authHeader(uids.tutor));
    expectStatus(res, 200);
    expect(res.body.connected).toBe(true);
  });
});

describe("POST /api/v1/settings/google/disconnect", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/settings/google/disconnect");
    expectStatus(res, 401);
  });

  it("403s for a role outside owner/admin/tutor (student)", async () => {
    const res = await request(app)
      .post("/api/v1/settings/google/disconnect")
      .set(...authHeader(uids.student));
    expectStatus(res, 403);
  });

  it("200s and actually removes the token row fixtures.ts seeded for uids.tutor", async () => {
    const res = await request(app)
      .post("/api/v1/settings/google/disconnect")
      .set(...authHeader(uids.tutor));
    expectStatus(res, 200);

    const row = await db.query<any>(`select 1 from google_tokens where user_id = $1`, [uids.tutor]);
    expect(row.rows.length).toBe(0);
  });
});
