import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp } from "./testApp.ts";
import { ORG } from "../integration/fixtures.ts";
import { encrypt } from "../../server/utils/crypto.ts";

// The Razorpay webhook receiver had no contract coverage at all, which is
// how a broken audit-write on this path stayed invisible: writeAudit
// swallows failures by design, so the route kept returning 200 while every
// gateway payment produced no audit row.
//
// These drive the real signature-gated HTTP path — encrypted creds in
// payment_gateways, a genuine HMAC over the raw body — rather than calling
// handleEvent() directly, because the raw-body mount in server/app.ts is
// part of what makes the signature verify at all.

let app: any;
let db: PGlite;

const WEBHOOK_SECRET = "webhook-secret-for-contract-tests";
let studentId: string;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

/** POSTs a body with a valid X-Razorpay-Signature over its exact bytes. */
function postSigned(orgId: string, event: unknown) {
  const raw = JSON.stringify(event);
  const signature = crypto.createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
  return request(app)
    .post(`/api/webhooks/razorpay/${orgId}`)
    .set("Content-Type", "application/json")
    .set("x-razorpay-signature", signature)
    .send(raw);
}

async function insertInvoice(totalPaise = 50000) {
  const id = crypto.randomUUID();
  await db.query(
    `insert into invoices (id, organization_id, student_id, total_paise, paid_paise, total_amount, subtotal, subtotal_paise, status)
     values ($1, $2, $3, $4, 0, $5, $5, $4, 'unpaid')`,
    [id, ORG, studentId, totalPaise, totalPaise / 100]
  );
  return id;
}

function capturedEvent(invoiceId: string, amountPaise: number, paymentId: string) {
  return {
    event: "payment.captured",
    payload: {
      payment: { entity: { id: paymentId, amount: amountPaise, notes: { invoiceId } } },
    },
  };
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());

  studentId = crypto.randomUUID();
  await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Webhook Student')`, [studentId, ORG]);

  // fixtures.ts already seeds a payment_gateways row for ORG; overwrite it
  // with creds whose webhook secret we know, so we can sign a real HMAC.
  await db.query(
    `insert into payment_gateways (organization_id, key_id, key_secret_enc, webhook_secret_enc)
     values ($1, 'rzp_test_key', $2, $3)
     on conflict (organization_id) do update set
       key_id = excluded.key_id,
       key_secret_enc = excluded.key_secret_enc,
       webhook_secret_enc = excluded.webhook_secret_enc`,
    [ORG, encrypt("test-key-secret"), encrypt(WEBHOOK_SECRET)]
  );
});

afterAll(async () => {
  await db.close();
});

describe("POST /api/webhooks/razorpay/:orgId", () => {
  it("400s a body whose signature doesn't verify", async () => {
    const invoiceId = await insertInvoice();
    const res = await request(app)
      .post(`/api/webhooks/razorpay/${ORG}`)
      .set("Content-Type", "application/json")
      .set("x-razorpay-signature", "deadbeef")
      .send(JSON.stringify(capturedEvent(invoiceId, 50000, `pay_${crypto.randomUUID()}`)));
    expectStatus(res, 400);
    expect(res.body.error.code).toBe("bad_signature");
  });

  it("404s for an org with no gateway connected", async () => {
    const res = await postSigned("00000000-0000-0000-0000-0000000000ff", { event: "payment.captured" });
    expectStatus(res, 404);
  });

  it("settles a captured payment against the invoice", async () => {
    const invoiceId = await insertInvoice(50000);
    const res = await postSigned(ORG, capturedEvent(invoiceId, 50000, `pay_${crypto.randomUUID()}`));
    expectStatus(res, 200);

    const { rows } = await db.query(`select status, paid_paise from invoices where id = $1`, [invoiceId]);
    expect((rows[0] as any).status).toBe("paid");
    expect((rows[0] as any).paid_paise).toBe(50000);
  });

  // The regression this file exists for.
  it("writes an audit row for the gateway capture", async () => {
    const invoiceId = await insertInvoice(30000);
    const paymentId = `pay_${crypto.randomUUID()}`;
    expectStatus(await postSigned(ORG, capturedEvent(invoiceId, 30000, paymentId)), 200);

    const { rows } = await db.query(
      `select actor_id, payload from audit_events
       where organization_id = $1 and action = 'payment.gateway_captured'
         and payload ->> 'entityId' = $2`,
      [ORG, invoiceId]
    );
    expect(rows).toHaveLength(1);

    const row = rows[0] as any;
    // A system actor can't occupy actor_id — it's a uuid FK into auth.users.
    expect(row.actor_id).toBeNull();
    expect(row.payload.systemActor).toBe("razorpay_webhook");
    expect(row.payload.entityType).toBe("invoices");
    expect(row.payload.gatewayPaymentId).toBe(paymentId);
  });

  it("is idempotent — a redelivered payment settles and audits exactly once", async () => {
    const invoiceId = await insertInvoice(20000);
    const paymentId = `pay_${crypto.randomUUID()}`;
    const event = capturedEvent(invoiceId, 20000, paymentId);

    expectStatus(await postSigned(ORG, event), 200);
    const second = await postSigned(ORG, event);
    expectStatus(second, 200);
    expect(second.body.duplicate).toBe(true);

    const payments = await db.query(
      `select count(*)::int as n from payments where organization_id = $1 and idempotency_key = $2`,
      [ORG, `rzp_${paymentId}`]
    );
    expect((payments.rows[0] as any).n).toBe(1);

    const audits = await db.query(
      `select count(*)::int as n from audit_events
       where organization_id = $1 and action = 'payment.gateway_captured' and payload ->> 'entityId' = $2`,
      [ORG, invoiceId]
    );
    expect((audits.rows[0] as any).n).toBe(1);
  });

  it("ignores an event type that isn't a captured payment, and audits nothing", async () => {
    const before = await db.query(`select count(*)::int as n from audit_events where organization_id = $1`, [ORG]);
    const res = await postSigned(ORG, { event: "payment.failed", payload: { payment: { entity: { id: "pay_x" } } } });
    expectStatus(res, 200);
    expect(res.body.ignored).toBe(true);

    const after = await db.query(`select count(*)::int as n from audit_events where organization_id = $1`, [ORG]);
    expect((after.rows[0] as any).n).toBe((before.rows[0] as any).n);
  });
});

describe("GET /api/v1/audit-log", () => {
  it("surfaces the system actor so it reads as a webhook, not a deleted user", async () => {
    const invoiceId = await insertInvoice(15000);
    expectStatus(await postSigned(ORG, capturedEvent(invoiceId, 15000, `pay_${crypto.randomUUID()}`)), 200);

    const { authHeader } = await import("./testApp.ts");
    const { uids } = await import("../integration/fixtures.ts");
    const res = await request(app)
      .get("/api/v1/audit-log?limit=200")
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);

    const event = res.body.events.find(
      (e: any) => e.action === "payment.gateway_captured" && e.entityId === invoiceId
    );
    expect(event).toBeDefined();
    expect(event.actorId).toBeNull();
    expect(event.actorName).toBeNull();
    expect(event.systemActor).toBe("razorpay_webhook");
  });
});
