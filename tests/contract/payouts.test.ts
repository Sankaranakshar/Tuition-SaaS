import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, uids } from "../integration/fixtures.ts";

let app: any;
let db: PGlite;
// fixtures.ts's uids.* are hand-picked "1000...-0004" style ids — valid
// Postgres uuids but not valid RFC 4122 v1-8 uuids (version/variant nibbles
// are '0'), so shared/schemas/payouts.ts's z.string().uuid() body validation
// correctly rejects them (same note as tests/contract/scheduling.test.ts).
// tutorId only ever appears as a URL path param (unvalidated by zod) in the
// rate-setting tests below, which is why those can keep using uids.tutor
// directly — but POST /payout-runs takes tutorId in the JSON body, so the
// payout-run tests use these real v4 ids instead.
let bodyTutorId: string;
let bodyTutorId2: string;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

async function setRate(tutorId: string, orgId: string, hourlyRatePaise: number) {
  await db.query(
    `insert into tutor_compensation_rates (tutor_id, organization_id, hourly_rate_paise)
     values ($1, $2, $3)
     on conflict (tutor_id, organization_id) do update set hourly_rate_paise = excluded.hourly_rate_paise`,
    [tutorId, orgId, hourlyRatePaise]
  );
}

async function insertSession(overrides: Partial<{ tutorId: string; startTime: Date; durationMinutes: number; templateId: string | null }> = {}) {
  const id = crypto.randomUUID();
  const start = overrides.startTime ?? new Date(Date.now() - 3600 * 1000);
  const end = new Date(start.getTime() + (overrides.durationMinutes ?? 60) * 60000);
  await db.query(
    `insert into class_sessions (id, organization_id, tutor_id, template_id, student_ids, start_time, end_time, status)
     values ($1, $2, $3, $4, $5, $6, $7, 'scheduled')`,
    [id, ORG, overrides.tutorId ?? uids.tutor, overrides.templateId ?? null, [], start.toISOString(), end.toISOString()]
  );
  return id;
}

/** A PER_SESSION-priced template, so attendance actually accrues a billable
 *  student-side charge (billed=true) — needed to exercise /attendance/reverse,
 *  which 422s not_billed otherwise. Same recipe as billing.test.ts's
 *  insertPerSessionTemplate. */
async function insertPerSessionTemplate(feeAmountRupees: number) {
  const id = crypto.randomUUID();
  await db.query(
    `insert into class_templates (id, organization_id, name, pricing_model, fee_amount) values ($1, $2, 'Payout Test Template', 'PER_SESSION', $3)`,
    [id, ORG, feeAmountRupees]
  );
  return id;
}

async function insertStudentWithWallet() {
  const id = crypto.randomUUID();
  await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Payout Test Student')`, [id, ORG]);
  await db.query(`insert into wallets (organization_id, student_id, balance_credits, balance_currency) values ($1, $2, 0, 0)`, [ORG, id]);
  return id;
}

