import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, OTHER_ORG, uids, ids } from "../integration/fixtures.ts";
import { zonedTimeToUtc, localDateKeyInZone, hourInZone } from "../../shared/timezone.ts";

// ORG (fixtures.ts) is created with no explicit timezone, so it carries the
// migration's column default (C-01, EXECUTION_PLAN.md Step 25). Every
// materialization assertion below is built from this zone via
// shared/timezone.ts's own helpers, never from ambient Date methods — the
// point of Step 25's contract test is to prove the route is correct
// regardless of what timezone the test process itself runs under (verified
// by actually running `TZ=UTC npm run test:contract` alongside the default).
const ORG_TZ = "Asia/Kolkata";

let app: any;
let db: PGlite;

// The fixtures.ts ids (uids.*, ids.*) are hand-picked "20000000-...-0001"
// style strings — valid Postgres uuids, but not valid RFC 4122 v1-8 uuids
// (version/variant nibbles are '0'), so `shared/schemas/*.ts`'s
// `z.string().uuid()` request-body validation correctly rejects them. That's
// fine for the RLS suite (raw SQL, no zod in the path) but means any id
// referenced from an HTTP *request body* here needs a real v4 id — path
// params and Authorization-header actor ids are untouched by zod and can
// keep using the fixture ids directly.
let bodyStudentId: string;
let bodyTutorId: string;
let bodyTutorId2: string;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());

  bodyStudentId = crypto.randomUUID();
  await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Body Student')`, [bodyStudentId, ORG]);

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

describe("POST /api/v1/scheduling/enrollments", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/scheduling/enrollments").send({});
    expectStatus(res, 401);
  });

  it("403s for a role outside CAN_SCHEDULE (parent)", async () => {
    const res = await request(app)
      .post("/api/v1/scheduling/enrollments")
      .set(...authHeader(uids.parent))
      .send({ studentId: bodyStudentId, templateId: bodyStudentId });
    expectStatus(res, 403);
  });

  it("422s on a malformed body (bad uuid)", async () => {
    const res = await request(app)
      .post("/api/v1/scheduling/enrollments")
      .set(...authHeader(uids.owner))
      .send({ studentId: "not-a-uuid", templateId: "not-a-uuid" });
    expectStatus(res, 422);
  });

  it("404s enrolling against a template that doesn't exist", async () => {
    const res = await request(app)
      .post("/api/v1/scheduling/enrollments")
      .set(...authHeader(uids.owner))
      .send({ studentId: bodyStudentId, templateId: crypto.randomUUID() });
    expectStatus(res, 404);
  });

  it("200s and creates a real row for an in-role staff member (tutor)", async () => {
    const templateId = crypto.randomUUID();
    await db.query(
      `insert into class_templates (id, organization_id, name, type, capacity, days_of_week)
       values ($1, $2, 'Batch A', 'BATCH', 10, '{1}')`,
      [templateId, ORG]
    );
    const res = await request(app)
      .post("/api/v1/scheduling/enrollments")
      .set(...authHeader(uids.tutor))
      .send({ studentId: bodyStudentId, templateId });
    expectStatus(res, 200);
    expect(res.body.ok).toBe(true);
    expect(res.body.enrollmentId).toBeTruthy();

    const row = await db.query<any>(`select organization_id from enrollments where id = $1`, [res.body.enrollmentId]);
    expect(row.rows[0].organization_id).toBe(ORG);
  });

  it("409s once a BATCH template is at capacity", async () => {
    const templateId = crypto.randomUUID();
    await db.query(
      `insert into class_templates (id, organization_id, name, type, capacity, days_of_week)
       values ($1, $2, 'Full Batch', 'BATCH', 1, '{1}')`,
      [templateId, ORG]
    );
    const first = await request(app)
      .post("/api/v1/scheduling/enrollments")
      .set(...authHeader(uids.owner))
      .send({ studentId: bodyStudentId, templateId });
    expectStatus(first, 200);

    const second = await request(app)
      .post("/api/v1/scheduling/enrollments")
      .set(...authHeader(uids.owner))
      .send({ studentId: bodyStudentId, templateId });
    expectStatus(second, 409);
    expect(second.body.error.code).toBe("capacity_full");
  });

  it("403s enrolling against another org's template", async () => {
    const templateId = crypto.randomUUID();
    await db.query(
      `insert into class_templates (id, organization_id, name, type, capacity, days_of_week)
       values ($1, $2, 'Other Org Batch', 'BATCH', 10, '{1}')`,
      [templateId, OTHER_ORG]
    );
    const res = await request(app)
      .post("/api/v1/scheduling/enrollments")
      .set(...authHeader(uids.owner))
      .send({ studentId: bodyStudentId, templateId });
    expectStatus(res, 403);
  });
});

