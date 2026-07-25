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

describe("POST /api/v1/members/bootstrap", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/members/bootstrap").send({ organizationName: "New Org" });
    expectStatus(res, 401);
  });

  it("409s for a user who already belongs to an organization", async () => {
    const res = await request(app)
      .post("/api/v1/members/bootstrap")
      .set(...authHeader(uids.owner))
      .send({ organizationName: "New Org" });
    expectStatus(res, 409);
    expect(res.body.error.code).toBe("already_member");
  });

  it("422s on a malformed body", async () => {
    const orglessId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [orglessId]);
    const res = await request(app)
      .post("/api/v1/members/bootstrap")
      .set(...authHeader(orglessId))
      .send({ organizationName: "x" });
    expectStatus(res, 422);
  });

  it("201s and creates a real org with the caller as owner", async () => {
    const orglessId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [orglessId]);
    const res = await request(app)
      .post("/api/v1/members/bootstrap")
      .set(...authHeader(orglessId))
      .send({ organizationName: "Fresh Tutoring Co" });
    expectStatus(res, 201);
    expect(res.body.organizationId).toBeTruthy();

    const membership = await db.query<any>(
      `select role from organization_members where organization_id = $1 and user_id = $2`,
      [res.body.organizationId, orglessId]
    );
    expect(membership.rows[0].role).toBe("owner");
  });
});

describe("PUT /api/v1/members", () => {
  it("401s with no token", async () => {
    const res = await request(app).put("/api/v1/members").send({});
    expectStatus(res, 401);
  });

  it("403s for a role below owner/admin (tutor)", async () => {
    const res = await request(app)
      .put("/api/v1/members")
      .set(...authHeader(uids.tutor))
      .send({ userId: crypto.randomUUID(), role: "accountant" });
    expectStatus(res, 403);
  });

  it("403s an admin trying to grant the admin role (owner-only)", async () => {
    const targetId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [targetId]);
    const res = await request(app)
      .put("/api/v1/members")
      .set(...authHeader(uids.admin))
      .send({ userId: targetId, role: "admin" });
    expectStatus(res, 403);
  });

  it("422s on a malformed body (bad role)", async () => {
    const res = await request(app)
      .put("/api/v1/members")
      .set(...authHeader(uids.owner))
      .send({ userId: crypto.randomUUID(), role: "superuser" });
    expectStatus(res, 422);
  });

  it("200s an owner granting a lower role to a real user", async () => {
    const targetId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [targetId]);
    const res = await request(app)
      .put("/api/v1/members")
      .set(...authHeader(uids.owner))
      .send({ userId: targetId, role: "accountant" });
    expectStatus(res, 200);

    const row = await db.query<any>(`select role from organization_members where organization_id = $1 and user_id = $2`, [ORG, targetId]);
    expect(row.rows[0].role).toBe("accountant");
  });

  it("200s an owner granting the admin role (owner is allowed)", async () => {
    const targetId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [targetId]);
    const res = await request(app)
      .put("/api/v1/members")
      .set(...authHeader(uids.owner))
      .send({ userId: targetId, role: "admin" });
    expectStatus(res, 200);
  });
});

describe("DELETE /api/v1/members/:userId", () => {
  it("403s for a role below owner/admin (tutor)", async () => {
    const res = await request(app)
      .delete(`/api/v1/members/${crypto.randomUUID()}`)
      .set(...authHeader(uids.tutor));
    expectStatus(res, 403);
  });

  it("400s trying to remove yourself", async () => {
    const res = await request(app)
      .delete(`/api/v1/members/${uids.owner}`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 400);
    expect(res.body.error.code).toBe("cannot_remove_self");
  });

  it("200s removing a real member, and their membership row is gone", async () => {
    const targetId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [targetId]);
    await db.query(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'frontdesk')`, [ORG, targetId]);

    const res = await request(app)
      .delete(`/api/v1/members/${targetId}`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);

    const row = await db.query<any>(`select 1 from organization_members where organization_id = $1 and user_id = $2`, [ORG, targetId]);
    expect(row.rows.length).toBe(0);
  });
});
