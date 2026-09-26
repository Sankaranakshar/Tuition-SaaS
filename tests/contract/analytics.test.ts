import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, OTHER_ORG, uids } from "../integration/fixtures.ts";

// C-07 (EXECUTION_PLAN.md Step 32): the client event route, the server-side
// instrumentation on the real routes, the analytics-rollup cron, and the
// platform admin's analytics report.

const CRON_SECRET = "test-cron-secret-do-not-use-in-prod";

let app: any;
let db: PGlite;
let platformAdminId: string;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

async function newUser(): Promise<string> {
  const id = crypto.randomUUID();
  await db.query(`insert into auth.users (id) values ($1)`, [id]);
  return id;
}

async function events(where: string, params: unknown[]) {
  const res = await db.query<any>(`select organization_id, actor_user_id, name, properties, dedupe_key, occurred_at from product_events where ${where} order by occurred_at`, params);
  return res.rows;
}

/** An org with its own student, `sessions` past sessions with attendance marked, and `collectedPaise` paid. */
async function orgWithActivity(opts: { sessions: number; collectedPaise: number; name?: string }) {
  const orgId = crypto.randomUUID();
  await db.query(`insert into organizations (id, name) values ($1, $2)`, [orgId, opts.name ?? "Analytics Org"]);
  const studentId = crypto.randomUUID();
  await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Asha Rao')`, [studentId, orgId]);
  const sessionIds: string[] = [];
  for (let i = 0; i < opts.sessions; i++) {
    const sessionId = crypto.randomUUID();
    const start = new Date(Date.now() - (i + 1) * 3600 * 1000);
    await db.query(
      `insert into class_sessions (id, organization_id, student_ids, start_time, end_time, status) values ($1, $2, $3, $4, $5, 'completed')`,
      [sessionId, orgId, [studentId], start.toISOString(), new Date(start.getTime() + 3600 * 1000).toISOString()]
    );
    await db.query(
      `insert into attendance_records (organization_id, session_id, student_id, status, session_start) values ($1, $2, $3, 'present', $4)`,
      [orgId, sessionId, studentId, start.toISOString()]
    );
    sessionIds.push(sessionId);
  }
  if (opts.collectedPaise > 0) {
    await db.query(
      `insert into payments (organization_id, student_id, amount_paise, method, invoice_status, idempotency_key) values ($1, $2, $3, 'cash', 'paid', $4)`,
      [orgId, studentId, opts.collectedPaise, crypto.randomUUID()]
    );
  }
  return { orgId, studentId, sessionIds };
}

const rollup = () => request(app).get("/api/cron/analytics-rollup").set("Authorization", `Bearer ${CRON_SECRET}`);

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  process.env.CRON_SECRET = CRON_SECRET;
  platformAdminId = await newUser();
  await db.query(`insert into platform_admins (user_id) values ($1)`, [platformAdminId]);
});

afterAll(async () => {
  delete process.env.CRON_SECRET;
  await db.close();
});

