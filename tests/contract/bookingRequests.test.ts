import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, uids } from "../integration/fixtures.ts";

let app: any;
let db: PGlite;
let bodyStudentId: string;
let bodyTutorId: string;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

async function createTemplate(overrides: Partial<{ orgId: string; type: string; capacity: number }> = {}) {
  const id = crypto.randomUUID();
  await db.query(
    `insert into class_templates (id, organization_id, name, type, capacity, days_of_week)
     values ($1, $2, 'Template', $3, $4, '{1}')`,
    [id, overrides.orgId ?? ORG, overrides.type ?? "BATCH", overrides.capacity ?? 10]
  );
  return id;
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  bodyStudentId = crypto.randomUUID();
  await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Body Student')`, [bodyStudentId, ORG]);
  bodyTutorId = crypto.randomUUID();
  await db.query(`insert into auth.users (id) values ($1)`, [bodyTutorId]);
  await db.query(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'tutor')`, [ORG, bodyTutorId]);
});

afterAll(async () => {
  await db.close();
});

describe("POST /api/v1/session-requests", () => {
  it("creates a template-join request", async () => {
    const templateId = await createTemplate();
    const res = await request(app)
      .post("/api/v1/session-requests")
      .set(...authHeader(uids.parent))
      .send({ studentId: bodyStudentId, templateId, notes: "please" });
    expectStatus(res, 201);
    const row = await db.query<any>(`select status, student_id, template_id, tutor_id from session_requests where id = $1`, [res.body.requestId]);
    expect(row.rows[0].status).toBe("pending");
    expect(row.rows[0].template_id).toBe(templateId);
    expect(row.rows[0].tutor_id).toBeNull();
  });

  it("creates a one-on-one tutor request", async () => {
    const res = await request(app)
      .post("/api/v1/session-requests")
      .set(...authHeader(uids.parent))
      .send({
        studentId: bodyStudentId,
        tutorId: bodyTutorId,
        requestedStartTime: "2027-02-01T10:00:00.000Z",
        requestedEndTime: "2027-02-01T11:00:00.000Z",
      });
    expectStatus(res, 201);
  });

  it("422s when requestedEndTime is before requestedStartTime", async () => {
    const res = await request(app)
      .post("/api/v1/session-requests")
      .set(...authHeader(uids.parent))
      .send({
        studentId: bodyStudentId,
        tutorId: bodyTutorId,
        requestedStartTime: "2027-02-01T11:00:00.000Z",
        requestedEndTime: "2027-02-01T10:00:00.000Z",
      });
    expectStatus(res, 422);
  });

  it("404s requesting a tutor who isn't an org member", async () => {
    const res = await request(app)
      .post("/api/v1/session-requests")
      .set(...authHeader(uids.parent))
      .send({
        studentId: bodyStudentId,
        tutorId: crypto.randomUUID(),
        requestedStartTime: "2027-02-01T10:00:00.000Z",
        requestedEndTime: "2027-02-01T11:00:00.000Z",
      });
    expectStatus(res, 404);
  });
});

describe("GET /api/v1/session-requests", () => {
  it("403s for a parent (not staff)", async () => {
    const res = await request(app).get("/api/v1/session-requests").set(...authHeader(uids.parent));
    expectStatus(res, 403);
  });

  it("200s for staff and lists pending requests", async () => {
    const templateId = await createTemplate();
    await request(app).post("/api/v1/session-requests").set(...authHeader(uids.parent)).send({ studentId: bodyStudentId, templateId });

    const res = await request(app).get("/api/v1/session-requests?status=pending").set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(Array.isArray(res.body.requests)).toBe(true);
    expect(res.body.requests.length).toBeGreaterThan(0);
    expect(res.body.requests[0].student_name).toBe("Body Student");
  });
});

describe("POST /api/v1/session-requests/:id/accept", () => {
  it("403s for a parent", async () => {
    const templateId = await createTemplate();
    const create = await request(app).post("/api/v1/session-requests").set(...authHeader(uids.parent)).send({ studentId: bodyStudentId, templateId });
    const res = await request(app).post(`/api/v1/session-requests/${create.body.requestId}/accept`).set(...authHeader(uids.parent));
    expectStatus(res, 403);
  });

  it("accepts a template-join request and creates an enrollment", async () => {
    const templateId = await createTemplate();
    const create = await request(app).post("/api/v1/session-requests").set(...authHeader(uids.parent)).send({ studentId: bodyStudentId, templateId });

    const res = await request(app).post(`/api/v1/session-requests/${create.body.requestId}/accept`).set(...authHeader(uids.owner));
    expectStatus(res, 200);

    const row = await db.query<any>(`select status, resulting_enrollment_id from session_requests where id = $1`, [create.body.requestId]);
    expect(row.rows[0].status).toBe("accepted");
    expect(row.rows[0].resulting_enrollment_id).toBeTruthy();
    const enrollment = await db.query<any>(`select template_id from enrollments where id = $1`, [row.rows[0].resulting_enrollment_id]);
    expect(enrollment.rows[0].template_id).toBe(templateId);
  });

  it("accepts a one-on-one request and creates a session", async () => {
    const create = await request(app)
      .post("/api/v1/session-requests")
      .set(...authHeader(uids.parent))
      .send({ studentId: bodyStudentId, tutorId: bodyTutorId, requestedStartTime: "2027-03-01T10:00:00.000Z", requestedEndTime: "2027-03-01T11:00:00.000Z" });

    const res = await request(app).post(`/api/v1/session-requests/${create.body.requestId}/accept`).set(...authHeader(uids.owner));
    expectStatus(res, 200);

    const row = await db.query<any>(`select status, resulting_session_id from session_requests where id = $1`, [create.body.requestId]);
    expect(row.rows[0].status).toBe("accepted");
    expect(row.rows[0].resulting_session_id).toBeTruthy();
  });

  it("409s accepting an already-accepted request", async () => {
    const templateId = await createTemplate();
    const create = await request(app).post("/api/v1/session-requests").set(...authHeader(uids.parent)).send({ studentId: bodyStudentId, templateId });
    await request(app).post(`/api/v1/session-requests/${create.body.requestId}/accept`).set(...authHeader(uids.owner));

    const res = await request(app).post(`/api/v1/session-requests/${create.body.requestId}/accept`).set(...authHeader(uids.owner));
    expectStatus(res, 409);
  });
});

describe("POST /api/v1/session-requests/:id/decline", () => {
  it("declines a pending request", async () => {
    const templateId = await createTemplate();
    const create = await request(app).post("/api/v1/session-requests").set(...authHeader(uids.parent)).send({ studentId: bodyStudentId, templateId });

    const res = await request(app)
      .post(`/api/v1/session-requests/${create.body.requestId}/decline`)
      .set(...authHeader(uids.frontdesk))
      .send({ responseNote: "no capacity this term" });
    expectStatus(res, 200);

    const row = await db.query<any>(`select status, response_note from session_requests where id = $1`, [create.body.requestId]);
    expect(row.rows[0].status).toBe("declined");
    expect(row.rows[0].response_note).toBe("no capacity this term");
  });
});

describe("propose-alternative / respond-to-proposal flow", () => {
  it("rejects a counter-offer whose target type doesn't match the request", async () => {
    const templateId = await createTemplate();
    const create = await request(app).post("/api/v1/session-requests").set(...authHeader(uids.parent)).send({ studentId: bodyStudentId, templateId });

    const res = await request(app)
      .post(`/api/v1/session-requests/${create.body.requestId}/propose`)
      .set(...authHeader(uids.owner))
      .send({ proposedStartTime: "2027-04-01T10:00:00.000Z", proposedEndTime: "2027-04-01T11:00:00.000Z" });
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("target_mismatch");
  });

  it("staff proposes an alternative template, requester accepts it, and enrollment uses the proposed template", async () => {
    const templateId = await createTemplate();
    const altTemplateId = await createTemplate();
    const create = await request(app).post("/api/v1/session-requests").set(...authHeader(uids.parent)).send({ studentId: bodyStudentId, templateId });

    const propose = await request(app)
      .post(`/api/v1/session-requests/${create.body.requestId}/propose`)
      .set(...authHeader(uids.owner))
      .send({ proposedTemplateId: altTemplateId, responseNote: "that batch is full, how about this one?" });
    expectStatus(propose, 200);
    const countered = await db.query<any>(`select status from session_requests where id = $1`, [create.body.requestId]);
    expect(countered.rows[0].status).toBe("countered");

    // A non-requester can't respond to the counter-offer.
    const wrongUser = await request(app)
      .post(`/api/v1/session-requests/${create.body.requestId}/respond-to-proposal`)
      .set(...authHeader(uids.owner))
      .send({ accept: true });
    expectStatus(wrongUser, 403);

    const respond = await request(app)
      .post(`/api/v1/session-requests/${create.body.requestId}/respond-to-proposal`)
      .set(...authHeader(uids.parent))
      .send({ accept: true });
    expectStatus(respond, 200);

    const row = await db.query<any>(`select status, resulting_enrollment_id from session_requests where id = $1`, [create.body.requestId]);
    expect(row.rows[0].status).toBe("accepted");
    const enrollment = await db.query<any>(`select template_id from enrollments where id = $1`, [row.rows[0].resulting_enrollment_id]);
    expect(enrollment.rows[0].template_id).toBe(altTemplateId);
  });

  it("requester can decline a counter-offer instead of accepting it", async () => {
    const templateId = await createTemplate();
    const altTemplateId = await createTemplate();
    const create = await request(app).post("/api/v1/session-requests").set(...authHeader(uids.parent)).send({ studentId: bodyStudentId, templateId });
    await request(app).post(`/api/v1/session-requests/${create.body.requestId}/propose`).set(...authHeader(uids.owner)).send({ proposedTemplateId: altTemplateId });

    const res = await request(app)
      .post(`/api/v1/session-requests/${create.body.requestId}/respond-to-proposal`)
      .set(...authHeader(uids.parent))
      .send({ accept: false });
    expectStatus(res, 200);

    const row = await db.query<any>(`select status, resulting_enrollment_id from session_requests where id = $1`, [create.body.requestId]);
    expect(row.rows[0].status).toBe("declined");
    expect(row.rows[0].resulting_enrollment_id).toBeNull();
  });
});
