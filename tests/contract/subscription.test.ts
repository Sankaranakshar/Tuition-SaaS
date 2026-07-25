import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { uids } from "../integration/fixtures.ts";

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

describe("GET /api/v1/subscription", () => {
  it("401s with no token", async () => {
    const res = await request(app).get("/api/v1/subscription");
    expectStatus(res, 401);
  });

  it("403s for a role outside owner/admin (tutor)", async () => {
    const res = await request(app)
      .get("/api/v1/subscription")
      .set(...authHeader(uids.tutor));
    expectStatus(res, 403);
  });

  it("200s with the free-plan defaults and a real active-student count, since no subscriptions row exists", async () => {
    const res = await request(app)
      .get("/api/v1/subscription")
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.body.plan).toBe("free");
    expect(res.body.studentLimit).toBe(15);
    expect(res.body.activeStudentCount).toBe(1); // fixtures.ts seeds exactly one active student
    expect(res.body.razorpayConnected).toBe(false);
  });
});

describe("POST /api/v1/subscription/checkout", () => {
  it("403s for a role outside owner/admin (accountant)", async () => {
    const res = await request(app)
      .post("/api/v1/subscription/checkout")
      .set(...authHeader(uids.accountant))
      .send({ plan: "growth" });
    expectStatus(res, 403);
  });

  it("422s an unknown plan id", async () => {
    const res = await request(app)
      .post("/api/v1/subscription/checkout")
      .set(...authHeader(uids.owner))
      .send({ plan: "enterprise" });
    expectStatus(res, 422);
  });

  it("200s degraded — no PLATFORM_RAZORPAY_KEY_ID is configured in this environment", async () => {
    const res = await request(app)
      .post("/api/v1/subscription/checkout")
      .set(...authHeader(uids.owner))
      .send({ plan: "growth" });
    expectStatus(res, 200);
    expect(res.body.degraded).toBe(true);
    expect(res.body.message).toMatch(/Growth/);
  });
});
