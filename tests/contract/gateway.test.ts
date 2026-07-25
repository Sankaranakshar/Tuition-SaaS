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

describe("GET /api/v1/gateway", () => {
  it("401s with no token", async () => {
    const res = await request(app).get("/api/v1/gateway");
    expectStatus(res, 401);
  });

  it("403s for a role outside owner/admin (frontdesk)", async () => {
    const res = await request(app)
      .get("/api/v1/gateway")
      .set(...authHeader(uids.frontdesk));
    expectStatus(res, 403);
  });

  it("200s connected:false — fixtures.ts's payment_gateways row has no secrets", async () => {
    const res = await request(app)
      .get("/api/v1/gateway")
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.body.connected).toBe(false);
    expect(res.body.keyId).toBe("rzp_test");
  });
});

describe("PUT /api/v1/gateway/razorpay", () => {
  const creds = { keyId: "rzp_live_abc123", keySecret: "supersecretvalue", webhookSecret: "webhooksecretvalue" };

  it("403s for a role outside owner/admin (accountant)", async () => {
    const res = await request(app)
      .put("/api/v1/gateway/razorpay")
      .set(...authHeader(uids.accountant))
      .send(creds);
    expectStatus(res, 403);
  });

  it("422s a malformed body (secret too short)", async () => {
    const res = await request(app)
      .put("/api/v1/gateway/razorpay")
      .set(...authHeader(uids.owner))
      .send({ ...creds, keySecret: "x" });
    expectStatus(res, 422);
  });

  it("200s, encrypts the secrets at rest, and GET now reports connected:true", async () => {
    const res = await request(app)
      .put("/api/v1/gateway/razorpay")
      .set(...authHeader(uids.owner))
      .send(creds);
    expectStatus(res, 200);
    expect(res.body.connected).toBe(true);

    const row = await db.query<any>(`select key_id, key_secret_enc from payment_gateways where organization_id = '00000000-0000-0000-0000-00000000000a'`, []);
    expect(row.rows[0].key_id).toBe("rzp_live_abc123");
    expect(row.rows[0].key_secret_enc).not.toBe("supersecretvalue"); // encrypted, not plaintext

    const status = await request(app).get("/api/v1/gateway").set(...authHeader(uids.owner));
    expectStatus(status, 200);
    expect(status.body.connected).toBe(true);
  });
});

describe("PUT /api/v1/gateway/tax", () => {
  it("422s a malformed body (tax rate out of range)", async () => {
    const res = await request(app)
      .put("/api/v1/gateway/tax")
      .set(...authHeader(uids.owner))
      .send({ defaultTaxRatePercent: 50 });
    expectStatus(res, 422);
  });

  it("200s and updates only the tax column, leaving previously-set gateway creds intact", async () => {
    const res = await request(app)
      .put("/api/v1/gateway/tax")
      .set(...authHeader(uids.owner))
      .send({ gstin: "29ABCDE1234F1Z5", defaultTaxRatePercent: 18 });
    expectStatus(res, 200);

    const row = await db.query<any>(`select key_id, tax from payment_gateways where organization_id = '00000000-0000-0000-0000-00000000000a'`, []);
    expect(row.rows[0].key_id).toBe("rzp_live_abc123"); // untouched by the partial upsert
    expect(row.rows[0].tax.gstin).toBe("29ABCDE1234F1Z5");
  });
});

describe("DELETE /api/v1/gateway/razorpay", () => {
  it("403s for a role outside owner/admin (tutor)", async () => {
    const res = await request(app)
      .delete("/api/v1/gateway/razorpay")
      .set(...authHeader(uids.tutor));
    expectStatus(res, 403);
  });

  it("200s and clears the connection, GET now reports connected:false again", async () => {
    const res = await request(app)
      .delete("/api/v1/gateway/razorpay")
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.body.connected).toBe(false);

    const status = await request(app).get("/api/v1/gateway").set(...authHeader(uids.owner));
    expectStatus(status, 200);
    expect(status.body.connected).toBe(false);
  });
});