describe("POST /api/v1/scheduling/sessions", () => {
  it("200s creating a session for an in-role staff member", async () => {
    const templateId = crypto.randomUUID();
    await db.query(
      `insert into class_templates (id, organization_id, name, type, capacity, days_of_week)
       values ($1, $2, 'One-off', 'ONE_ON_ONE', 1, '{}')`,
      [templateId, ORG]
    );
    const res = await request(app)
      .post("/api/v1/scheduling/sessions")
      .set(...authHeader(uids.frontdesk))
      .send({
        templateId,
        tutorId: bodyTutorId,
        studentIds: [bodyStudentId],
        startTime: "2027-01-04T10:00:00.000Z",
        endTime: "2027-01-04T11:00:00.000Z",
      });
    expectStatus(res, 200);
    expect(res.body.sessionId).toBeTruthy();
  });

  it("409s a session that overlaps the tutor's existing schedule", async () => {
    const templateId = crypto.randomUUID();
    await db.query(
      `insert into class_templates (id, organization_id, name, type, capacity, days_of_week)
       values ($1, $2, 'One-off 2', 'ONE_ON_ONE', 1, '{}')`,
      [templateId, ORG]
    );
    const first = await request(app)
      .post("/api/v1/scheduling/sessions")
      .set(...authHeader(uids.owner))
      .send({
        templateId,
        tutorId: bodyTutorId2,
        studentIds: [bodyStudentId],
        startTime: "2027-01-05T10:00:00.000Z",
        endTime: "2027-01-05T11:00:00.000Z",
      });
    expectStatus(first, 200);

    const overlapping = await request(app)
      .post("/api/v1/scheduling/sessions")
      .set(...authHeader(uids.owner))
      .send({
        templateId,
        tutorId: bodyTutorId2,
        studentIds: [bodyStudentId],
        startTime: "2027-01-05T10:30:00.000Z",
        endTime: "2027-01-05T11:30:00.000Z",
      });
    expectStatus(overlapping, 409);
    expect(overlapping.body.error.code).toBe("conflict");
  });

  // B-07 (EXECUTION_PLAN.md Step 20): class_sessions.tutor_id is the same
  // auth.users id regardless of which org's session it is, but the
  // pre-Step-20 conflict check filtered by organization_id too — so a tutor
  // belonging to two orgs could be double-booked at the same time in each.
  // This proves the fix (scheduling.ts's assertNoTutorConflict/lockTutorSchedule
  // now scope by tutor_id alone) actually closes that gap: it fails against
  // the pre-fix code, since the two sessions live in different orgs.
  it("409s a session in one org that overlaps the same multi-org tutor's session in another org", async () => {
    const multiOrgTutorId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [multiOrgTutorId]);
    await db.query(
      `insert into organization_members (organization_id, user_id, role) values ($1, $2, 'tutor'), ($3, $2, 'tutor')`,
      [ORG, multiOrgTutorId, OTHER_ORG]
    );

    const templateInOrg = crypto.randomUUID();
    await db.query(
      `insert into class_templates (id, organization_id, name, type, capacity, days_of_week)
       values ($1, $2, 'Cross-org A', 'ONE_ON_ONE', 1, '{}')`,
      [templateInOrg, ORG]
    );
    const templateInOtherOrg = crypto.randomUUID();
    await db.query(
      `insert into class_templates (id, organization_id, name, type, capacity, days_of_week)
       values ($1, $2, 'Cross-org B', 'ONE_ON_ONE', 1, '{}')`,
      [templateInOtherOrg, OTHER_ORG]
    );

    const first = await request(app)
      .post("/api/v1/scheduling/sessions")
      .set(...authHeader(uids.owner))
      .send({
        templateId: templateInOrg,
        tutorId: multiOrgTutorId,
        startTime: "2027-01-06T10:00:00.000Z",
        endTime: "2027-01-06T11:00:00.000Z",
      });
    expectStatus(first, 200);

    const crossOrgOverlap = await request(app)
      .post("/api/v1/scheduling/sessions")
      .set(...authHeader(uids.outsider)) // owner of OTHER_ORG
      .send({
        templateId: templateInOtherOrg,
        tutorId: multiOrgTutorId,
        startTime: "2027-01-06T10:30:00.000Z",
        endTime: "2027-01-06T11:30:00.000Z",
      });
    expectStatus(crossOrgOverlap, 409);
    expect(crossOrgOverlap.body.error.code).toBe("conflict");
  });
});

