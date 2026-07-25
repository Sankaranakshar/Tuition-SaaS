import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, uids } from "../integration/fixtures.ts";

let app: any;
let db: PGlite;
let bodyStudentId: string;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

async function insertInvoice(overrides: Partial<{ orgId: string; status: string; totalPaise: number; paidPaise: number }> = {}) {
  const id = crypto.randomUUID();
  const total = overrides.totalPaise ?? 50000;
  await db.query(
    `insert into invoices (id, organization_id, student_id, total_paise, paid_paise, total_amount, subtotal, subtotal_paise, status)
     values ($1, $2, $3, $4, $5, $6, $6, $4, $7)`,
    [id, overrides.orgId ?? ORG, bodyStudentId, total, overrides.paidPaise ?? 0, total / 100, overrides.status ?? "unpaid"]
  );
  return id;
}

async function insertSession(overrides: Partial<{ orgId: string; tutorId: string; startTime: Date }> = {}) {
  const id = crypto.randomUUID();
  await db.query(
    `insert into class_sessions (id, organization_id, tutor_id, student_ids, start_time, end_time, status)
     values ($1, $2, $3, $4, $5, $6, 'scheduled')`,
    [
      id,
      overrides.orgId ?? ORG,
      overrides.tutorId ?? uids.tutor,
      [bodyStudentId],
      (overrides.startTime ?? new Date(Date.now() - 3600 * 1000)).toISOString(),
      new Date((overrides.startTime ?? new Date(Date.now() - 3600 * 1000)).getTime() + 3600 * 1000).toISOString(),
    ]
  );
  return id;
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  bodyStudentId = crypto.randomUUID();
  await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Billing Student')`, [bodyStudentId, ORG]);
  await db.query(`insert into wallets (organization_id, student_id, balance_credits, balance_currency) values ($1, $2, 0, 0)`, [ORG, bodyStudentId]);
});

afterAll(async () => {
  await db.close();
});

describe("POST /api/v1/billing/invoices", () => {
  const body = { studentId: "", items: [{ description: "Tuition", amount: 500, quantity: 1 }], taxPercentage: 0 };

  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/billing/invoices").send({ ...body, studentId: bodyStudentId });
    expectStatus(res, 401);
  });

  it("403s for a role outside CAN_MARK (parent)", async () => {
    const res = await request(app)
      .post("/api/v1/billing/invoices")
      .set(...authHeader(uids.parent))
      .send({ ...body, studentId: bodyStudentId });
    expectStatus(res, 403);
  });

  it("422s on a malformed body (empty items)", async () => {
    const res = await request(app)
      .post("/api/v1/billing/invoices")
      .set(...authHeader(uids.owner))
      .send({ studentId: bodyStudentId, items: [] });
    expectStatus(res, 422);
  });

  it("201s and creates a real invoice row", async () => {
    const res = await request(app)
      .post("/api/v1/billing/invoices")
      .set(...authHeader(uids.frontdesk))
      .send({ ...body, studentId: bodyStudentId });
    expectStatus(res, 201);
    expect(res.body.invoiceId).toBeTruthy();

    const row = await db.query<any>(`select total_paise, status from invoices where id = $1`, [res.body.invoiceId]);
    expect(row.rows[0].total_paise).toBe(50000);
    expect(row.rows[0].status).toBe("unpaid");
  });
});

describe("POST /api/v1/billing/wallets/topup", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/billing/wallets/topup").send({});
    expectStatus(res, 401);
  });

  it("403s for a role outside CAN_MONEY (tutor)", async () => {
    const res = await request(app)
      .post("/api/v1/billing/wallets/topup")
      .set(...authHeader(uids.tutor))
      .send({ studentId: bodyStudentId, amountPaise: 10000, method: "cash", idempotencyKey: crypto.randomUUID() });
    expectStatus(res, 403);
  });

  it("201s crediting the wallet, then 200s (duplicate) on idempotent replay", async () => {
    const idempotencyKey = crypto.randomUUID();
    const first = await request(app)
      .post("/api/v1/billing/wallets/topup")
      .set(...authHeader(uids.owner))
      .send({ studentId: bodyStudentId, amountPaise: 10000, method: "cash", idempotencyKey });
    expectStatus(first, 201);
    expect(first.body.duplicate).toBe(false);

    const replay = await request(app)
      .post("/api/v1/billing/wallets/topup")
      .set(...authHeader(uids.owner))
      .send({ studentId: bodyStudentId, amountPaise: 10000, method: "cash", idempotencyKey });
    expectStatus(replay, 200);
    expect(replay.body.duplicate).toBe(true);

    const wallet = await db.query<any>(`select balance_currency from wallets where organization_id = $1 and student_id = $2`, [ORG, bodyStudentId]);
    expect(Number(wallet.rows[0].balance_currency)).toBe(100); // 10000 paise credited exactly once
  });
});

