import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, uids } from "../integration/fixtures.ts";

let app: any;
let db: PGlite;
let otherOrgId: string; // real v4 id — OTHER_ORG fails zod's uuid() query-param validation (see scheduling.test.ts)

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

  otherOrgId = crypto.randomUUID();
  await db.query(`insert into organizations (id, name) values ($1, 'Org C')`, [otherOrgId]);
  await db.query(
    `insert into audit_events (organization_id, actor_id, action, payload) values ($1, $2, 'org.export_json', '{"entityType":"organizations"}'::jsonb)`,
    [otherOrgId, uids.outsider]
  );
});

afterAll(async () => {
  await db.close();
});

describe("GET /api/v1/audit-log", () => {
  it("401s with no token", async () => {
    const res = await request(app).get("/api/v1/audit-log");
    expectStatus(res, 401);
  });

  it("403s a role that isn't owner/admin/accountant and isn't a platform admin (tutor)", async () => {
    const res = await request(app)
      .get("/api/v1/audit-log")
      .set(...authHeader(uids.tutor));
    expectStatus(res, 403);
  });

  it("200s and scopes an org accountant to their own org only, ignoring an orgId param for another org", async () => {
    const res = await request(app)
      .get(`/api/v1/audit-log?orgId=${otherOrgId}`)
      .set(...authHeader(uids.accountant));
    expectStatus(res, 200);
    expect(res.body.events.length).toBeGreaterThan(0);
    for (const e of res.body.events) expect(e.organizationId).toBe(ORG);
  });

  it("200s a platform admin sees every org by default", async () => {
    const res = await request(app)
      .get("/api/v1/audit-log")
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    const orgs = new Set(res.body.events.map((e: any) => e.organizationId));
    expect(orgs.has(ORG)).toBe(true);
    expect(orgs.has(otherOrgId)).toBe(true);
  });

  it("200s a platform admin's ?orgId= filter narrows to just that org", async () => {
    const res = await request(app)
      .get(`/api/v1/audit-log?orgId=${otherOrgId}`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.body.events.length).toBeGreaterThan(0);
    for (const e of res.body.events) expect(e.organizationId).toBe(otherOrgId);
  });

  it("200s the entityType filter narrows results and total reflects the filtered count", async () => {
    const res = await request(app)
      .get(`/api/v1/audit-log?entityType=organizations`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.body.total).toBe(res.body.events.length);
    for (const e of res.body.events) expect(e.entityType).toBe("organizations");
  });

  it("422s a malformed query param (bad limit)", async () => {
    const res = await request(app)
      .get(`/api/v1/audit-log?limit=not-a-number`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 422);
  });

  it("200s and resolves actorName from the profiles table when one exists", async () => {
    const actorId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [actorId]);
    await db.query(`insert into profiles (id, name, email) values ($1, 'Named Actor', 'named@classstackr.dev')`, [actorId]);
    await db.query(
      `insert into audit_events (organization_id, actor_id, action) values ($1, $2, 'invoice.create')`,
      [ORG, actorId]
    );

    const res = await request(app)
      .get(`/api/v1/audit-log?actorId=${actorId}`)
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.body.events.length).toBe(1);
    expect(res.body.events[0].actorName).toBe("Named Actor");
  });
});