describe("PATCH /api/v1/scheduling/sessions/:id", () => {
  it("404s rescheduling a session that doesn't exist", async () => {
    const res = await request(app)
      .patch(`/api/v1/scheduling/sessions/${crypto.randomUUID()}`)
      .set(...authHeader(uids.owner))
      .send({ startTime: "2027-01-06T10:00:00.000Z", endTime: "2027-01-06T11:00:00.000Z" });
    expectStatus(res, 404);
  });

  it("200s rescheduling the fixture session for in-role staff", async () => {
    const res = await request(app)
      .patch(`/api/v1/scheduling/sessions/${ids.sess1}`)
      .set(...authHeader(uids.owner))
      .send({ startTime: "2026-07-01T12:00:00.000Z", endTime: "2026-07-01T13:00:00.000Z" });
    expectStatus(res, 200);

    const row = await db.query<any>(`select start_time from class_sessions where id = $1`, [ids.sess1]);
    expect(new Date(row.rows[0].start_time).toISOString()).toBe("2026-07-01T12:00:00.000Z");
  });

  it("403s a student trying to reschedule (outside CAN_SCHEDULE)", async () => {
    const res = await request(app)
      .patch(`/api/v1/scheduling/sessions/${ids.sess1}`)
      .set(...authHeader(uids.student))
      .send({ startTime: "2027-01-07T10:00:00.000Z", endTime: "2027-01-07T11:00:00.000Z" });
    expectStatus(res, 403);
  });
});

