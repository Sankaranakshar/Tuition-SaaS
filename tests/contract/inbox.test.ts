import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, uids } from "../integration/fixtures.ts";

let app: any;
let db: PGlite;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());
});

afterAll(async () => {
  await db.close();
});

describe("POST /api/v1/inbox/class-channels/:templateId/ensure", () => {
  it("401s with no token", async () => {
    const res = await request(app).post(`/api/v1/inbox/class-channels/${crypto.randomUUID()}/ensure`);
    expectStatus(res, 401);
  });

  it("404s for a template that doesn't exist", async () => {
    const res = await request(app)
      .post(`/api/v1/inbox/class-channels/${crypto.randomUUID()}/ensure`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 404);
  });

  it("200s and creates a real conversation with the resolved roster as participants", async () => {
    const templateId = crypto.randomUUID();
    const studentId = crypto.randomUUID();
    const studentUserId = crypto.randomUUID();
    const parentUserId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1), ($2)`, [studentUserId, parentUserId]);
    await db.query(
      `insert into class_templates (id, organization_id, name, type, capacity, tutor_id, days_of_week)
       values ($1, $2, 'Channel Batch', 'BATCH', 10, $3, '{1}')`,
      [templateId, ORG, uids.tutor]
    );
    await db.query(`insert into students (id, organization_id, name, student_user_id) values ($1, $2, 'Roster Kid', $3)`, [studentId, ORG, studentUserId]);
    await db.query(`insert into parent_links (parent_user_id, student_id, organization_id) values ($1, $2, $3)`, [parentUserId, studentId, ORG]);
    await db.query(`insert into enrollments (organization_id, student_id, template_id, status) values ($1, $2, $3, 'active')`, [ORG, studentId, templateId]);

    const res = await request(app)
      .post(`/api/v1/inbox/class-channels/${templateId}/ensure`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.body.ok).toBe(true);
    expect(res.body.participantCount).toBe(3); // tutor + student + parent

    const row = await db.query<any>(`select participant_ids, kind, anchor_id from conversations where id = $1`, [res.body.conversationId]);
    expect(row.rows[0].kind).toBe("class_channel");
    expect(row.rows[0].anchor_id).toBe(templateId);
    expect(row.rows[0].participant_ids.sort()).toEqual([uids.tutor, studentUserId, parentUserId].sort());
  });

  it("200s idempotently — a second call refreshes the same channel instead of duplicating it", async () => {
    const templateId = crypto.randomUUID();
    await db.query(
      `insert into class_templates (id, organization_id, name, type, capacity, tutor_id, days_of_week)
       values ($1, $2, 'Idempotent Batch', 'BATCH', 10, $3, '{1}')`,
      [templateId, ORG, uids.tutor]
    );

    const first = await request(app)
      .post(`/api/v1/inbox/class-channels/${templateId}/ensure`)
      .set(...authHeader(uids.owner));
    expectStatus(first, 200);

    const second = await request(app)
      .post(`/api/v1/inbox/class-channels/${templateId}/ensure`)
      .set(...authHeader(uids.owner));
    expectStatus(second, 200);
    expect(second.body.conversationId).toBe(first.body.conversationId);

    const count = await db.query<any>(`select count(*)::int as n from conversations where anchor_id = $1 and kind = 'class_channel'`, [templateId]);
    expect(count.rows[0].n).toBe(1);
  });
});
