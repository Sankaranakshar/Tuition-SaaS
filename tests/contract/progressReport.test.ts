import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, uids, ids } from "../integration/fixtures.ts";

let app: any;
let db: PGlite;
let unrelatedStudentId: string;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

async function insertAttendance(studentId: string, sessionStart: Date, status: string) {
  const sessionId = crypto.randomUUID();
  await db.query(
    `insert into class_sessions (id, organization_id, tutor_id, student_ids, start_time, end_time, status)
     values ($1, $2, $3, $4, $5, $6, 'completed')`,
    [sessionId, ORG, uids.tutor, [studentId], sessionStart.toISOString(), new Date(sessionStart.getTime() + 3600000).toISOString()]
  );
  await db.query(
    `insert into attendance_records (organization_id, session_id, student_id, tutor_id, status, session_start)
     values ($1, $2, $3, $4, $5, $6)`,
    [ORG, sessionId, studentId, uids.tutor, status, sessionStart.toISOString()]
  );
}

async function insertGradedAssessment(studentId: string, date: string, title: string, score: number, totalScore: number) {
  await db.query(
    `insert into assessments (organization_id, student_id, tutor_id, title, type, date, score, total_score, feedback)
     values ($1, $2, $3, $4, 'quiz', $5, $6, $7, 'Good progress')`,
    [ORG, studentId, uids.tutor, title, date, score, totalScore]
  );
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());

  // ids.stu1 (fixtures.ts) is linked to uids.parent and uids.student — the
  // exact "linked parent" / "self" cases this route needs to authorize.
  await insertAttendance(ids.stu1, new Date("2026-09-05T10:00:00Z"), "present");
  await insertAttendance(ids.stu1, new Date("2026-09-08T10:00:00Z"), "late");
  await insertAttendance(ids.stu1, new Date("2026-09-12T10:00:00Z"), "absent");
  await insertAttendance(ids.stu1, new Date("2026-08-01T10:00:00Z"), "present"); // outside September, must not be counted
  await insertGradedAssessment(ids.stu1, "2026-09-10", "Unit test", 18, 20);
  // Homework (type 'assignment') must be excluded from the graded table.
  await db.query(
    `insert into assessments (organization_id, student_id, tutor_id, title, type, due_date, status)
     values ($1, $2, $3, 'Worksheet 3', 'assignment', '2026-09-15', 'pending')`,
    [ORG, ids.stu1, uids.tutor]
  );

  unrelatedStudentId = crypto.randomUUID();
  await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Unrelated Student')`, [unrelatedStudentId, ORG]);
});

afterAll(async () => {
  await db.close();
});

describe("GET /api/v1/students/:studentId/progress-report (B-12, EXECUTION_PLAN.md Step 22)", () => {
  it("422s when month is missing", async () => {
    const res = await request(app)
      .get(`/api/v1/students/${ids.stu1}/progress-report`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 422);
  });

  it("422s on a malformed month", async () => {
    const res = await request(app)
      .get(`/api/v1/students/${ids.stu1}/progress-report`)
      .query({ month: "2026-13" })
      .set(...authHeader(uids.owner));
    expectStatus(res, 422);
  });

  it.each(["owner", "admin", "tutor", "frontdesk", "accountant"] as const)(
    "200s for staff role %s",
    async (role) => {
      const res = await request(app)
        .get(`/api/v1/students/${ids.stu1}/progress-report`)
        .query({ month: "2026-09" })
        .set(...authHeader(uids[role]));
      expectStatus(res, 200);
      expect(res.headers["content-type"]).toBe("application/pdf");
    }
  );

  it("200s for the student's linked parent", async () => {
    const res = await request(app)
      .get(`/api/v1/students/${ids.stu1}/progress-report`)
      .query({ month: "2026-09" })
      .set(...authHeader(uids.parent));
    expectStatus(res, 200);
    expect(res.headers["content-type"]).toBe("application/pdf");
  });

  it("200s for the student themselves", async () => {
    const res = await request(app)
      .get(`/api/v1/students/${ids.stu1}/progress-report`)
      .query({ month: "2026-09" })
      .set(...authHeader(uids.student));
    expectStatus(res, 200);
    expect(res.headers["content-type"]).toBe("application/pdf");
  });

  it("403s for a parent not linked to this student", async () => {
    const res = await request(app)
      .get(`/api/v1/students/${unrelatedStudentId}/progress-report`)
      .query({ month: "2026-09" })
      .set(...authHeader(uids.parent));
    expectStatus(res, 403);
  });

  it("404s for a different org's staff", async () => {
    const res = await request(app)
      .get(`/api/v1/students/${ids.stu1}/progress-report`)
      .query({ month: "2026-09" })
      .set(...authHeader(uids.outsider));
    expectStatus(res, 404);
  });
});