describe("POST /api/v1/analytics/events (the browser's only way in)", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/analytics/events").send({ name: "feature.opened", properties: { feature: "money" } });
    expectStatus(res, 401);
  });

  it("400s a server-only or unknown event name, so a client cannot fake activation or a payment", async () => {
    for (const name of ["org.activated", "payment.recorded", "org.created", "made.up"]) {
      const res = await request(app).post("/api/v1/analytics/events").set(...authHeader(uids.owner)).send({ name, properties: {} });
      expectStatus(res, 400);
      expect(res.body.error.code).toBe("unknown_event");
    }
  });

  it("400s properties outside the payload rule: free text, a student id, an org id in the body", async () => {
    const cases = [
      { name: "feature.opened", properties: { feature: "Asha Rao" } },
      { name: "feature.opened", properties: { feature: "money", studentId: crypto.randomUUID() } },
      { name: "feature.opened", properties: { feature: "money", organizationId: OTHER_ORG } },
      { name: "onboarding.beat_viewed", properties: { beat: 1, note: "+919876543210" } },
    ];
    for (const body of cases) {
      const res = await request(app).post("/api/v1/analytics/events").set(...authHeader(uids.owner)).send(body);
      expectStatus(res, 400);
      expect(res.body.error.code).toBe("invalid_properties");
    }
    const written = await events(`actor_user_id = $1`, [uids.owner]);
    expect(written).toEqual([]);
  });

  it("records an onboarding beat for a person with no org yet, once per beat", async () => {
    const userId = await newUser();
    const first = await request(app).post("/api/v1/analytics/events").set(...authHeader(userId)).send({ name: "onboarding.beat_viewed", properties: { beat: 1 } });
    expectStatus(first, 202);
    expect(first.body.recorded).toBe(true);
    const again = await request(app).post("/api/v1/analytics/events").set(...authHeader(userId)).send({ name: "onboarding.beat_viewed", properties: { beat: 1 } });
    expectStatus(again, 202);
    expect(again.body.recorded).toBe(false);
    const rows = await events(`actor_user_id = $1`, [userId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ organization_id: null, name: "onboarding.beat_viewed", properties: { beat: 1 } });
  });

  it("stamps the caller's own org from the session, ignoring an X-Organization-Id they don't belong to", async () => {
    const res = await request(app)
      .post("/api/v1/analytics/events")
      .set(...authHeader(uids.owner))
      .set("X-Organization-Id", OTHER_ORG)
      .send({ name: "feature.opened", properties: { feature: "money" } });
    expectStatus(res, 202);
    const rows = await events(`actor_user_id = $1 and name = 'feature.opened'`, [uids.owner]);
    expect(rows).toHaveLength(1);
    expect(rows[0].organization_id).toBe(ORG);
    // A second open of the same workspace the same day is not a second event.
    await request(app).post("/api/v1/analytics/events").set(...authHeader(uids.owner)).send({ name: "feature.opened", properties: { feature: "money" } });
    expect(await events(`actor_user_id = $1 and name = 'feature.opened'`, [uids.owner])).toHaveLength(1);
  });

  it("403s feature usage from someone with no org", async () => {
    const userId = await newUser();
    const res = await request(app).post("/api/v1/analytics/events").set(...authHeader(userId)).send({ name: "feature.opened", properties: { feature: "today" } });
    expectStatus(res, 403);
  });

  it("parent.portal_opened: 202 for the org's parent, 403 for staff", async () => {
    const ok = await request(app).post("/api/v1/analytics/events").set(...authHeader(uids.parent)).send({ name: "parent.portal_opened" });
    expectStatus(ok, 202);
    expect(await events(`actor_user_id = $1 and name = 'parent.portal_opened'`, [uids.parent])).toHaveLength(1);
    const staff = await request(app).post("/api/v1/analytics/events").set(...authHeader(uids.owner)).send({ name: "parent.portal_opened" });
    expectStatus(staff, 403);
  });
});

describe("server-side instrumentation on the real routes", () => {
  it("bootstrap emits org.created for the new org, attributed to its creator", async () => {
    const userId = await newUser();
    const res = await request(app).post("/api/v1/members/bootstrap").set(...authHeader(userId)).send({ organizationName: "Funnel Tutoring" });
    expectStatus(res, 201);
    const rows = await events(`name = 'org.created' and organization_id = $1`, [res.body.organizationId]);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actor_user_id: userId, properties: {}, dedupe_key: `org.created:${res.body.organizationId}` });
  });

  it("marking attendance emits attendance.marked with counts only, never a student id or name", async () => {
    const studentId = crypto.randomUUID();
    await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Asha Rao')`, [studentId, ORG]);
    const sessionId = crypto.randomUUID();
    await db.query(
      `insert into class_sessions (id, organization_id, tutor_id, student_ids, start_time, end_time, status)
       values ($1, $2, $3, $4, now() - interval '2 hours', now() - interval '1 hour', 'scheduled')`,
      [sessionId, ORG, uids.tutor, [studentId]]
    );
    const res = await request(app)
      .post("/api/v1/billing/attendance")
      .set(...authHeader(uids.owner))
      .send({ sessionId, records: [{ studentId, status: "present" }] });
    expectStatus(res, 200);
    const rows = await events(`name = 'attendance.marked' and properties ->> 'sessionId' = $1`, [sessionId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].organization_id).toBe(ORG);
    expect(rows[0].properties).toEqual({ sessionId, present: 1, absent: 0, billed: 0, invoiced: 0 });
    expect(JSON.stringify(rows[0].properties)).not.toContain(studentId);
    expect(JSON.stringify(rows[0].properties)).not.toContain("Asha");
  });

  it("a manual payment emits payment.recorded once, even when the request is replayed", async () => {
    const studentId = crypto.randomUUID();
    await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Payer')`, [studentId, ORG]);
    const invoiceId = crypto.randomUUID();
    await db.query(
      `insert into invoices (id, organization_id, student_id, total_paise, paid_paise, subtotal_paise, status) values ($1, $2, $3, 50000, 0, 50000, 'unpaid')`,
      [invoiceId, ORG, studentId]
    );
    const idempotencyKey = crypto.randomUUID();
    for (const expected of [201, 200]) {
      const res = await request(app)
        .post("/api/v1/billing/payments/manual")
        .set(...authHeader(uids.owner))
        .send({ invoiceId, amountPaise: 50000, method: "upi", idempotencyKey });
      expectStatus(res, expected);
    }
    const rows = await events(`name = 'payment.recorded' and properties ->> 'invoiceId' = $1`, [invoiceId]);
    expect(rows).toHaveLength(1);
    expect(rows[0].properties).toEqual({ invoiceId, amountPaise: 50000, channel: "manual", method: "upi" });
  });
});

