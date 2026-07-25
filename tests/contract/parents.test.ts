import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, OTHER_ORG, uids } from "../integration/fixtures.ts";

let app: any;
let db: PGlite;

// See scheduling.test.ts's header comment: fixtures.ts ids aren't valid
// RFC 4122 v1-8 uuids, so anything referenced from a zod-validated request
// body needs a real v4 id inserted fresh here instead.
let bodyStudentId: string;
let orglessUserId: string;

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
    `insert into parent_invites (token, organization_id, student_id, expires_at, used_at)
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
  await db.query(`insert into students (id, organization_id, name) values ($1, $2, 'Invite Student')`, [bodyStudentId, ORG]);

  orglessUserId = crypto.randomUUID();
  await db.query(`insert into auth.users (id) values ($1)`, [orglessUserId]);
});

afterAll(async () => {
  await db.close();
});

describe("POST /api/v1/parents/invites", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/parents/invites").send({ studentId: bodyStudentId });
    expectStatus(res, 401);
  });

  it("403s for a role that can't invite (tutor)", async () => {
    const res = await request(app)
      .post("/api/v1/parents/invites")
      .set(...authHeader(uids.tutor))
      .send({ studentId: bodyStudentId });
    expectStatus(res, 403);
  });

  it("403s for a caller with no organization", async () => {
    const res = await request(app)
      .post("/api/v1/parents/invites")
      .set(...authHeader(orglessUserId))
      .send({ studentId: bodyStudentId });
    expectStatus(res, 403);
    expect(res.body.error.code).toBe("no_organization");
  });

  it("422s on a malformed body", async () => {
    const res = await request(app)
      .post("/api/v1/parents/invites")
      .set(...authHeader(uids.owner))
      .send({ studentId: "not-a-uuid" });
    expectStatus(res, 422);
  });

  it("404s inviting for a student that doesn't exist", async () => {
    const res = await request(app)
      .post("/api/v1/parents/invites")
      .set(...authHeader(uids.owner))
      .send({ studentId: crypto.randomUUID() });
    expectStatus(res, 404);
  });

  it("200s and creates a real, usable invite for in-role staff (frontdesk)", async () => {
    const res = await request(app)
      .post("/api/v1/parents/invites")
      .set(...authHeader(uids.frontdesk))
      .send({ studentId: bodyStudentId });
    expectStatus(res, 201);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBeTruthy();
    expect(res.body.studentName).toBe("Invite Student");

    const row = await db.query<any>(`select organization_id, student_id from parent_invites where token = $1`, [res.body.token]);
    expect(row.rows[0].organization_id).toBe(ORG);
    expect(row.rows[0].student_id).toBe(bodyStudentId);
  });
});

describe("GET /api/v1/parents/invites/:token/preview", () => {
  it("401s with no token (auth token, not the invite token)", async () => {
    const invite = await insertInvite();
    const res = await request(app).get(`/api/v1/parents/invites/${invite}/preview`);
    expectStatus(res, 401);
  });

  it("404s for an unknown invite token", async () => {
    const res = await request(app)
      .get("/api/v1/parents/invites/does-not-exist/preview")
      .set(...authHeader(orglessUserId));
    expectStatus(res, 404);
  });

  it("410s for an expired invite", async () => {
    const invite = await insertInvite({ expiresAt: new Date(Date.now() - 1000) });
    const res = await request(app)
      .get(`/api/v1/parents/invites/${invite}/preview`)
      .set(...authHeader(orglessUserId));
    expectStatus(res, 410);
    expect(res.body.error.code).toBe("invite_expired");
  });

  it("410s for an already-used invite", async () => {
    const invite = await insertInvite({ usedAt: new Date() });
    const res = await request(app)
      .get(`/api/v1/parents/invites/${invite}/preview`)
      .set(...authHeader(orglessUserId));
    expectStatus(res, 410);
    expect(res.body.error.code).toBe("invite_used");
  });

  it("200s with the student and org name for a live invite", async () => {
    const invite = await insertInvite();
    const res = await request(app)
      .get(`/api/v1/parents/invites/${invite}/preview`)
      .set(...authHeader(orglessUserId));
    expectStatus(res, 200);
    expect(res.body.studentName).toBe("Invite Student");
    expect(res.body.organizationName).toBeTruthy();
  });
});

describe("POST /api/v1/parents/redeem", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/parents/redeem").send({ token: "x", consent: true });
    expectStatus(res, 401);
  });

  it("422s without consent", async () => {
    const invite = await insertInvite();
    const res = await request(app)
      .post("/api/v1/parents/redeem")
      .set(...authHeader(orglessUserId))
      .send({ token: invite });
    expectStatus(res, 422);
  });

  it("404s an unknown token", async () => {
    const res = await request(app)
      .post("/api/v1/parents/redeem")
      .set(...authHeader(orglessUserId))
      .send({ token: "does-not-exist-12345", consent: true });
    expectStatus(res, 404);
  });

  it("409s when the caller already belongs to a different organization", async () => {
    const invite = await insertInvite();
    const res = await request(app)
      .post("/api/v1/parents/redeem")
      .set(...authHeader(uids.outsider)) // member of OTHER_ORG
      .send({ token: invite, consent: true });
    expectStatus(res, 409);
    expect(res.body.error.code).toBe("org_conflict");
  });

  it("200s and creates parent_links + org membership for a fresh user, and burns the invite", async () => {
    const redeemerId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [redeemerId]);
    const invite = await insertInvite();

    const res = await request(app)
      .post("/api/v1/parents/redeem")
      .set(...authHeader(redeemerId))
      .send({ token: invite, consent: true });
    expectStatus(res, 200);
    expect(res.body.organizationId).toBe(ORG);
    expect(res.body.studentId).toBe(bodyStudentId);

    const link = await db.query<any>(`select * from parent_links where parent_user_id = $1 and student_id = $2`, [redeemerId, bodyStudentId]);
    expect(link.rows.length).toBe(1);

    const membership = await db.query<any>(`select role from organization_members where user_id = $1`, [redeemerId]);
    expect(membership.rows[0].role).toBe("parent");

    const inviteRow = await db.query<any>(`select used_at, used_by from parent_invites where token = $1`, [invite]);
    expect(inviteRow.rows[0].used_at).not.toBeNull();
    expect(inviteRow.rows[0].used_by).toBe(redeemerId);
  });

  it("410s redeeming the same invite a second time", async () => {
    const invite = await insertInvite();
    const redeemerId1 = crypto.randomUUID();
    const redeemerId2 = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1), ($2)`, [redeemerId1, redeemerId2]);

    const first = await request(app)
      .post("/api/v1/parents/redeem")
      .set(...authHeader(redeemerId1))
      .send({ token: invite, consent: true });
    expectStatus(first, 200);

    const second = await request(app)
      .post("/api/v1/parents/redeem")
      .set(...authHeader(redeemerId2))
      .send({ token: invite, consent: true });
    expectStatus(second, 410);
    expect(second.body.error.code).toBe("invite_used");
  });
});
