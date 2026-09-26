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

// D-06 / EXECUTION_PLAN.md Step 30: the student anchor is enforced by the
// database for every writer, including this server's own service_role pool,
// so no current or future route can create a tutor-student DM that the
// student's parent can't read. (DMs are created client-side today; the
// class-channel route above is the only server writer to conversations.)
describe("conversations.student_id anchor, enforced for server-side writers too", () => {
  async function seedStudent(name: string) {
    const studentId = crypto.randomUUID();
    const studentUserId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [studentUserId]);
    await db.query(`insert into students (id, organization_id, name, student_user_id) values ($1, $2, $3, $4)`, [
      studentId,
      ORG,
      name,
      studentUserId,
    ]);
    return { studentId, studentUserId };
  }

  it("a DM with a student participant and no anchor supplied cannot be left unanchored", async () => {
    const { studentId, studentUserId } = await seedStudent("Anchor Kid");
    const res = await db.query<any>(
      `insert into conversations (organization_id, participant_ids, kind) values ($1, $2, 'dm') returning student_id`,
      [ORG, [uids.tutor, studentUserId]]
    );
    expect(res.rows[0].student_id).toBe(studentId);

    // Clearing it afterwards just re-derives it.
    const cleared = await db.query<any>(
      `update conversations set student_id = null where student_id = $1 returning student_id`,
      [studentId]
    );
    expect(cleared.rows[0].student_id).toBe(studentId);
  });

  it("rejects a DM anchored to a student who isn't in it", async () => {
    const { studentUserId } = await seedStudent("Real Kid");
    const other = await seedStudent("Other Kid");
    await expect(
      db.query(`insert into conversations (organization_id, participant_ids, kind, student_id) values ($1, $2, 'dm', $3)`, [
        ORG,
        [uids.tutor, studentUserId],
        other.studentId,
      ])
    ).rejects.toThrow(/student anchor does not match/);
  });

  it("rejects a DM between two students", async () => {
    const a = await seedStudent("Kid A");
    const b = await seedStudent("Kid B");
    await expect(
      db.query(`insert into conversations (organization_id, participant_ids, kind) values ($1, $2, 'dm')`, [
        ORG,
        [a.studentUserId, b.studentUserId],
      ])
    ).rejects.toThrow(/between two students/);
  });

  it("the class-channel route is unaffected: a channel with a rostered student carries no student anchor", async () => {
    const templateId = crypto.randomUUID();
    const { studentId } = await seedStudent("Channel Kid");
    await db.query(
      `insert into class_templates (id, organization_id, name, type, capacity, tutor_id, days_of_week)
       values ($1, $2, 'Anchor Batch', 'BATCH', 10, $3, '{1}')`,
      [templateId, ORG, uids.tutor]
    );
    await db.query(`insert into enrollments (organization_id, student_id, template_id, status) values ($1, $2, $3, 'active')`, [
      ORG,
      studentId,
      templateId,
    ]);
    const res = await request(app)
      .post(`/api/v1/inbox/class-channels/${templateId}/ensure`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    const row = await db.query<any>(`select student_id from conversations where id = $1`, [res.body.conversationId]);
    expect(row.rows[0].student_id).toBeNull();
  });
});

describe("GET /api/v1/inbox/tutor-contacts (parents can message their child's tutors)", () => {
  it("401s with no token", async () => {
    const res = await request(app).get(`/api/v1/inbox/tutor-contacts`);
    expectStatus(res, 401);
  });

  it("returns the child's assigned, class and session tutors, and nobody else", async () => {
    const parentUserId = crypto.randomUUID();
    const formerTutorId = crypto.randomUUID();
    const studentId = crypto.randomUUID();
    const classTemplateId = crypto.randomUUID();
    const formerTemplateId = crypto.randomUUID();
    const frontdeskTemplateId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1), ($2)`, [parentUserId, formerTutorId]);
    await db.query(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'parent')`, [ORG, parentUserId]);
    await db.query(`insert into students (id, organization_id, name, tutor_id) values ($1, $2, 'Contact Kid', $3)`, [
      studentId,
      ORG,
      uids.tutor,
    ]);
    await db.query(`insert into parent_links (parent_user_id, student_id, organization_id) values ($1, $2, $3)`, [
      parentUserId,
      studentId,
      ORG,
    ]);
    for (const [id, tutorId] of [
      [classTemplateId, uids.tutor2],
      [formerTemplateId, formerTutorId], // no longer a member of the org
      [frontdeskTemplateId, uids.frontdesk], // not teaching staff
    ]) {
      await db.query(
        `insert into class_templates (id, organization_id, name, type, capacity, tutor_id, days_of_week)
         values ($1, $2, 'Contacts Batch', 'BATCH', 10, $3, '{1}')`,
        [id, ORG, tutorId]
      );
      await db.query(`insert into enrollments (organization_id, student_id, template_id, status) values ($1, $2, $3, 'active')`, [
        ORG,
        studentId,
        id,
      ]);
    }
    await db.query(
      `insert into class_sessions (organization_id, tutor_id, student_ids, start_time, end_time, status)
       values ($1, $2, $3, now() + interval '2 days', now() + interval '2 days 1 hour', 'scheduled')`,
      [ORG, uids.admin, [studentId]]
    );

    const res = await request(app).get(`/api/v1/inbox/tutor-contacts`).set(...authHeader(parentUserId));
    expectStatus(res, 200);
    const tutorIds = res.body.tutors.map((t: any) => t.userId).sort();
    expect(tutorIds).toEqual([uids.tutor, uids.tutor2, uids.admin].sort());
    for (const t of res.body.tutors) {
      expect(t.studentId).toBe(studentId);
      expect(t.studentName).toBe("Contact Kid");
      expect(typeof t.name).toBe("string");
    }
  });

  it("returns an empty list for someone who isn't a linked parent", async () => {
    for (const uid of [uids.tutor, uids.owner]) {
      const res = await request(app).get(`/api/v1/inbox/tutor-contacts`).set(...authHeader(uid));
      expectStatus(res, 200);
      expect(res.body.tutors).toEqual([]);
    }
  });

  it("never returns another family's tutors", async () => {
    // uids.parent is linked only to the fixture student (Riya), not to "Contact Kid" above.
    const res = await request(app).get(`/api/v1/inbox/tutor-contacts`).set(...authHeader(uids.parent));
    expectStatus(res, 200);
    expect(res.body.tutors.every((t: any) => t.studentName !== "Contact Kid")).toBe(true);
  });
});
