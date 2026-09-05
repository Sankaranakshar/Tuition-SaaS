import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, OTHER_ORG, uids } from "../integration/fixtures.ts";

// B-11 / EXECUTION_PLAN.md Step 10: POST /api/v1/students/:studentId/erase.
// The founder-confirmed model (server/utils/erasure.ts): hard-delete the
// personal + academic rows, anonymize the students row into a stub, keep the
// financial trail (invoices/payments/wallets/wallet_ledger/attendance)
// untouched for 8-year retention. B-03's `balance == sum(wallet_ledger)`
// invariant must still hold afterward.

let app: any;
let db: PGlite;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

/** Builds a full student graph in `orgId`: the roster row, a portal login, a
 *  parent link, one paid invoice + payment, a wallet + ledger, an attendance
 *  record, a private note, an assessment, an enrolment, a booking request,
 *  and a document row. `walletCredits`/`walletPaise` seed a live balance
 *  (with matching ledger rows so the B-03 invariant starts satisfied). */
async function seedStudentGraph(
  orgId: string,
  opts: { name?: string; walletCredits?: number; walletPaise?: number } = {}
) {
  const name = opts.name ?? "Erasable Student";
  const studentId = crypto.randomUUID();
  const portalUserId = crypto.randomUUID();
  const parentUserId = crypto.randomUUID();
  const templateId = crypto.randomUUID();
  const sessionId = crypto.randomUUID();
  const invoiceId = crypto.randomUUID();
  await db.query(`insert into auth.users (id) values ($1), ($2)`, [portalUserId, parentUserId]);
  await db.query(
    `insert into students (id, organization_id, name, student_user_id, phone, email, parent_name, parent_phone, notes, grade)
     values ($1, $2, $3, $4, '99999-11111', 'kid@example.com', 'A Parent', '88888-22222', 'private note', '7')`,
    [studentId, orgId, name, portalUserId]
  );
  await db.query(
    `insert into parent_links (parent_user_id, student_id, organization_id) values ($1, $2, $3)`,
    [parentUserId, studentId, orgId]
  );
  await db.query(
    `insert into class_templates (id, organization_id, name) values ($1, $2, 'T')`,
    [templateId, orgId]
  );
  await db.query(
    `insert into class_sessions (id, organization_id, student_ids, student_user_ids, parent_user_ids, start_time, end_time, status)
     values ($1, $2, $3, $4, $5, now() + interval '7 days', now() + interval '7 days' + interval '1 hour', 'scheduled')`,
    [sessionId, orgId, [studentId], [portalUserId], [parentUserId]]
  );
  await db.query(
    `insert into attendance_records (organization_id, session_id, student_id, status, billed, session_start)
     values ($1, $2, $3, 'present', true, now())`,
    [orgId, sessionId, studentId]
  );
  await db.query(
    `insert into invoices (id, organization_id, student_id, total_paise, paid_paise, status)
     values ($1, $2, $3, 50000, 50000, 'paid')`,
    [invoiceId, orgId, studentId]
  );
  await db.query(
    `insert into payments (organization_id, invoice_id, student_id, amount_paise, invoice_status, idempotency_key)
     values ($1, $2, $3, 50000, 'paid', $4)`,
    [orgId, invoiceId, studentId, `pay_${studentId}`]
  );
  await db.query(
    `insert into student_notes (organization_id, student_id, author_user_id, body) values ($1, $2, $3, 'tutor note')`,
    [orgId, studentId, uids.owner]
  );
  await db.query(
    `insert into assessments (organization_id, student_id) values ($1, $2)`,
    [orgId, studentId]
  );
  await db.query(
    `insert into enrollments (organization_id, student_id, template_id) values ($1, $2, $3)`,
    [orgId, studentId, templateId]
  );
  await db.query(
    `insert into session_requests (organization_id, requested_by_user_id, student_id, template_id, status)
     values ($1, $2, $3, $4, 'pending')`,
    [orgId, parentUserId, studentId, templateId]
  );
  await db.query(
    `insert into documents (organization_id, student_id, uploaded_by_user_id, file_name, storage_path)
     values ($1, $2, $3, 'report.pdf', $4)`,
    [orgId, studentId, uids.owner, `orgs/${orgId}/documents/${studentId}/report.pdf`]
  );

  const credits = opts.walletCredits ?? 0;
  const paise = opts.walletPaise ?? 0;
  await db.query(
    `insert into wallets (organization_id, student_id, balance_credits, balance_currency)
     values ($1, $2, $3, $4)`,
    [orgId, studentId, credits, paise / 100]
  );
  if (credits !== 0 || paise !== 0) {
    await db.query(
      `insert into wallet_ledger (organization_id, student_id, type, credits, paise, reason, by, at)
       values ($1, $2, 'credit_currency', $3, $4, 'topup', 'seed', now())`,
      [orgId, studentId, credits, paise]
    );
  }
  return { studentId, portalUserId, parentUserId, sessionId, invoiceId };
}