beforeAll(async () => {
  const ta = await createTestApp();
  app = ta.app;
  db = ta.db;

  bodyTutorId = crypto.randomUUID();
  bodyTutorId2 = crypto.randomUUID();
  for (const tid of [bodyTutorId, bodyTutorId2]) {
    await db.query(`insert into auth.users (id) values ($1)`, [tid]);
    await db.query(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'tutor')`, [ORG, tid]);
  }
});

afterAll(async () => {
  await db.close();
});

describe("PUT /api/v1/payouts/tutors/:tutorId/rate", () => {
  it("401s with no token", async () => {
    const res = await request(app).put(`/api/v1/payouts/tutors/${uids.tutor}/rate`).send({ hourlyRatePaise: 50000 });
    expectStatus(res, 401);
  });

  it("403s for a role outside owner/admin (accountant, tutor themselves)", async () => {
    const asAccountant = await request(app)
      .put(`/api/v1/payouts/tutors/${uids.tutor}/rate`)
      .set(...authHeader(uids.accountant))
      .send({ hourlyRatePaise: 50000 });
    expectStatus(asAccountant, 403);

    const asSelf = await request(app)
      .put(`/api/v1/payouts/tutors/${uids.tutor}/rate`)
      .set(...authHeader(uids.tutor))
      .send({ hourlyRatePaise: 999999 });
    expectStatus(asSelf, 403);
  });

  it("404s for a userId that isn't a tutor in this org", async () => {
    const res = await request(app)
      .put(`/api/v1/payouts/tutors/${uids.parent}/rate`)
      .set(...authHeader(uids.owner))
      .send({ hourlyRatePaise: 50000 });
    expectStatus(res, 404);
  });

  it("200s for owner, and the rate round-trips via GET /rates", async () => {
    const res = await request(app)
      .put(`/api/v1/payouts/tutors/${uids.tutor}/rate`)
      .set(...authHeader(uids.owner))
      .send({ hourlyRatePaise: 60000 });
    expectStatus(res, 200);

    const rates = await request(app).get("/api/v1/payouts/rates").set(...authHeader(uids.admin));
    expectStatus(rates, 200);
    const row = rates.body.rates.find((r: any) => r.tutorId === uids.tutor);
    expect(row?.hourlyRatePaise).toBe(60000);
  });
});

describe("earnings accrual (attendance-driven, EXECUTION_PLAN.md Step 21)", () => {
  it("accrues exactly one earnings-ledger row sized off the session's real duration when a rate is configured", async () => {
    await setRate(uids.tutor, ORG, 60000); // ₹600/hr
    const studentId = await insertStudentWithWallet();
    const sessionId = await insertSession({ durationMinutes: 90 });

    const res = await request(app)
      .post("/api/v1/billing/attendance")
      .set(...authHeader(uids.tutor))
      .send({ sessionId, records: [{ studentId, status: "absent" }] });
    expectStatus(res, 200);

    const ledger = await db.query<any>(`select * from tutor_earnings_ledger where session_id = $1`, [sessionId]);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0].tutor_id).toBe(uids.tutor);
    expect(ledger.rows[0].duration_minutes).toBe(90);
    expect(ledger.rows[0].rate_paise_per_hour).toBe(60000);
    expect(ledger.rows[0].amount_paise).toBe(90000); // ₹600/hr * 1.5h = ₹900
    expect(ledger.rows[0].payout_id).toBeNull();
  });

  it("accrues regardless of the student's attendance status (absent still pays the tutor for holding the session)", async () => {
    await setRate(uids.tutor, ORG, 60000);
    const studentId = await insertStudentWithWallet();
    const sessionId = await insertSession({ durationMinutes: 60 });

    await request(app)
      .post("/api/v1/billing/attendance")
      .set(...authHeader(uids.tutor))
      .send({ sessionId, records: [{ studentId, status: "excused" }] });

    const ledger = await db.query<any>(`select amount_paise from tutor_earnings_ledger where session_id = $1`, [sessionId]);
    expect(ledger.rows).toHaveLength(1);
    expect(ledger.rows[0].amount_paise).toBe(60000);
  });

  it("does not double-accrue when attendance is marked twice for the same session", async () => {
    await setRate(uids.tutor, ORG, 60000);
    const studentId = await insertStudentWithWallet();
    const sessionId = await insertSession({ durationMinutes: 60 });

    await request(app).post("/api/v1/billing/attendance").set(...authHeader(uids.tutor))
      .send({ sessionId, records: [{ studentId, status: "present" }] });
    await request(app).post("/api/v1/billing/attendance").set(...authHeader(uids.tutor))
      .send({ sessionId, records: [{ studentId, status: "late" }] });

    const ledger = await db.query<any>(`select * from tutor_earnings_ledger where session_id = $1`, [sessionId]);
    expect(ledger.rows).toHaveLength(1);
  });

  it("accrues nothing for a tutor with no configured rate", async () => {
    const studentId = await insertStudentWithWallet();
    const sessionId = await insertSession({ tutorId: uids.tutor2, durationMinutes: 60 });

    await request(app).post("/api/v1/billing/attendance").set(...authHeader(uids.owner))
      .send({ sessionId, records: [{ studentId, status: "present" }] });

    const ledger = await db.query<any>(`select * from tutor_earnings_ledger where session_id = $1`, [sessionId]);
    expect(ledger.rows).toHaveLength(0);
  });

  it("a per-student attendance reversal does not remove or alter the session's earnings row", async () => {
    await setRate(uids.tutor, ORG, 60000);
    const studentId = await insertStudentWithWallet();
    await db.query(`update wallets set balance_credits = 1 where organization_id = $1 and student_id = $2`, [ORG, studentId]);
    const templateId = await insertPerSessionTemplate(500);
    const sessionId = await insertSession({ durationMinutes: 60, templateId });

    await request(app).post("/api/v1/billing/attendance").set(...authHeader(uids.tutor))
      .send({ sessionId, records: [{ studentId, status: "present" }] });
    const before = await db.query<any>(`select amount_paise from tutor_earnings_ledger where session_id = $1`, [sessionId]);
    expect(before.rows).toHaveLength(1);

    const reverse = await request(app)
      .post("/api/v1/billing/attendance/reverse")
      .set(...authHeader(uids.owner))
      .send({ sessionId, studentId, reason: "no_show" });
    expectStatus(reverse, 201);

    const after = await db.query<any>(`select amount_paise from tutor_earnings_ledger where session_id = $1`, [sessionId]);
    expect(after.rows).toHaveLength(1);
    expect(after.rows[0].amount_paise).toBe(before.rows[0].amount_paise);
  });
});

describe("GET /api/v1/payouts/me/earnings", () => {
  it("403s for a non-tutor role", async () => {
    const res = await request(app).get("/api/v1/payouts/me/earnings").set(...authHeader(uids.owner));
    expectStatus(res, 403);
  });

  it("200s for the tutor themselves and only returns their own rows", async () => {
    await setRate(uids.tutor, ORG, 40000);
    const studentId = await insertStudentWithWallet();
    const sessionId = await insertSession({ durationMinutes: 60 });
    await request(app).post("/api/v1/billing/attendance").set(...authHeader(uids.tutor))
      .send({ sessionId, records: [{ studentId, status: "present" }] });

    const res = await request(app).get("/api/v1/payouts/me/earnings").set(...authHeader(uids.tutor));
    expectStatus(res, 200);
    expect(res.body.earnings.some((e: any) => e.sessionId === sessionId)).toBe(true);
  });
});

describe("GET /api/v1/payouts/earnings (staff view)", () => {
  it("403s for a tutor (not staff)", async () => {
    const res = await request(app).get(`/api/v1/payouts/earnings?tutorId=${uids.tutor}`).set(...authHeader(uids.tutor));
    expectStatus(res, 403);
  });

  it("422s with no tutorId", async () => {
    const res = await request(app).get("/api/v1/payouts/earnings").set(...authHeader(uids.owner));
    expectStatus(res, 422);
  });

  it("200s for owner/admin/accountant", async () => {
    const res = await request(app).get(`/api/v1/payouts/earnings?tutorId=${uids.tutor}`).set(...authHeader(uids.accountant));
    expectStatus(res, 200);
  });
});

describe("POST /api/v1/payouts/payout-runs", () => {
  it("422s nothing_to_pay when there are no unpaid earnings in the period", async () => {
    const res = await request(app)
      .post("/api/v1/payouts/payout-runs")
      .set(...authHeader(uids.owner))
      .send({ tutorId: bodyTutorId, periodStart: "2020-01-01", periodEnd: "2020-02-01" });
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("nothing_to_pay");
  });

  it("sums unpaid earnings in the period, computes TDS, and marks the rows paid-out", async () => {
    await db.query(`update organizations set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{payouts}', '{"tdsPercent": 10}'::jsonb) where id = $1`, [ORG]);
    await setRate(bodyTutorId, ORG, 100000); // ₹1000/hr
    const studentId = await insertStudentWithWallet();
    const inPeriod = new Date();
    const sessionId = await insertSession({ tutorId: bodyTutorId, startTime: inPeriod, durationMinutes: 60 });
    await request(app).post("/api/v1/billing/attendance").set(...authHeader(uids.owner))
      .send({ sessionId, records: [{ studentId, status: "present" }] });

    const periodStart = new Date(inPeriod.getTime() - 24 * 3600 * 1000).toISOString().slice(0, 10);
    const periodEnd = new Date(inPeriod.getTime() + 24 * 3600 * 1000).toISOString().slice(0, 10);
    const res = await request(app)
      .post("/api/v1/payouts/payout-runs")
      .set(...authHeader(uids.owner))
      .send({ tutorId: bodyTutorId, periodStart, periodEnd });
    expectStatus(res, 201);
    expect(res.body.payout.grossPaise).toBeGreaterThanOrEqual(100000);
    expect(res.body.payout.tdsPaise).toBe(Math.round(res.body.payout.grossPaise * 0.1));
    expect(res.body.payout.netPaise).toBe(res.body.payout.grossPaise - res.body.payout.tdsPaise);

    const ledgerRow = await db.query<any>(`select payout_id from tutor_earnings_ledger where session_id = $1`, [sessionId]);
    expect(ledgerRow.rows[0].payout_id).toBe(res.body.payout.id);

    // A second run over the same period has nothing left unpaid.
    const again = await request(app)
      .post("/api/v1/payouts/payout-runs")
      .set(...authHeader(uids.owner))
      .send({ tutorId: bodyTutorId, periodStart, periodEnd });
    expectStatus(again, 422);
  });
});