describe("GET/POST /api/cron/analytics-rollup", () => {
  it("404s without the cron secret, for GET and POST", async () => {
    expectStatus(await request(app).get("/api/cron/analytics-rollup"), 404);
    expectStatus(await request(app).post("/api/cron/analytics-rollup").set("Authorization", "Bearer wrong"), 404);
  });

  it("runs on GET (what Vercel Cron sends) and on POST", async () => {
    const get = await rollup();
    expectStatus(get, 200);
    expect(get.body.ok).toBe(true);
    const post = await request(app).post("/api/cron/analytics-rollup").set("x-cron-secret", CRON_SECRET);
    expectStatus(post, 200);
    expect(post.body.ok).toBe(true);
  });

  it("activates an org with 10 attended sessions and ₹1 collected, counting only that org's own rows", async () => {
    const { orgId } = await orgWithActivity({ sessions: 10, collectedPaise: 500, name: "Activated Org" });
    // Another org's money must not leak into this one's numbers.
    await db.query(
      `insert into payments (organization_id, amount_paise, method, invoice_status, idempotency_key) values ($1, 999900, 'cash', 'paid', $2)`,
      [OTHER_ORG, crypto.randomUUID()]
    );
    const res = await rollup();
    expectStatus(res, 200);

    const act = await db.query<any>(`select * from org_activation where organization_id = $1`, [orgId]);
    expect(act.rows[0].sessions_attended_in_window).toBe(10);
    expect(Number(act.rows[0].collected_in_window_paise)).toBe(500);
    expect(Number(act.rows[0].collected_online_in_window_paise)).toBe(0);
    expect(act.rows[0].activated_at).not.toBeNull();

    const weeks = await db.query<any>(`select * from org_weekly_loop where organization_id = $1`, [orgId]);
    const total = (col: string) => weeks.rows.reduce((s: number, r: any) => s + Number(r[col]), 0);
    expect(total("sessions_attended")).toBe(10);
    expect(total("attendance_marked")).toBe(10);
    expect(total("collected_paise")).toBe(500);

    const activated = await events(`name = 'org.activated' and organization_id = $1`, [orgId]);
    expect(activated).toHaveLength(1);
    expect(activated[0].properties).toMatchObject({ sessionsAttended: 10, collectedPaise: 500, daysToActivate: 0 });
  });

  it("is idempotent: a re-run writes identical rows and never a second org.activated", async () => {
    const { orgId } = await orgWithActivity({ sessions: 10, collectedPaise: 100, name: "Rerun Org" });
    await rollup();
    const snapshot = async () => ({
      act: (await db.query<any>(`select * from org_activation where organization_id = $1`, [orgId])).rows.map(({ computed_at, ...r }) => r),
      weeks: (await db.query<any>(`select * from org_weekly_loop where organization_id = $1 order by week_start`, [orgId])).rows.map(({ computed_at, ...r }) => r),
    });
    const before = await snapshot();
    const second = await rollup();
    expectStatus(second, 200);
    expect(await snapshot()).toEqual(before);
    expect(await events(`name = 'org.activated' and organization_id = $1`, [orgId])).toHaveLength(1);
  });

  it("does not count a reversed session or activate on 9 sessions; ignores offboarded orgs", async () => {
    const { orgId, sessionIds } = await orgWithActivity({ sessions: 10, collectedPaise: 500, name: "Reversed Org" });
    await db.query(`update attendance_records set reversed_at = now() where session_id = $1`, [sessionIds[0]]);
    const gone = await orgWithActivity({ sessions: 10, collectedPaise: 500, name: "Offboarded Org" });
    await db.query(`update organizations set status = 'offboarded' where id = $1`, [gone.orgId]);
    await rollup();
    const act = await db.query<any>(`select sessions_attended_in_window, activated_at from org_activation where organization_id = $1`, [orgId]);
    expect(act.rows[0]).toEqual({ sessions_attended_in_window: 9, activated_at: null });
    expect(await events(`name = 'org.activated' and organization_id = $1`, [orgId])).toHaveLength(0);
    expect((await db.query(`select 1 from org_activation where organization_id = $1`, [gone.orgId])).rows).toHaveLength(0);
  });
});

