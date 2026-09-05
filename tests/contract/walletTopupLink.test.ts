import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, uids } from "../integration/fixtures.ts";

// B-05 self-serve parent top-up (EXECUTION_PLAN.md Step 7). Only the
// degraded (gateway_not_connected) path and the authorization boundary are
// contract-tested here — the fixture org has no real Razorpay creds, and
// this repo's established convention (see billing.test.ts's payment-link
// tests, HANDOFF.md §7) is to code-review-only whatever needs a live
// gateway call. The webhook settlement side, which needs no live gateway at
// all, IS fully tested — see webhooks.test.ts's "wallet top-up" describe.

let app: any;
let db: PGlite;
let linkedStudentId: string;
let otherStudentId: string;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  // Real crypto.randomUUID()s, not the shared fixture's ids.stu1 — that
  // constant isn't RFC-version-compliant and fails Zod v4's strict
  // z.string().uuid() the moment a route actually validates it as a body
  // field (versus just using it as an opaque row id in a SQL fixture).
  linkedStudentId = crypto.randomUUID();
  await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Linked Kid')`, [linkedStudentId, ORG]);
  await db.query(`insert into parent_links (parent_user_id, student_id, organization_id) values ($1, $2, $3)`, [uids.parent, linkedStudentId, ORG]);

  // No parent_links row at all — the "another family's wallet" case B-05's
  // own DoD calls out explicitly.
  otherStudentId = crypto.randomUUID();
  await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Other Family Kid')`, [otherStudentId, ORG]);
});

afterAll(async () => {
  await db.close();
});

describe("POST /api/v1/billing/wallets/topup-link", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/billing/wallets/topup-link").send({ studentId: linkedStudentId, amountPaise: 50000 });
    expectStatus(res, 401);
  });

  it("403s for a non-parent role", async () => {
    const res = await request(app)
      .post("/api/v1/billing/wallets/topup-link")
      .set(...authHeader(uids.owner))
      .send({ studentId: linkedStudentId, amountPaise: 50000 });
    expectStatus(res, 403);
  });

  it("403s a parent topping up a student they aren't linked to (cross-family)", async () => {
    const res = await request(app)
      .post("/api/v1/billing/wallets/topup-link")
      .set(...authHeader(uids.parent))
      .send({ studentId: otherStudentId, amountPaise: 50000 });
    expectStatus(res, 403);
  });

  it("422s gateway_not_connected for a parent topping up their own linked student (degraded path)", async () => {
    const res = await request(app)
      .post("/api/v1/billing/wallets/topup-link")
      .set(...authHeader(uids.parent))
      .send({ studentId: linkedStudentId, amountPaise: 50000 });
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("gateway_not_connected");
  });

  it("422s (validation) a non-positive amount before ever reaching the gateway", async () => {
    const res = await request(app)
      .post("/api/v1/billing/wallets/topup-link")
      .set(...authHeader(uids.parent))
      .send({ studentId: linkedStudentId, amountPaise: 0 });
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("validation");
  });
});