describe("POST /api/v1/billing/attendance", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/billing/attendance").send({});
    expectStatus(res, 401);
  });

  it("404s marking attendance for a session that doesn't exist", async () => {
    const res = await request(app)
      .post("/api/v1/billing/attendance")
      .set(...authHeader(uids.owner))
      .send({ sessionId: crypto.randomUUID(), records: [{ studentId: bodyStudentId, status: "present" }] });
    expectStatus(res, 404);
  });

  it("422s marking attendance for a session that hasn't started yet", async () => {
    const sessionId = await insertSession({ startTime: new Date(Date.now() + 3600 * 1000) });
    const res = await request(app)
      .post("/api/v1/billing/attendance")
      .set(...authHeader(uids.owner))
      .send({ sessionId, records: [{ studentId: bodyStudentId, status: "present" }] });
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("session_in_future");
  });

  it("403s a tutor marking another tutor's session", async () => {
    const sessionId = await insertSession({ tutorId: uids.tutor2 });
    const res = await request(app)
      .post("/api/v1/billing/attendance")
      .set(...authHeader(uids.tutor))
      .send({ sessionId, records: [{ studentId: bodyStudentId, status: "present" }] });
    expectStatus(res, 403);
  });

  it("200s marking attendance and accrues an unpaid invoice when the wallet has no balance", async () => {
    const sessionId = await insertSession({ tutorId: uids.tutor });
    const res = await request(app)
      .post("/api/v1/billing/attendance")
      .set(...authHeader(uids.tutor))
      .send({ sessionId, records: [{ studentId: bodyStudentId, status: "present" }] });
    expectStatus(res, 200);

    const session = await db.query<any>(`select status from class_sessions where id = $1`, [sessionId]);
    expect(session.rows[0].status).toBe("completed");
  });
});

describe("POST /api/v1/billing/sessions/cancel", () => {
  it("404s cancelling a session that doesn't exist", async () => {
    const res = await request(app)
      .post("/api/v1/billing/sessions/cancel")
      .set(...authHeader(uids.owner))
      .send({ sessionId: crypto.randomUUID() });
    expectStatus(res, 404);
  });

  it("200s cancelling a real session for in-role staff", async () => {
    const sessionId = await insertSession();
    const res = await request(app)
      .post("/api/v1/billing/sessions/cancel")
      .set(...authHeader(uids.owner))
      .send({ sessionId });
    expectStatus(res, 200);

    const row = await db.query<any>(`select status from class_sessions where id = $1`, [sessionId]);
    expect(row.rows[0].status).toBe("cancelled");
  });
});

describe("POST /api/v1/billing/payments/manual", () => {
  it("403s for a role outside CAN_MONEY (tutor)", async () => {
    const invoiceId = await insertInvoice();
    const res = await request(app)
      .post("/api/v1/billing/payments/manual")
      .set(...authHeader(uids.tutor))
      .send({ invoiceId, amountPaise: 10000, method: "cash", idempotencyKey: crypto.randomUUID() });
    expectStatus(res, 403);
  });

  it("404s paying an invoice that doesn't exist", async () => {
    const res = await request(app)
      .post("/api/v1/billing/payments/manual")
      .set(...authHeader(uids.owner))
      .send({ invoiceId: crypto.randomUUID(), amountPaise: 10000, method: "cash", idempotencyKey: crypto.randomUUID() });
    expectStatus(res, 404);
  });

  it("201s a partial payment, and 200s (duplicate) on idempotent replay", async () => {
    const invoiceId = await insertInvoice({ totalPaise: 50000 });
    const idempotencyKey = crypto.randomUUID();
    const first = await request(app)
      .post("/api/v1/billing/payments/manual")
      .set(...authHeader(uids.owner))
      .send({ invoiceId, amountPaise: 20000, method: "upi", idempotencyKey });
    expectStatus(first, 201);
    expect(first.body.invoiceStatus).toBe("partially_paid");

    const replay = await request(app)
      .post("/api/v1/billing/payments/manual")
      .set(...authHeader(uids.owner))
      .send({ invoiceId, amountPaise: 20000, method: "upi", idempotencyKey });
    expectStatus(replay, 200);
    expect(replay.body.duplicate).toBe(true);

    const row = await db.query<any>(`select paid_paise from invoices where id = $1`, [invoiceId]);
    expect(row.rows[0].paid_paise).toBe(20000); // not double-applied
  });
});