describe("GET /api/v1/admin/analytics", () => {
  it("401s with no token and 403s for an org owner who isn't a platform admin", async () => {
    expectStatus(await request(app).get("/api/v1/admin/analytics"), 401);
    expectStatus(await request(app).get("/api/v1/admin/analytics").set(...authHeader(uids.owner)), 403);
  });

  it("reports the funnel, activation, and rupees collected per org per month", async () => {
    // A person walks the three beats and finishes onboarding.
    const starter = await newUser();
    for (const beat of [1, 2, 3]) {
      await request(app).post("/api/v1/analytics/events").set(...authHeader(starter)).send({ name: "onboarding.beat_viewed", properties: { beat } });
    }
    const boot = await request(app).post("/api/v1/members/bootstrap").set(...authHeader(starter)).send({ organizationName: "Starter Tutoring" });
    expectStatus(boot, 201);
    // Another stops at beat 2.
    const quitter = await newUser();
    for (const beat of [1, 2]) {
      await request(app).post("/api/v1/analytics/events").set(...authHeader(quitter)).send({ name: "onboarding.beat_viewed", properties: { beat } });
    }
    await rollup();

    const res = await request(app).get("/api/v1/admin/analytics").set(...authHeader(platformAdminId));
    expectStatus(res, 200);
    const r = res.body;
    expect(r.activationDefinition).toEqual({ windowDays: 14, minSessionsAttended: 10, minCollectedPaise: 100 });
    expect(r.rolledUpAt).toBeTruthy();

    const funnel = Object.fromEntries(r.onboardingFunnel.steps.map((s: any) => [s.key, s.count]));
    // Two starters from this test, plus the one from the beat-dedupe test above.
    expect(funnel.beat_1).toBe(3);
    expect(funnel.beat_2).toBe(2);
    expect(funnel.beat_3).toBe(1);
    expect(funnel.org_created).toBe(1);
    expect(funnel.activated).toBe(0);

    const activated = r.activation.find((a: any) => a.name === "Activated Org");
    expect(activated).toMatchObject({ sessionsAttendedInWindow: 10, collectedInWindowPaise: 500, stage: 8 });
    expect(r.orgFunnel.find((s: any) => s.key === "activated").count).toBeGreaterThanOrEqual(2);

    const month = r.monthlyCollected.months[r.monthlyCollected.months.length - 1];
    const row = r.monthlyCollected.orgs.find((o: any) => o.name === "Activated Org");
    expect(row.months.find((m: any) => m.month === month).collectedPaise).toBe(500);
    expect(r.monthlyCollected.months).toHaveLength(6);

    expect(r.cohorts.rows.length).toBeGreaterThan(0);
    expect(r.featureUsage.find((f: any) => f.feature === "money")).toMatchObject({ opens: 1, orgs: 1 });
  });
});