async function ledgerSum(studentId: string) {
  const r = await db.query<any>(
    `select coalesce(sum(credits),0)::int as credits, coalesce(sum(paise),0)::bigint as paise
     from wallet_ledger where student_id = $1`,
    [studentId]
  );
  return { credits: Number(r.rows[0].credits), paise: Number(r.rows[0].paise) };
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());
});

afterAll(async () => {
  await db.close();
});

describe("POST /api/v1/students/:studentId/erase", () => {
  it("401s with no token", async () => {
    const { studentId } = await seedStudentGraph(ORG);
    const res = await request(app).post(`/api/v1/students/${studentId}/erase`).send({ confirmName: "Erasable Student" });
    expectStatus(res, 401);
  });

  it("403s for a role outside owner/admin (tutor)", async () => {
    const { studentId } = await seedStudentGraph(ORG);
    const res = await request(app)
      .post(`/api/v1/students/${studentId}/erase`)
      .set(...authHeader(uids.tutor))
      .send({ confirmName: "Erasable Student" });
    expectStatus(res, 403);
  });

  it("404s for an unknown student", async () => {
    const res = await request(app)
      .post(`/api/v1/students/${crypto.randomUUID()}/erase`)
      .set(...authHeader(uids.owner))
      .send({ confirmName: "whatever" });
    expectStatus(res, 404);
  });

  it("404s for a student in another org", async () => {
    const { studentId } = await seedStudentGraph(OTHER_ORG, { name: "Other Org Kid" });
    const res = await request(app)
      .post(`/api/v1/students/${studentId}/erase`)
      .set(...authHeader(uids.owner))
      .send({ confirmName: "Other Org Kid" });
    expectStatus(res, 404);
  });

  it("422s when the typed name doesn't match", async () => {
    const { studentId } = await seedStudentGraph(ORG);
    const res = await request(app)
      .post(`/api/v1/students/${studentId}/erase`)
      .set(...authHeader(uids.owner))
      .send({ confirmName: "Wrong Name" });
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("name_mismatch");
  });

  it("erases: wipes PII + academic rows, keeps the financial trail, holds B-03's invariant", async () => {
    const { studentId, invoiceId } = await seedStudentGraph(ORG, { name: "Full Graph Kid" });

    const res = await request(app)
      .post(`/api/v1/students/${studentId}/erase`)
      .set(...authHeader(uids.admin))
      .send({ confirmName: "Full Graph Kid" });
    expectStatus(res, 200);
    expect(res.body.walletWriteOff).toBeNull();

    // students row anonymized, not deleted
    const stu = await db.query<any>(
      `select name, phone, email, parent_name, parent_phone, notes, grade, student_user_id, is_deleted, erased_at, erased_by
       from students where id = $1`,
      [studentId]
    );
    expect(stu.rows).toHaveLength(1);
    expect(stu.rows[0].name).toBe("Erased student");
    expect(stu.rows[0].phone).toBeNull();
    expect(stu.rows[0].email).toBeNull();
    expect(stu.rows[0].parent_name).toBeNull();
    expect(stu.rows[0].parent_phone).toBeNull();
    expect(stu.rows[0].notes).toBeNull();
    expect(stu.rows[0].grade).toBeNull();
    expect(stu.rows[0].student_user_id).toBeNull();
    expect(stu.rows[0].is_deleted).toBe(true);
    expect(stu.rows[0].erased_at).not.toBeNull();
    expect(stu.rows[0].erased_by).toBe(uids.admin);

    // personal / academic rows hard-deleted
    for (const table of ["student_notes", "assessments", "enrollments", "parent_links", "session_requests", "documents"]) {
      const r = await db.query<any>(`select count(*)::int as n from ${table} where student_id = $1`, [studentId]);
      expect(r.rows[0].n, `${table} should be empty`).toBe(0);
    }

    // financial trail kept
    const inv = await db.query<any>(`select status, total_paise from invoices where id = $1`, [invoiceId]);
    expect(inv.rows[0].status).toBe("paid");
    expect(inv.rows[0].total_paise).toBe(50000);
    const pay = await db.query<any>(`select count(*)::int as n from payments where student_id = $1`, [studentId]);
    expect(pay.rows[0].n).toBe(1);
    const att = await db.query<any>(`select count(*)::int as n from attendance_records where student_id = $1`, [studentId]);
    expect(att.rows[0].n).toBe(1);

    // B-03: wallet balance still equals the ledger sum (here, both zero)
    const wal = await db.query<any>(`select balance_credits, balance_currency from wallets where student_id = $1`, [studentId]);
    const sum = await ledgerSum(studentId);
    expect(wal.rows[0].balance_credits).toBe(sum.credits);
    expect(Math.round(Number(wal.rows[0].balance_currency) * 100)).toBe(sum.paise);

    // audit row
    const audit = await db.query<any>(
      `select action, payload from audit_events where action = 'student.erased' and payload->>'entityId' = $1`,
      [studentId]
    );
    expect(audit.rows).toHaveLength(1);
    expect(audit.rows[0].payload.deleted.studentNotes).toBe(1);
  });

  it("409s re-erasing an already-erased student", async () => {
    const { studentId } = await seedStudentGraph(ORG, { name: "Twice Kid" });
    await request(app).post(`/api/v1/students/${studentId}/erase`).set(...authHeader(uids.owner)).send({ confirmName: "Twice Kid" });
    const res = await request(app)
      .post(`/api/v1/students/${studentId}/erase`)
      .set(...authHeader(uids.owner))
      .send({ confirmName: "Twice Kid" });
    expectStatus(res, 409);
    expect(res.body.error.code).toBe("already_erased");
  });

  it("409s under the default 'block' policy when the wallet still has a balance", async () => {
    const { studentId } = await seedStudentGraph(ORG, { name: "Rich Kid", walletPaise: 200000, walletCredits: 3 });
    const res = await request(app)
      .post(`/api/v1/students/${studentId}/erase`)
      .set(...authHeader(uids.owner))
      .send({ confirmName: "Rich Kid" });
    expectStatus(res, 409);
    expect(res.body.error.code).toBe("wallet_balance_outstanding");
    // nothing was erased
    const stu = await db.query<any>(`select name, erased_at from students where id = $1`, [studentId]);
    expect(stu.rows[0].name).toBe("Rich Kid");
    expect(stu.rows[0].erased_at).toBeNull();
  });

  it("under 'writeoff' policy: zeroes the wallet with a ledger entry, keeps B-03's invariant, then erases", async () => {
    // fresh org so the settings change is isolated from the other tests
    const orgId = crypto.randomUUID();
    const ownerId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [ownerId]);
    await db.query(
      `insert into organizations (id, name, settings) values ($1, 'Writeoff Org', '{"erasure":{"walletPolicy":"writeoff"}}'::jsonb)`,
      [orgId]
    );
    await db.query(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')`, [orgId, ownerId]);
    const { studentId } = await seedStudentGraph(orgId, { name: "WO Kid", walletPaise: 150000, walletCredits: 2 });

    const res = await request(app)
      .post(`/api/v1/students/${studentId}/erase`)
      .set(...authHeader(ownerId))
      .send({ confirmName: "WO Kid" });
    expectStatus(res, 200);
    expect(res.body.walletWriteOff).toEqual({ credits: 2, paise: 150000 });

    const wal = await db.query<any>(`select balance_credits, balance_currency from wallets where student_id = $1`, [studentId]);
    expect(wal.rows[0].balance_credits).toBe(0);
    expect(Number(wal.rows[0].balance_currency)).toBe(0);

    const sum = await ledgerSum(studentId);
    expect(sum.credits).toBe(0);
    expect(sum.paise).toBe(0);

    const wo = await db.query<any>(
      `select credits, paise, reason from wallet_ledger where student_id = $1 and type = 'erasure_writeoff'`,
      [studentId]
    );
    expect(wo.rows).toHaveLength(1);
    expect(wo.rows[0].credits).toBe(-2);
    expect(wo.rows[0].paise).toBe(-150000);

    const stu = await db.query<any>(`select name, erased_at from students where id = $1`, [studentId]);
    expect(stu.rows[0].name).toBe("Erased student");
    expect(stu.rows[0].erased_at).not.toBeNull();

    const woAudit = await db.query<any>(
      `select count(*)::int as n from audit_events where action = 'student.erased' and payload->>'entityId' = $1`,
      [studentId]
    );
    expect(woAudit.rows[0].n).toBe(1);
  });

  it("detaches the portal login from future scheduled sessions", async () => {
    const { studentId, portalUserId, sessionId } = await seedStudentGraph(ORG, { name: "Future Kid" });
    await request(app).post(`/api/v1/students/${studentId}/erase`).set(...authHeader(uids.owner)).send({ confirmName: "Future Kid" });
    const sess = await db.query<any>(`select student_user_ids, parent_user_ids from class_sessions where id = $1`, [sessionId]);
    expect(sess.rows[0].student_user_ids).not.toContain(portalUserId);
  });
});