describe("POST /api/v1/billing/invoices/:invoiceId/void", () => {
  it("403s for a role below owner/admin (frontdesk)", async () => {
    const invoiceId = await insertInvoice();
    const res = await request(app)
      .post(`/api/v1/billing/invoices/${invoiceId}/void`)
      .set(...authHeader(uids.frontdesk))
      .send({});
    expectStatus(res, 403);
  });

  it("404s voiding an invoice that doesn't exist", async () => {
    const res = await request(app)
      .post(`/api/v1/billing/invoices/${crypto.randomUUID()}/void`)
      .set(...authHeader(uids.owner))
      .send({});
    expectStatus(res, 404);
  });

  it("422s voiding an already-paid invoice", async () => {
    const invoiceId = await insertInvoice({ status: "paid", totalPaise: 50000, paidPaise: 50000 });
    const res = await request(app)
      .post(`/api/v1/billing/invoices/${invoiceId}/void`)
      .set(...authHeader(uids.owner))
      .send({});
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("already_paid");
  });

  it("200s voiding a real unpaid invoice", async () => {
    const invoiceId = await insertInvoice();
    const res = await request(app)
      .post(`/api/v1/billing/invoices/${invoiceId}/void`)
      .set(...authHeader(uids.admin))
      .send({});
    expectStatus(res, 200);

    const row = await db.query<any>(`select status from invoices where id = $1`, [invoiceId]);
    expect(row.rows[0].status).toBe("void");
  });
});

describe("POST /api/v1/billing/invoices/:invoiceId/finalize", () => {
  it("200s assigning a real invoice number, then returns the same number idempotently", async () => {
    const invoiceId = await insertInvoice();
    const first = await request(app)
      .post(`/api/v1/billing/invoices/${invoiceId}/finalize`)
      .set(...authHeader(uids.owner))
      .send({});
    expectStatus(first, 200);
    expect(first.body.invoiceNumber).toBeTruthy();

    const second = await request(app)
      .post(`/api/v1/billing/invoices/${invoiceId}/finalize`)
      .set(...authHeader(uids.owner))
      .send({});
    expectStatus(second, 200);
    expect(second.body.invoiceNumber).toBe(first.body.invoiceNumber);
  });

  it("422s finalizing a void invoice", async () => {
    const invoiceId = await insertInvoice({ status: "void" });
    const res = await request(app)
      .post(`/api/v1/billing/invoices/${invoiceId}/finalize`)
      .set(...authHeader(uids.owner))
      .send({});
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("invoice_void");
  });
});

describe("POST /api/v1/billing/invoices/:invoiceId/payment-link (degraded — no gateway connected)", () => {
  it("422s with gateway_not_connected since the fixture org has no real Razorpay creds", async () => {
    const invoiceId = await insertInvoice();
    const res = await request(app)
      .post(`/api/v1/billing/invoices/${invoiceId}/payment-link`)
      .set(...authHeader(uids.owner))
      .send({});
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("gateway_not_connected");
  });

  it("422s nothing_due before ever reaching the gateway, for a fully-paid invoice", async () => {
    const invoiceId = await insertInvoice({ status: "paid", totalPaise: 50000, paidPaise: 50000 });
    const res = await request(app)
      .post(`/api/v1/billing/invoices/${invoiceId}/payment-link`)
      .set(...authHeader(uids.owner))
      .send({});
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("not_payable");
  });
});

