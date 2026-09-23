import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, uids } from "../integration/fixtures.ts";

// B-17 (EXECUTION_PLAN.md Step 27): the outbound comms router. Drives the
// real HTTP paths (invoice creation enqueues a message; the delivery-status
// webhook settles one) rather than calling enqueueMessage()/the handler
// directly, same rationale as webhooks.test.ts's own header comment — the
// raw-body mount and the route's own auth/role guards are part of what's
// under test, not just the underlying function.

let app: any;
let db: PGlite;
let studentId: string;

const MESSAGING_WEBHOOK_SECRET = "messaging-webhook-secret-for-contract-tests";

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

function postSignedDeliveryStatus(event: unknown) {
  const raw = JSON.stringify(event);
  const signature = crypto.createHmac("sha256", MESSAGING_WEBHOOK_SECRET).update(raw).digest("hex");
  return request(app)
    .post("/api/webhooks/messaging/delivery-status")
    .set("Content-Type", "application/json")
    .set("x-webhook-signature", signature)
    .send(raw);
}

async function outboxRowsForSource(kind: string, entityId: string) {
  const res = await db.query(
    `select * from message_outbox where organization_id = $1 and source ->> 'kind' = $2 and source ->> 'entityId' = $3`,
    [ORG, kind, entityId]
  );
  return res.rows as any[];
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  process.env.MESSAGING_WEBHOOK_SECRET = MESSAGING_WEBHOOK_SECRET;
  // fixtures.ts never inserts a profiles row for any seeded user, and
  // ids.stu1 isn't a Zod-valid v4 uuid (billing.test.ts hits the same thing
  // — see its own separately-created bodyStudentId) — this suite needs a
  // real student, parent-linked to the fixture parent, with a phone on file
  // for that parent, since every messaging producer resolves a recipient
  // via parent_links -> profiles.phone.
  studentId = crypto.randomUUID();
  await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Messaging Student')`, [studentId, ORG]);
  await db.query(
    `insert into parent_links (parent_user_id, student_id, organization_id) values ($1, $2, $3)`,
    [uids.parent, studentId, ORG]
  );
  await db.query(
    `insert into profiles (id, organization_id, name, phone) values ($1, $2, 'Fixture Parent', '+911234567890')
     on conflict (id) do update set phone = excluded.phone`,
    [uids.parent, ORG]
  );
});

afterAll(async () => {
  delete process.env.MESSAGING_WEBHOOK_SECRET;
  await db.close();
});

describe("enqueue on invoice raised", () => {
  it("a free-form invoice enqueues a queued invoice_raised message to the linked parent", async () => {
    const res = await request(app)
      .post("/api/v1/billing/invoices")
      .set(...authHeader(uids.owner))
      .send({ studentId: studentId, items: [{ description: "Tuition", amount: 500, quantity: 1 }], taxPercentage: 0 });
    expectStatus(res, 201);

    const rows = await outboxRowsForSource("invoice", res.body.invoiceId);
    expect(rows.length).toBe(1);
    expect(rows[0].state).toBe("queued");
    expect(rows[0].template_key).toBe("invoice_raised");
    expect(rows[0].recipient_user_id).toBe(uids.parent);
    expect(rows[0].recipient_phone).toBe("+911234567890");
    expect(rows[0].idempotency_key).toBe(`invoice_raised:${res.body.invoiceId}`);
  });

  it("a second call for a different invoice does not touch the first invoice's message", async () => {
    const first = await request(app)
      .post("/api/v1/billing/invoices")
      .set(...authHeader(uids.owner))
      .send({ studentId: studentId, items: [{ description: "Tuition A", amount: 100, quantity: 1 }], taxPercentage: 0 });
    const second = await request(app)
      .post("/api/v1/billing/invoices")
      .set(...authHeader(uids.owner))
      .send({ studentId: studentId, items: [{ description: "Tuition B", amount: 200, quantity: 1 }], taxPercentage: 0 });

    const firstRows = await outboxRowsForSource("invoice", first.body.invoiceId);
    const secondRows = await outboxRowsForSource("invoice", second.body.invoiceId);
    expect(firstRows.length).toBe(1);
    expect(secondRows.length).toBe(1);
    expect(firstRows[0].id).not.toBe(secondRows[0].id);
  });
});

describe("preference opt-out suppresses a send", () => {
  it("a recipient with smsNotifications: false gets a suppressed row instead of queued", async () => {
    await db.query(
      `update profiles set preferences = '{"notifications":{"smsNotifications":false}}'::jsonb where id = $1`,
      [uids.parent]
    );
    try {
      const res = await request(app)
        .post("/api/v1/billing/invoices")
        .set(...authHeader(uids.owner))
        .send({ studentId: studentId, items: [{ description: "Opted out", amount: 300, quantity: 1 }], taxPercentage: 0 });
      expectStatus(res, 201);

      const rows = await outboxRowsForSource("invoice", res.body.invoiceId);
      expect(rows.length).toBe(1);
      expect(rows[0].state).toBe("suppressed");
    } finally {
      await db.query(`update profiles set preferences = '{}'::jsonb where id = $1`, [uids.parent]);
    }
  });
});

