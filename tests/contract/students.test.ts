import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, uids } from "../integration/fixtures.ts";

let app: any;
let db: PGlite;
let bodyStudentId: string;
let linkedStudentId: string;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

async function insertInvite(overrides: Partial<{ token: string; studentId: string; orgId: string; expiresAt: Date; usedAt: Date | null }> = {}) {
  const token = overrides.token ?? crypto.randomBytes(12).toString("hex");
  await db.query(
    `insert into student_invites (token, organization_id, student_id, expires_at, used_at)
     values ($1, $2, $3, $4, $5)`,
    [
      token,
      overrides.orgId ?? ORG,
      overrides.studentId ?? bodyStudentId,
      (overrides.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000)).toISOString(),
      overrides.usedAt ? overrides.usedAt.toISOString() : null,
    ]
  );
  return token;
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());

  bodyStudentId = crypto.randomUUID();
  await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Unlinked Student')`, [bodyStudentId, ORG]);

  linkedStudentId = crypto.randomUUID();
  const existingPortalUser = crypto.randomUUID();
  await db.query(`insert into auth.users (id) values ($1)`, [existingPortalUser]);
  await db.query(
    `insert into students (id, organization_id, name, student_user_id) values ($1, $2, 'Already Linked', $3)`,
    [linkedStudentId, ORG, existingPortalUser]
  );
});

afterAll(async () => {
  await db.close();
});

describe("POST /api/v1/students/invites", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/students/invites").send({ studentId: bodyStudentId });
    expectStatus(res, 401);
  });

  it("403s for a role that can't invite (tutor)", async () => {
    const res = await request(app)
      .post("/api/v1/students/invites")
      .set(...authHeader(uids.tutor))
      .send({ studentId: bodyStudentId });
    expectStatus(res, 403);
  });

  it("404s inviting for a student that doesn't exist", async () => {
    const res = await request(app)
      .post("/api/v1/students/invites")
      .set(...authHeader(uids.owner))
      .send({ studentId: crypto.randomUUID() });
    expectStatus(res, 404);
  });

  it("409s inviting a student that already has a portal account linked", async () => {
    const res = await request(app)
      .post("/api/v1/students/invites")
      .set(...authHeader(uids.owner))
      .send({ studentId: linkedStudentId });
    expectStatus(res, 409);
    expect(res.body.error.code).toBe("already_linked");
  });

  it("201s and creates a real, usable invite for in-role staff", async () => {
    const res = await request(app)
      .post("/api/v1/students/invites")
      .set(...authHeader(uids.frontdesk))
      .send({ studentId: bodyStudentId });
    expectStatus(res, 201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.studentName).toBe("Unlinked Student");
  });
});

describe("GET /api/v1/students/invites/:token/preview", () => {
  it("404s for an unknown invite token", async () => {
    const res = await request(app)
      .get("/api/v1/students/invites/does-not-exist/preview")
      .set(...authHeader(uids.parent));
    expectStatus(res, 404);
  });

  it("410s for an expired invite", async () => {
    const invite = await insertInvite({ expiresAt: new Date(Date.now() - 1000) });
    const res = await request(app)
      .get(`/api/v1/students/invites/${invite}/preview`)
      .set(...authHeader(uids.parent));
    expectStatus(res, 410);
    expect(res.body.error.code).toBe("invite_expired");
  });

  it("200s with the student and org name for a live invite", async () => {
    const invite = await insertInvite();
    const res = await request(app)
      .get(`/api/v1/students/invites/${invite}/preview`)
      .set(...authHeader(uids.parent));
    expectStatus(res, 200);
    expect(res.body.studentName).toBe("Unlinked Student");
    expect(res.body.organizationName).toBeTruthy();
  });
});

describe("POST /api/v1/students/redeem", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/students/redeem").send({ token: "x" });
    expectStatus(res, 401);
  });

  it("404s an unknown token", async () => {
    const res = await request(app)
      .post("/api/v1/students/redeem")
      .set(...authHeader(uids.parent))
      .send({ token: "does-not-exist-12345" });
    expectStatus(res, 404);
  });

  it("200s and claims the student row + org membership for a fresh user, and burns the invite", async () => {
    const redeemerId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [redeemerId]);
    const invite = await insertInvite();

    const res = await request(app)
      .post("/api/v1/students/redeem")
      .set(...authHeader(redeemerId))
      .send({ token: invite });
    expectStatus(res, 200);
    expect(res.body.organizationId).toBe(ORG);
    expect(res.body.studentId).toBe(bodyStudentId);

    const student = await db.query<any>(`select student_user_id from students where id = $1`, [bodyStudentId]);
    expect(student.rows[0].student_user_id).toBe(redeemerId);

    const membership = await db.query<any>(`select role from organization_members where user_id = $1`, [redeemerId]);
    expect(membership.rows[0].role).toBe("student");
  });

  it("409s redeeming an invite for a student that got linked by someone else in the meantime", async () => {
    // bodyStudentId was just claimed by the previous test — the roster row
    // itself is now linked, independent of this invite's own used_at state.
    const secondInvite = await insertInvite({ studentId: bodyStudentId });
    const anotherRedeemer = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [anotherRedeemer]);

    const res = await request(app)
      .post("/api/v1/students/redeem")
      .set(...authHeader(anotherRedeemer))
      .send({ token: secondInvite });
    expectStatus(res, 409);
    expect(res.body.error.code).toBe("already_linked");
  });

  it("410s redeeming an already-used invite", async () => {
    const invite = await insertInvite({ usedAt: new Date() });
    const redeemerId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [redeemerId]);

    const res = await request(app)
      .post("/api/v1/students/redeem")
      .set(...authHeader(redeemerId))
      .send({ token: invite });
    expectStatus(res, 410);
    expect(res.body.error.code).toBe("invite_used");
  });
});