describe("POST /api/v1/payouts/payout-runs/:id/mark-paid and statement", () => {
  it("marks a payout paid and rejects a second mark-paid", async () => {
    await setRate(bodyTutorId2, ORG, 50000);
    const studentId = await insertStudentWithWallet();
    const sessionId = await insertSession({ tutorId: bodyTutorId2, durationMinutes: 60 });
    await request(app).post("/api/v1/billing/attendance").set(...authHeader(uids.owner))
      .send({ sessionId, records: [{ studentId, status: "present" }] });

    const run = await request(app)
      .post("/api/v1/payouts/payout-runs")
      .set(...authHeader(uids.owner))
      .send({ tutorId: bodyTutorId2, periodStart: "1970-01-01", periodEnd: "9999-12-31" });
    expectStatus(run, 201);
    const payoutId = run.body.payout.id;

    const marked = await request(app).post(`/api/v1/payouts/payout-runs/${payoutId}/mark-paid`).set(...authHeader(uids.owner));
    expectStatus(marked, 200);

    const again = await request(app).post(`/api/v1/payouts/payout-runs/${payoutId}/mark-paid`).set(...authHeader(uids.owner));
    expectStatus(again, 422);

    const statement = await request(app).get(`/api/v1/payouts/payout-runs/${payoutId}/statement`).set(...authHeader(uids.owner));
    expectStatus(statement, 200);
    expect(statement.headers["content-type"]).toBe("application/pdf");

    const asOtherOrg = await request(app).get(`/api/v1/payouts/payout-runs/${payoutId}/statement`).set(...authHeader(uids.outsider));
    expectStatus(asOtherOrg, 404);
  });
});