describe("POST /api/v1/billing/invoices/:invoiceId/remind", () => {
  it("enqueues a fee_due_reminder for an invoice with an outstanding balance", async () => {
    const invRes = await request(app)
      .post("/api/v1/billing/invoices")
      .set(...authHeader(uids.owner))
      .send({ studentId: studentId, items: [{ description: "Reminder target", amount: 400, quantity: 1 }], taxPercentage: 0 });
    const invoiceId = invRes.body.invoiceId;

    const res = await request(app).post(`/api/v1/billing/invoices/${invoiceId}/remind`).set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.body.enqueued).toBe(true);

    const rows = await outboxRowsForSource("invoice", invoiceId);
    const reminder = rows.find((r) => r.template_key === "fee_due_reminder");
    expect(reminder).toBeDefined();
  });

  it("a second reminder the same day does not double-send", async () => {
    const invRes = await request(app)
      .post("/api/v1/billing/invoices")
      .set(...authHeader(uids.owner))
      .send({ studentId: studentId, items: [{ description: "Double reminder", amount: 400, quantity: 1 }], taxPercentage: 0 });
    const invoiceId = invRes.body.invoiceId;

    const first = await request(app).post(`/api/v1/billing/invoices/${invoiceId}/remind`).set(...authHeader(uids.owner));
    const second = await request(app).post(`/api/v1/billing/invoices/${invoiceId}/remind`).set(...authHeader(uids.owner));
    expect(first.body.enqueued).toBe(true);
    expect(second.body.enqueued).toBe(false);
    expect(second.body.reason).toBe("already_reminded_today");

    const rows = await outboxRowsForSource("invoice", invoiceId);
    expect(rows.filter((r) => r.template_key === "fee_due_reminder").length).toBe(1);
  });
});

describe("POST /api/webhooks/messaging/delivery-status", () => {
  async function seedSentMessage() {
    const id = crypto.randomUUID();
    const providerMessageId = `test_${crypto.randomUUID()}`;
    await db.query(
      `insert into message_outbox
         (id, organization_id, recipient_user_id, recipient_phone, channel, template_key, payload, state, source, idempotency_key, provider_message_id, attempts, sent_at)
       values ($1, $2, $3, '+911234567890', 'whatsapp', 'invoice_raised', '{}'::jsonb, 'sent', '{}'::jsonb, $4, $5, 1, now())`,
      [id, ORG, uids.parent, `webhook-test-${id}`, providerMessageId]
    );
    return { id, providerMessageId };
  }

  it("503s when MESSAGING_WEBHOOK_SECRET is unset (inert until a vendor is wired, same as /razorpay-platform)", async () => {
    delete process.env.MESSAGING_WEBHOOK_SECRET;
    try {
      const res = await postSignedDeliveryStatus({ providerMessageId: "x", status: "delivered" });
      expectStatus(res, 503);
    } finally {
      process.env.MESSAGING_WEBHOOK_SECRET = MESSAGING_WEBHOOK_SECRET;
    }
  });

  it("400s a bad signature", async () => {
    const res = await request(app)
      .post("/api/webhooks/messaging/delivery-status")
      .set("Content-Type", "application/json")
      .set("x-webhook-signature", "not-a-real-signature")
      .send(JSON.stringify({ providerMessageId: "x", status: "delivered" }));
    expectStatus(res, 400);
  });

  it("settles a sent message to delivered on a verified event", async () => {
    const { id, providerMessageId } = await seedSentMessage();
    const res = await postSignedDeliveryStatus({ providerMessageId, status: "delivered" });
    expectStatus(res, 200);
    expect(res.body.duplicate).toBe(false);

    const row = (await db.query(`select state, delivered_at from message_outbox where id = $1`, [id])).rows[0] as any;
    expect(row.state).toBe("delivered");
    expect(row.delivered_at).not.toBeNull();
  });

  it("a replayed event does not double-settle or move state backwards", async () => {
    const { id, providerMessageId } = await seedSentMessage();

    const first = await postSignedDeliveryStatus({ providerMessageId, status: "read" });
    expectStatus(first, 200);
    expect(first.body.duplicate).toBe(false);

    // Replay the exact same event Razorpay/an aggregator might redeliver.
    const replay = await postSignedDeliveryStatus({ providerMessageId, status: "read" });
    expectStatus(replay, 200);
    expect(replay.body.duplicate).toBe(true);

    // A stale "delivered" arriving after "read" (out-of-order redelivery)
    // must not move the row backwards either.
    const stale = await postSignedDeliveryStatus({ providerMessageId, status: "delivered" });
    expectStatus(stale, 200);
    expect(stale.body.duplicate).toBe(true);

    const row = (await db.query(`select state from message_outbox where id = $1`, [id])).rows[0] as any;
    expect(row.state).toBe("read");
  });

  it("ignores an event for an unknown provider message id rather than erroring", async () => {
    const res = await postSignedDeliveryStatus({ providerMessageId: "no-such-message", status: "delivered" });
    expectStatus(res, 200);
    expect(res.body.ignored).toBe(true);
    expect(res.body.reason).toBe("message_not_found");
  });
});