// B-13 (EXECUTION_PLAN.md Step 23): direct single-session substitute
// assignment -- the primitive server/routes/leave.ts's bulk reassign route
// also calls, exercised standalone here since it's independently reachable.
describe("PATCH /api/v1/scheduling/sessions/:id/tutor", () => {
  it("404s reassigning a session that doesn't exist", async () => {
    const res = await request(app)
      .patch(`/api/v1/scheduling/sessions/${crypto.randomUUID()}/tutor`)
      .set(...authHeader(uids.owner))
      .send({ tutorId: bodyTutorId });
    expectStatus(res, 404);
  });

  it("403s a student trying to reassign (outside CAN_SCHEDULE)", async () => {
    const res = await request(app)
      .patch(`/api/v1/scheduling/sessions/${ids.sess1}/tutor`)
      .set(...authHeader(uids.student))
      .send({ tutorId: bodyTutorId });
    expectStatus(res, 403);
  });

  it("200s reassigning to a free substitute", async () => {
    const sessionId = crypto.randomUUID();
    await db.query(
      `insert into class_sessions (id, organization_id, tutor_id, student_ids, start_time, end_time, status)
       values ($1, $2, $3, '{}', '2027-02-01T10:00:00Z', '2027-02-01T11:00:00Z', 'scheduled')`,
      [sessionId, ORG, uids.tutor]
    );

    const res = await request(app)
      .patch(`/api/v1/scheduling/sessions/${sessionId}/tutor`)
      .set(...authHeader(uids.owner))
      .send({ tutorId: bodyTutorId });
    expectStatus(res, 200);

    const row = await db.query<any>(`select tutor_id from class_sessions where id = $1`, [sessionId]);
    expect(row.rows[0].tutor_id).toBe(bodyTutorId);
  });

  it("409s reassigning to a tutor who has a conflicting session at that time", async () => {
    const sessionId = crypto.randomUUID();
    await db.query(
      `insert into class_sessions (id, organization_id, tutor_id, student_ids, start_time, end_time, status)
       values ($1, $2, $3, '{}', '2027-02-02T10:00:00Z', '2027-02-02T11:00:00Z', 'scheduled')`,
      [sessionId, ORG, uids.tutor]
    );
    await db.query(
      `insert into class_sessions (id, organization_id, tutor_id, student_ids, start_time, end_time, status)
       values ($1, $2, $3, '{}', '2027-02-02T10:30:00Z', '2027-02-02T11:30:00Z', 'scheduled')`,
      [crypto.randomUUID(), ORG, bodyTutorId2]
    );

    const res = await request(app)
      .patch(`/api/v1/scheduling/sessions/${sessionId}/tutor`)
      .set(...authHeader(uids.owner))
      .send({ tutorId: bodyTutorId2 });
    expectStatus(res, 409);
    expect(res.body.error.code).toBe("conflict");
  });

  it("409s reassigning a completed session", async () => {
    const sessionId = crypto.randomUUID();
    await db.query(
      `insert into class_sessions (id, organization_id, tutor_id, student_ids, start_time, end_time, status)
       values ($1, $2, $3, '{}', '2027-02-03T10:00:00Z', '2027-02-03T11:00:00Z', 'completed')`,
      [sessionId, ORG, uids.tutor]
    );
    const res = await request(app)
      .patch(`/api/v1/scheduling/sessions/${sessionId}/tutor`)
      .set(...authHeader(uids.owner))
      .send({ tutorId: bodyTutorId });
    expectStatus(res, 409);
    expect(res.body.error.code).toBe("not_reassignable");
  });
});

describe("PATCH /api/v1/scheduling/templates/:id", () => {
  it("403s for a role below owner/admin (tutor)", async () => {
    const templateId = crypto.randomUUID();
    await db.query(
      `insert into class_templates (id, organization_id, name, type, capacity, days_of_week)
       values ($1, $2, 'Perm Check Batch', 'BATCH', 10, '{1}')`,
      [templateId, ORG]
    );
    const res = await request(app)
      .patch(`/api/v1/scheduling/templates/${templateId}`)
      .set(...authHeader(uids.tutor))
      .send({ scope: "future" });
    expectStatus(res, 403);
  });

  it("200s updating scope for an org admin", async () => {
    const templateId = crypto.randomUUID();
    await db.query(
      `insert into class_templates (id, organization_id, name, type, capacity, tutor_id, student_ids, days_of_week, start_hour, start_minute, duration_minutes)
       values ($1, $2, 'Retimed Batch', 'BATCH', 10, $3, $4, '{2}', 9, 0, 60)`,
      [templateId, ORG, bodyTutorId, [bodyStudentId]]
    );
    const res = await request(app)
      .patch(`/api/v1/scheduling/templates/${templateId}`)
      .set(...authHeader(uids.admin))
      .send({ scope: "future", daysOfWeek: [3], startHour: 10 });
    expectStatus(res, 200);
    expect(res.body.ok).toBe(true);
  });

  it("404s updating a template that doesn't exist", async () => {
    const res = await request(app)
      .patch(`/api/v1/scheduling/templates/${crypto.randomUUID()}`)
      .set(...authHeader(uids.owner))
      .send({ scope: "future" });
    expectStatus(res, 404);
  });
});

