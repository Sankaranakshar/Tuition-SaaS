import { describe, it, expect, beforeAll, afterAll } from "vitest";
import request from "supertest";
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

describe("GET /api/v1/org-export/json", () => {
  it("401s with no token", async () => {
    const res = await request(app).get("/api/v1/org-export/json");
    expectStatus(res, 401);
  });

  it("403s for a role outside owner/admin (tutor)", async () => {
    const res = await request(app)
      .get("/api/v1/org-export/json")
      .set(...authHeader(uids.tutor));
    expectStatus(res, 403);
  });

  it("200s with real org-scoped JSON, including the fixture student", async () => {
    const res = await request(app)
      .get("/api/v1/org-export/json")
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.headers["content-disposition"]).toMatch(/attachment/);
    const body = JSON.parse(res.text);
    expect(body.organization[0].name).toBe("Org A");
    expect(body.students.length).toBeGreaterThan(0);
  });
});

describe("GET /api/v1/org-export/xlsx", () => {
  it("403s for a role outside owner/admin (frontdesk)", async () => {
    const res = await request(app)
      .get("/api/v1/org-export/xlsx")
      .set(...authHeader(uids.frontdesk));
    expectStatus(res, 403);
  });

  it("200s with a real, non-empty xlsx buffer", async () => {
    const res = await request(app)
      .get("/api/v1/org-export/xlsx")
      .set(...authHeader(uids.owner));
    expectStatus(res, 200);
    expect(res.headers["content-type"]).toBe("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    // superagent has no built-in binary parser for the xlsx MIME type (unlike
    // application/pdf), so res.body isn't a Buffer here — content-length is
    // the reliable "a real non-empty file came back" signal.
    expect(Number(res.headers["content-length"])).toBeGreaterThan(0);
  });
});

describe("POST /api/v1/org-export/offboard", () => {
  it("403s for a role outside owner (admin)", async () => {
    const res = await request(app)
      .post("/api/v1/org-export/offboard")
      .set(...authHeader(uids.admin))
      .send({ confirmOrgName: "Org A" });
    expectStatus(res, 403);
  });

  it("422s when the typed name doesn't match", async () => {
    const res = await request(app)
      .post("/api/v1/org-export/offboard")
      .set(...authHeader(uids.owner))
      .send({ confirmOrgName: "Wrong Name" });
    expectStatus(res, 422);
    expect(res.body.error.code).toBe("name_mismatch");
  });

  it("200s and actually flips the org to offboarded", async () => {
    const res = await request(app)
      .post("/api/v1/org-export/offboard")
      .set(...authHeader(uids.owner))
      .send({ confirmOrgName: "Org A" });
    expectStatus(res, 200);

    const row = await db.query<any>(`select status, offboarded_by from organizations where id = $1`, [ORG]);
    expect(row.rows[0].status).toBe("offboarded");
    expect(row.rows[0].offboarded_by).toBe(uids.owner);
  });

  // Not a 409: requireOrg (server/middleware/auth.ts) reads the caller's
  // organizationStatus fresh from the DB on every request and 403s before
  // any route handler runs once it's "offboarded" — so the route's own
  // `org.status === "offboarded"` → 409 branch can never actually fire for
  // a member of the org being re-offboarded; requireOrg's 403 always wins
  // first. Confirmed here rather than assumed — a genuinely dead branch,
  // not a bug (403 is if anything a stricter response than the 409 would
  // have been), but worth knowing if this route is ever refactored.
  it("403s (org_offboarded) re-offboarding an already-offboarded org — requireOrg blocks before the route's own already_offboarded check", async () => {
    const res = await request(app)
      .post("/api/v1/org-export/offboard")
      .set(...authHeader(uids.owner))
      .send({ confirmOrgName: "Org A" });
    expectStatus(res, 403);
    expect(res.body.error.code).toBe("org_offboarded");
  });
});