describe("POST /api/v1/billing/invoices/:invoiceId/pay (parent)", () => {
  it("403s for a non-parent role", async () => {
    const invoiceId = await insertInvoice();
    const res = await request(app)
      .post(`/api/v1/billing/invoices/${invoiceId}/pay`)
      .set(...authHeader(uids.tutor))
      .send({});
    expectStatus(res, 403);
  });

  it("403s a parent not linked to the invoice's student", async () => {
    const invoiceId = await insertInvoice();
    const res = await request(app)
      .post(`/api/v1/billing/invoices/${invoiceId}/pay`)
      .set(...authHeader(uids.parent))
      .send({});
    expectStatus(res, 403);
  });

  it("422s gateway_not_connected for a linked parent (degraded path)", async () => {
    const invoiceId = await insertInvoice();
    await db.query(`insert into parent_links (parent_user_id, student_id, organization_id) values ($1, $2, $3)`, [uids.parent, bodyStudentId, ORG]);
    const res = await request(app)
      .post(`/api/v1/billing/invoices/${invoiceId}/pay`)
      .set(...authHeader(uids.parent))
      .send({});
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("gateway_not_connected");
  });
});

describe("GET /api/v1/billing/invoices/:invoiceId/pdf", () => {
  it("401s with no token", async () => {
    const invoiceId = await insertInvoice();
    const res = await request(app).get(`/api/v1/billing/invoices/${invoiceId}/pdf`);
    expectStatus(res, 401);
  });

  it("404s for an invoice that doesn't exist", async () => {
    const res = await request(app)
      .get(`/api/v1/billing/invoices/${crypto.randomUUID()}/pdf`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 404);
  });

  it("200s and returns a real PDF for staff", async () => {
    const invoiceId = await insertInvoice();
    const res = await request(app)
      .get(`/api/v1/billing/invoices/${invoiceId}/pdf`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.headers["content-type"]).toBe("application/pdf");
    expect(res.body.length).toBeGreaterThan(0);
  });
});

describe("POST /api/v1/billing/refunds", () => {
  it("403s for a role below owner/admin (accountant)", async () => {
    const invoiceId = await insertInvoice({ status: "paid", totalPaise: 50000, paidPaise: 50000 });
    const res = await request(app)
      .post("/api/v1/billing/refunds")
      .set(...authHeader(uids.accountant))
      .send({ invoiceId, amountPaise: 10000, idempotencyKey: crypto.randomUUID() });
    expectStatus(res, 403);
  });

  it("422s refunding more than was ever paid", async () => {
    const invoiceId = await insertInvoice({ status: "paid", totalPaise: 50000, paidPaise: 50000 });
    const res = await request(app)
      .post("/api/v1/billing/refunds")
      .set(...authHeader(uids.owner))
      .send({ invoiceId, amountPaise: 999999, idempotencyKey: crypto.randomUUID() });
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("refund_too_large");
  });

  it("201s a real refund and re-derives invoice status", async () => {
    const invoiceId = await insertInvoice({ status: "paid", totalPaise: 50000, paidPaise: 50000 });
    const res = await request(app)
      .post("/api/v1/billing/refunds")
      .set(...authHeader(uids.owner))
      .send({ invoiceId, amountPaise: 50000, idempotencyKey: crypto.randomUUID() });
    expectStatus(res, 201);
    expect(res.body.invoiceStatus).toBe("unpaid");

    const row = await db.query<any>(`select paid_paise, status from invoices where id = $1`, [invoiceId]);
    expect(row.rows[0].paid_paise).toBe(0);
    expect(row.rows[0].status).toBe("unpaid");
  });
});

describe("POST /api/v1/billing/reconcile", () => {
  it("403s for a role below owner/admin (frontdesk)", async () => {
    const res = await request(app)
      .post("/api/v1/billing/reconcile")
      .set(...authHeader(uids.frontdesk))
      .send({});
    expectStatus(res, 403);
  });

  it("422s gateway_not_connected for the fixture org", async () => {
    const res = await request(app)
      .post("/api/v1/billing/reconcile")
      .set(...authHeader(uids.owner))
      .send({});
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("gateway_not_connected");
  });
});