describe("POST /api/v1/scheduling/materialize", () => {
  // WEEKS_AHEAD in server/routes/scheduling.ts.
  const WEEKS_AHEAD = 8;
  const DOW = 1; // Monday
  const START_HOUR = 14;

  let matTutorId: string;
  let matStudentId: string;
  let matStudentUserId: string;
  let matParentUserId: string;
  let matTemplateId: string;

  /** ORG's own zone's YYYY-MM-DD for a UTC instant, matching the route's own
   *  key format (C-01: the route resolves ORG_TZ from `organizations`, not
   *  from the test process's ambient zone). */
  function localKey(d: Date): string {
    return localDateKeyInZone(d, ORG_TZ);
  }

  /** A UTC-midnight sentinel for "today" in ORG_TZ — see
   *  shared/timezone.ts's civilDateSentinelInZone, reimplemented inline here
   *  via localDateKeyInZone so this file doesn't need that extra import. */
  function todaySentinelInOrgTz(now: Date): Date {
    const [y, m, d] = localDateKeyInZone(now, ORG_TZ).split("-").map(Number);
    return new Date(Date.UTC(y, m - 1, d));
  }

  /** Mirrors the route's slot arithmetic (now zone-aware), so this asserts
   *  the real rolling window rather than a hardcoded count that would rot
   *  on a given weekday. */
  function expectedDateKeys(): string[] {
    const now = new Date();
    const today = todaySentinelInOrgTz(now);
    const horizon = new Date(today.getTime() + WEEKS_AHEAD * 7 * 24 * 3600 * 1000);
    const keys: string[] = [];
    for (const d = new Date(today); d <= horizon; d.setUTCDate(d.getUTCDate() + 1)) {
      if (d.getUTCDay() !== DOW) continue;
      const start = zonedTimeToUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), START_HOUR, 0, ORG_TZ);
      if (start < now) continue;
      keys.push(localKey(start));
    }
    return keys;
  }

  async function materializedDates(templateId: string): Promise<string[]> {
    const res = await db.query(
      `select to_char(materialized_date, 'YYYY-MM-DD') as k from class_sessions
       where template_id = $1 order by materialized_date`,
      [templateId]
    );
    return (res.rows as any[]).map((r) => r.k as string);
  }

  beforeAll(async () => {
    // A tutor of its own, so no other describe's sessions land in this
    // template's conflict window.
    matTutorId = crypto.randomUUID();
    matStudentUserId = crypto.randomUUID();
    matParentUserId = crypto.randomUUID();
    for (const uid of [matTutorId, matStudentUserId, matParentUserId]) {
      await db.query(`insert into auth.users (id) values ($1)`, [uid]);
    }
    await db.query(
      `insert into organization_members (organization_id, user_id, role) values ($1, $2, 'tutor')`,
      [ORG, matTutorId]
    );

    matStudentId = crypto.randomUUID();
    await db.query(
      `insert into students (id, organization_id, name, student_user_id) values ($1, $2, 'Materialize Student', $3)`,
      [matStudentId, ORG, matStudentUserId]
    );
    await db.query(
      `insert into parent_links (parent_user_id, student_id, organization_id) values ($1, $2, $3)`,
      [matParentUserId, matStudentId, ORG]
    );

    matTemplateId = crypto.randomUUID();
    await db.query(
      `insert into class_templates
         (id, organization_id, name, type, capacity, tutor_id, student_ids, days_of_week, start_hour, start_minute, duration_minutes)
       values ($1, $2, 'Materialize Batch', 'BATCH', 10, $3, $4, $5, $6, 0, 60)`,
      [matTemplateId, ORG, matTutorId, [matStudentId], [DOW], START_HOUR]
    );
  });

  it("403s for a role outside CAN_SCHEDULE (parent)", async () => {
    const res = await request(app)
      .post("/api/v1/scheduling/materialize")
      .set(...authHeader(uids.parent));
    expectStatus(res, 403);
  });

  it("lays down one session per matching day across the rolling window", async () => {
    const res = await request(app)
      .post("/api/v1/scheduling/materialize")
      .set(...authHeader(uids.admin));
    expectStatus(res, 200);

    const expected = expectedDateKeys();
    expect(expected.length).toBeGreaterThan(0);
    expect(await materializedDates(matTemplateId)).toEqual(expected);
  });

  it("stamps each session at the correct UTC instant for the org's timezone (C-01)", async () => {
    const { rows } = await db.query(
      `select start_time, end_time from class_sessions where template_id = $1 order by start_time limit 1`,
      [matTemplateId]
    );
    const start = new Date((rows[0] as any).start_time);
    const end = new Date((rows[0] as any).end_time);

    // Independently reconstruct the expected UTC instant from the org's own
    // zone rather than reading it back through ambient Date methods — this
    // is the assertion that fails if materializeTemplate ever regresses to
    // reading the server process's timezone instead of ORG_TZ.
    const [y, m, d] = localDateKeyInZone(start, ORG_TZ).split("-").map(Number);
    const expectedStart = zonedTimeToUtc(y, m, d, START_HOUR, 0, ORG_TZ);
    expect(start.getTime()).toBe(expectedStart.getTime());

    // Asia/Kolkata is UTC+5:30 with no DST: a 14:00 IST slot is always
    // 08:30 UTC, regardless of what TZ this test process itself runs under.
    expect(start.getUTCHours()).toBe(8);
    expect(start.getUTCMinutes()).toBe(30);
    expect(end.getTime() - start.getTime()).toBe(60 * 60 * 1000);
  });

  it("resolves the roster into both auth-uid arrays", async () => {
    const { rows } = await db.query(
      `select student_ids, student_user_ids, parent_user_ids from class_sessions
       where template_id = $1 limit 1`,
      [matTemplateId]
    );
    const row = rows[0] as any;
    expect(row.student_ids).toEqual([matStudentId]);
    expect(row.student_user_ids).toEqual([matStudentUserId]);
    expect(row.parent_user_ids).toEqual([matParentUserId]);
  });

  it("is idempotent — a second sweep creates nothing new", async () => {
    const before = await materializedDates(matTemplateId);
    const res = await request(app)
      .post("/api/v1/scheduling/materialize")
      .set(...authHeader(uids.admin));
    expectStatus(res, 200);
    expect(res.body.created).not.toContain(before[0]);
    expect(await materializedDates(matTemplateId)).toEqual(before);
  });

  it("reports a slot already taken by that tutor as a conflict instead of double-booking", async () => {
    // Fresh template on the same tutor, one week out on a day the first
    // template doesn't use, then block that exact slot by hand first.
    const dow = (DOW + 1) % 7;
    const now = new Date();
    let cursor = todaySentinelInOrgTz(now);
    let blocked = zonedTimeToUtc(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate(), START_HOUR, 0, ORG_TZ);
    while (cursor.getUTCDay() !== dow || blocked <= now) {
      cursor = new Date(cursor.getTime() + 24 * 3600 * 1000);
      blocked = zonedTimeToUtc(cursor.getUTCFullYear(), cursor.getUTCMonth() + 1, cursor.getUTCDate(), START_HOUR, 0, ORG_TZ);
    }
    const blockedEnd = new Date(blocked.getTime() + 60 * 60 * 1000);

    await db.query(
      `insert into class_sessions (organization_id, tutor_id, start_time, end_time, status)
       values ($1, $2, $3, $4, 'scheduled')`,
      [ORG, matTutorId, blocked.toISOString(), blockedEnd.toISOString()]
    );

    const conflictTemplateId = crypto.randomUUID();
    await db.query(
      `insert into class_templates
         (id, organization_id, name, type, capacity, tutor_id, student_ids, days_of_week, start_hour, start_minute, duration_minutes)
       values ($1, $2, 'Conflicting Batch', 'BATCH', 10, $3, $4, $5, $6, 0, 60)`,
      [conflictTemplateId, ORG, matTutorId, [matStudentId], [dow], START_HOUR]
    );

    const res = await request(app)
      .post("/api/v1/scheduling/materialize")
      .set(...authHeader(uids.admin));
    expectStatus(res, 200);

    const key = localKey(blocked);
    expect(res.body.conflicts).toContainEqual({ templateId: conflictTemplateId, date: key });
    // Every other matching day still got laid down — one blocked slot must
    // not abort the template's whole window.
    const created = await materializedDates(conflictTemplateId);
    expect(created).not.toContain(key);
    expect(created.length).toBeGreaterThan(0);
  });

  it("skips templates that aren't schedulable batches", async () => {
    const oneToOneId = crypto.randomUUID();
    await db.query(
      `insert into class_templates
         (id, organization_id, name, type, capacity, tutor_id, days_of_week, start_hour, start_minute, duration_minutes)
       values ($1, $2, 'One To One', 'ONE_TO_ONE', 1, $3, $4, $5, 0, 60)`,
      [oneToOneId, ORG, matTutorId, [DOW], START_HOUR + 3]
    );
    const noTutorId = crypto.randomUUID();
    await db.query(
      `insert into class_templates
         (id, organization_id, name, type, capacity, days_of_week, start_hour, start_minute, duration_minutes)
       values ($1, $2, 'Unstaffed Batch', 'BATCH', 10, $3, $4, 0, 60)`,
      [noTutorId, ORG, [DOW], START_HOUR + 4]
    );

    const res = await request(app)
      .post("/api/v1/scheduling/materialize")
      .set(...authHeader(uids.admin));
    expectStatus(res, 200);

    expect(await materializedDates(oneToOneId)).toEqual([]);
    expect(await materializedDates(noTutorId)).toEqual([]);
  });
});

