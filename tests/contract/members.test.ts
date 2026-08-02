import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
import crypto from "node:crypto";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp, authHeader } from "./testApp.ts";
import { ORG, uids } from "../integration/fixtures.ts";

let app: any;
let db: PGlite;
let orglessUserId: string;

function expectStatus(res: any, status: number) {
  if (res.status !== status) {
    // eslint-disable-next-line no-console
    console.log("UNEXPECTED STATUS", res.status, "expected", status, JSON.stringify(res.body));
  }
  expect(res.status).toBe(status);
}

async function insertStaffInvite(overrides: Partial<{ token: string; role: string; orgId: string; invitedBy: string; expiresAt: Date; usedAt: Date | null }> = {}) {
  const token = overrides.token ?? crypto.randomBytes(12).toString("hex");
  await db.query(
    `insert into staff_invites (token, organization_id, role, invited_by, expires_at, used_at)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      token,
      overrides.orgId ?? ORG,
      overrides.role ?? "tutor",
      overrides.invitedBy ?? uids.owner,
      (overrides.expiresAt ?? new Date(Date.now() + 7 * 24 * 3600 * 1000)).toISOString(),
      overrides.usedAt ? overrides.usedAt.toISOString() : null,
    ]
  );
  return token;
}

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  orglessUserId = crypto.randomUUID();
  await db.query(`insert into auth.users (id) values ($1)`, [orglessUserId]);
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

describe("POST /api/v1/members/invites", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/members/invites").send({ role: "tutor" });
    expectStatus(res, 401);
  });

  it("403s for a role below owner/admin (tutor inviting)", async () => {
    const res = await request(app)
      .post("/api/v1/members/invites")
      .set(...authHeader(uids.tutor))
      .send({ role: "frontdesk" });
    expectStatus(res, 403);
  });

  it("403s an admin trying to invite the admin role (owner-only)", async () => {
    const res = await request(app)
      .post("/api/v1/members/invites")
      .set(...authHeader(uids.admin))
      .send({ role: "admin" });
    expectStatus(res, 403);
  });

  it("422s on a malformed body (bad role)", async () => {
    const res = await request(app)
      .post("/api/v1/members/invites")
      .set(...authHeader(uids.owner))
      .send({ role: "owner" }); // 'owner' is deliberately not invitable
    expectStatus(res, 422);
  });

  it("201s and creates a real, usable invite for an owner inviting admin", async () => {
    const res = await request(app)
      .post("/api/v1/members/invites")
      .set(...authHeader(uids.owner))
      .send({ role: "admin" });
    expectStatus(res, 201);
    expect(res.body.ok).toBe(true);
    expect(res.body.token).toBeTruthy();
    expect(res.body.role).toBe("admin");

    const row = await db.query<any>(`select organization_id, role, invited_by from staff_invites where token = $1`, [res.body.token]);
    expect(row.rows[0].organization_id).toBe(ORG);
    expect(row.rows[0].role).toBe("admin");
    expect(row.rows[0].invited_by).toBe(uids.owner);
  });

  it("201s for an admin inviting a lower role (tutor)", async () => {
    const res = await request(app)
      .post("/api/v1/members/invites")
      .set(...authHeader(uids.admin))
      .send({ role: "frontdesk" });
    expectStatus(res, 201);
    expect(res.body.role).toBe("frontdesk");
  });
});

describe("GET /api/v1/members/invites/:token/preview", () => {
  it("401s with no token (auth token, not the invite token)", async () => {
    const invite = await insertStaffInvite();
    const res = await request(app).get(`/api/v1/members/invites/${invite}/preview`);
    expectStatus(res, 401);
  });

  it("404s for an unknown invite token", async () => {
    const res = await request(app)
      .get("/api/v1/members/invites/does-not-exist/preview")
      .set(...authHeader(orglessUserId));
    expectStatus(res, 404);
  });

  it("410s for an expired invite", async () => {
    const invite = await insertStaffInvite({ expiresAt: new Date(Date.now() - 1000) });
    const res = await request(app)
      .get(`/api/v1/members/invites/${invite}/preview`)
      .set(...authHeader(orglessUserId));
    expectStatus(res, 410);
    expect(res.body.error.code).toBe("invite_expired");
  });

  it("410s for an already-used invite", async () => {
    const invite = await insertStaffInvite({ usedAt: new Date() });
    const res = await request(app)
      .get(`/api/v1/members/invites/${invite}/preview`)
      .set(...authHeader(orglessUserId));
    expectStatus(res, 410);
    expect(res.body.error.code).toBe("invite_used");
  });

  it("200s with the org name and role for a live invite", async () => {
    const invite = await insertStaffInvite({ role: "accountant" });
    const res = await request(app)
      .get(`/api/v1/members/invites/${invite}/preview`)
      .set(...authHeader(orglessUserId));
    expectStatus(res, 200);
    expect(res.body.role).toBe("accountant");
    expect(res.body.organizationName).toBeTruthy();
  });
});

describe("POST /api/v1/members/invites/redeem", () => {
  it("401s with no token", async () => {
    const res = await request(app).post("/api/v1/members/invites/redeem").send({ token: "x" });
    expectStatus(res, 401);
  });

  it("404s an unknown token", async () => {
    const res = await request(app)
      .post("/api/v1/members/invites/redeem")
      .set(...authHeader(orglessUserId))
      .send({ token: "does-not-exist-12345" });
    expectStatus(res, 404);
  });

  it("409s when the caller already belongs to a different organization", async () => {
    const invite = await insertStaffInvite();
    const res = await request(app)
      .post("/api/v1/members/invites/redeem")
      .set(...authHeader(uids.outsider)) // member of OTHER_ORG
      .send({ token: invite });
    expectStatus(res, 409);
    expect(res.body.error.code).toBe("org_conflict");
  });

  it("200s and grants org membership for a fresh user, and burns the invite", async () => {
    const redeemerId = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1)`, [redeemerId]);
    const invite = await insertStaffInvite({ role: "frontdesk" });

    const res = await request(app)
      .post("/api/v1/members/invites/redeem")
      .set(...authHeader(redeemerId))
      .send({ token: invite });
    expectStatus(res, 200);
    expect(res.body.organizationId).toBe(ORG);
    expect(res.body.role).toBe("frontdesk");

    const membership = await db.query<any>(`select role from organization_members where user_id = $1`, [redeemerId]);
    expect(membership.rows[0].role).toBe("frontdesk");

    const inviteRow = await db.query<any>(`select used_at, used_by from staff_invites where token = $1`, [invite]);
    expect(inviteRow.rows[0].used_at).not.toBeNull();
    expect(inviteRow.rows[0].used_by).toBe(redeemerId);
  });

  it("410s redeeming the same invite a second time", async () => {
    const invite = await insertStaffInvite();
    const redeemerId1 = crypto.randomUUID();
    const redeemerId2 = crypto.randomUUID();
    await db.query(`insert into auth.users (id) values ($1), ($2)`, [redeemerId1, redeemerId2]);

    const first = await request(app)
      .post("/api/v1/members/invites/redeem")
      .set(...authHeader(redeemerId1))
      .send({ token: invite });
    expectStatus(first, 200);

    const second = await request(app)
      .post("/api/v1/members/invites/redeem")
      .set(...authHeader(redeemerId2))
      .send({ token: invite });
    expectStatus(second, 410);
    expect(second.body.error.code).toBe("invite_used");
  });
});
