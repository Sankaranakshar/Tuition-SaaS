import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, uids } from "../integration/fixtures.ts";

let app: any;
let db: PGlite;
let bodyTutorId: string;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  await db.query(`insert into platform_admins (user_id) values ($1)`, [uids.owner]);
  await db.query(`insert into profiles (id, organization_id, name, email) values ($1, $2, 'Platform Owner', 'owner@classstackr.dev')`, [uids.owner, ORG]);
  await db.query(`insert into profiles (id, organization_id, name, email) values ($1, $2, 'Demo Tutor', 'tutor@classstackr.dev')`, [uids.tutor, ORG]);

  // impersonateRequestSchema validates userId as a real v4 uuid (see
  // scheduling.test.ts's header comment) — uids.tutor fails that, so
  // /impersonate needs its own body-safe id with a matching profile.
  bodyTutorId = crypto.randomUUID();
  await db.query(`insert into auth.users (id) values ($1)`, [bodyTutorId]);
  await db.query(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'tutor')`, [ORG, bodyTutorId]);
  await db.query(`insert into profiles (id, organization_id, name, email) values ($1, $2, 'Body Tutor', 'body.tutor@classstackr.dev')`, [bodyTutorId, ORG]);
});

afterAll(async () => {
  await db.close();
});

describe("GET /api/v1/admin/orgs", () => {
  it("401s with no token", async () => {
    const res = await request(app).get("/api/v1/admin/orgs");
    expectStatus(res, 401);
  });

  it("403s for a real org owner who isn't a platform admin", async () => {
    const res = await request(app)
      .get("/api/v1/admin/orgs")
      .set(...authHeader(uids.outsider));
    expectStatus(res, 403);
  });

  it("200s with every org, including the fixture org's computed health fields", async () => {
    const res = await request(app)
      .get("/api/v1/admin/orgs")
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    const orgA = res.body.orgs.find((o: any) => o.id === ORG);
    expect(orgA.name).toBe("Org A");
    expect(orgA.activeStudentCount).toBeGreaterThanOrEqual(1);
    expect(orgA.memberCount).toBeGreaterThanOrEqual(1);
  });
});

describe("GET /api/v1/admin/orgs/:orgId/members", () => {
  it("403s for a non-platform-admin", async () => {
    const res = await request(app)
      .get(`/api/v1/admin/orgs/${ORG}/members`)
      .set(...authHeader(uids.tutor));
    expectStatus(res, 403);
  });

  it("200s with members joined to their profiles", async () => {
    const res = await request(app)
      .get(`/api/v1/admin/orgs/${ORG}/members`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    const tutorRow = res.body.members.find((m: any) => m.user_id === uids.tutor);
    expect(tutorRow.role).toBe("tutor");
    expect(tutorRow.profiles.name).toBe("Demo Tutor");
  });
});

describe("PUT /api/v1/admin/orgs/:orgId/feature-flags", () => {
  it("403s for a non-platform-admin", async () => {
    const res = await request(app)
      .put(`/api/v1/admin/orgs/${ORG}/feature-flags`)
      .set(...authHeader(uids.tutor))
      .send({ key: "beta", enabled: true });
    expectStatus(res, 403);
  });

  it("422s a malformed body", async () => {
    const res = await request(app)
      .put(`/api/v1/admin/orgs/${ORG}/feature-flags`)
      .set(...authHeader(uids.owner))
      .send({ key: "", enabled: "yes" });
    expectStatus(res, 422);
  });

  it("200s and writes a real feature_flags row", async () => {
    const res = await request(app)
      .put(`/api/v1/admin/orgs/${ORG}/feature-flags`)
      .set(...authHeader(uids.owner))
      .send({ key: "beta", enabled: true });
    expectStatus(res, 200);

    const row = await db.query<any>(`select enabled from feature_flags where organization_id = $1 and key = 'beta'`, [ORG]);
    expect(row.rows[0].enabled).toBe(true);
  });
});

describe("POST /api/v1/admin/impersonate", () => {
  it("403s for a non-platform-admin", async () => {
    const res = await request(app)
      .post("/api/v1/admin/impersonate")
      .set(...authHeader(uids.tutor))
      .send({ userId: uids.tutor });
    expectStatus(res, 403);
  });

  it("404s a user with no profile/email on record", async () => {
    const orphanId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [orphanId]);
    const res = await request(app)
      .post("/api/v1/admin/impersonate")
      .set(...authHeader(uids.owner))
      .send({ userId: orphanId });
    expectStatus(res, 404);
  });

  it("200s, returns a real magic link, and logs to both audit trails", async () => {
    const res = await request(app)
      .post("/api/v1/admin/impersonate")
      .set(...authHeader(uids.owner))
      .send({ userId: bodyTutorId });
    expectStatus(res, 200);
    expect(res.body.actionLink).toMatch(/^https:\/\/auth\.test\/magiclink/);

    const platformLog = await db.query<any>(`select action, target_user_id from platform_admin_actions where actor_id = $1 order by created_at desc limit 1`, [uids.owner]);
    expect(platformLog.rows[0].action).toBe("impersonate");
    expect(platformLog.rows[0].target_user_id).toBe(bodyTutorId);

    const orgLog = await db.query<any>(`select action from audit_events where organization_id = $1 and action = 'platform_admin.impersonate' order by created_at desc limit 1`, [ORG]);
    expect(orgLog.rows.length).toBe(1);
  });
});