describe("GET /api/v1/scheduling/gaps", () => {
  it("422s a missing required query param", async () => {
    const res = await request(app)
      .get("/api/v1/scheduling/gaps")
      .set(...authHeader(uids.owner));
    expectStatus(res, 422);
  });

  it("200s with empty slots when the tutor has no declared availability", async () => {
    const res = await request(app)
      .get(`/api/v1/scheduling/gaps?tutorId=${bodyTutorId}&durationMinutes=60`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.body.slots).toEqual([]);
  });
});

// C-01 (EXECUTION_PLAN.md Step 25): proves materializeTemplate reads each
// template's *own* org's timezone off the TEMPLATE_SELECT join, rather than
// a single value hardcoded anywhere in the sweep — the actual regression a
// platform-wide cron (server/routes/cron.ts's /materialize-sessions, which
// sweeps every org in one query) would hit if this were wrong.
describe("materializeTemplate resolves each org's own timezone, not a global one (C-01)", () => {
  it("a template in an America/New_York org materializes at the correct DST-aware UTC instant", async () => {
    const nyOrgId = crypto.randomUUID();
    await db.query(`insert into organizations (id, name, timezone) values ($1, 'NY Org', 'America/New_York')`, [nyOrgId]);
    const nyTutorId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [nyTutorId]);
    await db.query(
      `insert into organization_members (organization_id, user_id, role) values ($1, $2, 'tutor')`,
      [nyOrgId, nyTutorId]
    );

    const nyTemplateId = crypto.randomUUID();
    await db.query(
      `insert into class_templates
         (id, organization_id, name, type, capacity, tutor_id, days_of_week, start_hour, start_minute, duration_minutes)
       values ($1, $2, 'NY Batch', 'BATCH', 10, $3, '{0,1,2,3,4,5,6}', 9, 0, 60)`,
      [nyTemplateId, nyOrgId, nyTutorId]
    );

    const { materializeTemplate, TEMPLATE_SELECT } = await import("../../server/routes/scheduling.ts");
    const { rows } = await db.query(`${TEMPLATE_SELECT} where ct.id = $1`, [nyTemplateId]);
    expect((rows[0] as any).organization_timezone).toBe("America/New_York");

    await materializeTemplate(rows[0] as any);

    const sessRes = await db.query(
      `select start_time from class_sessions where template_id = $1 order by start_time limit 1`,
      [nyTemplateId]
    );
    expect(sessRes.rows.length).toBeGreaterThan(0);
    const start = new Date((sessRes.rows[0] as any).start_time);

    const [y, m, d] = localDateKeyInZone(start, "America/New_York").split("-").map(Number);
    const expectedStart = zonedTimeToUtc(y, m, d, 9, 0, "America/New_York");
    expect(start.getTime()).toBe(expectedStart.getTime());
    // 9am wall-clock in New York, whatever the UTC offset turns out to be
    // depending on whether the materialized date lands in EDT or EST.
    expect(hourInZone(start, "America/New_York")).toBe(9);
  });
});

