import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, OTHER_ORG, uids, ids } from "../integration/fixtures.ts";

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

  /** Local-time YYYY-MM-DD, matching the route's own key format. Using
   *  toISOString() here would drift a day for evening slots in IST. */
  function localKey(d: Date): string {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }

  /** Mirrors the route's slot arithmetic, so this asserts the real rolling
   *  window rather than a hardcoded count that would rot on a given weekday. */
  function expectedDateKeys(): string[] {
    const now = new Date();
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today.getTime() + WEEKS_AHEAD * 7 * 24 * 3600 * 1000);
    const keys: string[] = [];
    for (const d = new Date(today); d <= horizon; d.setDate(d.getDate() + 1)) {
      if (d.getDay() !== DOW) continue;
      const start = new Date(d);
      start.setHours(START_HOUR, 0, 0, 0);
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

  it("stamps each session at the template's local start hour", async () => {
    const { rows } = await db.query(
      `select start_time, end_time from class_sessions where template_id = $1 order by start_time limit 1`,
      [matTemplateId]
    );
    const start = new Date((rows[0] as any).start_time);
    const end = new Date((rows[0] as any).end_time);
    expect(start.getDay()).toBe(DOW);
    expect(start.getHours()).toBe(START_HOUR);
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
    const blocked = new Date();
    blocked.setHours(0, 0, 0, 0);
    while (blocked.getDay() !== dow || blocked <= now) blocked.setDate(blocked.getDate() + 1);
    blocked.setHours(START_HOUR, 0, 0, 0);
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