describe("PATCH /api/v1/scheduling/organization-timezone (C-01)", () => {
  it("401s with no token", async () => {
    const res = await request(app).patch("/api/v1/scheduling/organization-timezone").send({ timezone: "UTC" });
    expectStatus(res, 401);
  });

  it("403s for a role outside owner/admin (tutor)", async () => {
    const res = await request(app)
      .patch("/api/v1/scheduling/organization-timezone")
      .set(...authHeader(uids.tutor))
      .send({ timezone: "UTC" });
    expectStatus(res, 403);
  });

  it("422s an unrecognized IANA zone name", async () => {
    const res = await request(app)
      .patch("/api/v1/scheduling/organization-timezone")
      .set(...authHeader(uids.owner))
      .send({ timezone: "Not/AZone" });
    expectStatus(res, 422);
  });

  it("200s, updates the column, and rematerializes future sessions under the new zone", async () => {
    const tzTemplateId = crypto.randomUUID();
    await db.query(
      `insert into class_templates
         (id, organization_id, name, type, capacity, tutor_id, days_of_week, start_hour, start_minute, duration_minutes)
       values ($1, $2, 'TZ Change Batch', 'BATCH', 10, $3, '{0,1,2,3,4,5,6}', 10, 0, 60)`,
      [tzTemplateId, ORG, bodyTutorId2]
    );
    await request(app).post("/api/v1/scheduling/materialize").set(...authHeader(uids.admin));
    const before = await db.query(
      `select start_time from class_sessions where template_id = $1 order by start_time limit 1`,
      [tzTemplateId]
    );
    expect(before.rows.length).toBeGreaterThan(0);
    expect(hourInZone(new Date((before.rows[0] as any).start_time), "Asia/Kolkata")).toBe(10);

    const res = await request(app)
      .patch("/api/v1/scheduling/organization-timezone")
      .set(...authHeader(uids.owner))
      .send({ timezone: "UTC" });
    expectStatus(res, 200);
    expect(res.body.timezone).toBe("UTC");

    const orgRow = await db.query(`select timezone from organizations where id = $1`, [ORG]);
    expect((orgRow.rows[0] as any).timezone).toBe("UTC");

    const after = await db.query(
      `select start_time from class_sessions where template_id = $1 order by start_time limit 1`,
      [tzTemplateId]
    );
    expect(after.rows.length).toBeGreaterThan(0);
    // Same template, same start_hour (10), but now correctly 10:00 UTC
    // rather than 10:00 IST — proof the rematerialization actually ran
    // under the new zone rather than leaving the old instants in place.
    expect(hourInZone(new Date((after.rows[0] as any).start_time), "UTC")).toBe(10);

    // Reset ORG back to its default so later runs of this file (and any
    // test order change) can't inherit a mutated shared fixture.
    await db.query(`update organizations set timezone = $1 where id = $2`, ["Asia/Kolkata", ORG]);
  });
});
