import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import request from "supertest";
import type { PGlite } from "@electric-sql/pglite";
import { createTestApp } from "./testApp.ts";
import { pool } from "../../server/db.ts";
import { ORG } from "../integration/fixtures.ts";

const CRON_SECRET = "test-cron-secret-do-not-use-in-prod";

let app: any;
let db: PGlite;

beforeAll(async () => {
  ({ app, db } = await createTestApp());
  process.env.CRON_SECRET = CRON_SECRET;
});

afterAll(async () => {
  delete process.env.CRON_SECRET;
  await db.close();
});

describe("cron auth guard", () => {
  it("accepts Authorization: Bearer <CRON_SECRET>", async () => {
    const res = await request(app)
      .post("/api/cron/materialize-sessions")
      .set("Authorization", `Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("accepts x-cron-secret: <CRON_SECRET>", async () => {
    const res = await request(app)
      .post("/api/cron/materialize-sessions")
      .set("x-cron-secret", CRON_SECRET);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("404s a wrong Bearer token", async () => {
    const res = await request(app)
      .post("/api/cron/materialize-sessions")
      .set("Authorization", "Bearer wrong-secret");
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("not_found");
  });

  it("404s a wrong x-cron-secret header", async () => {
    const res = await request(app)
      .post("/api/cron/materialize-sessions")
      .set("x-cron-secret", "wrong-secret");
    expect(res.status).toBe(404);
  });

  it("404s no auth header at all", async () => {
    const res = await request(app).post("/api/cron/materialize-sessions");
    expect(res.status).toBe(404);
  });
});

describe("cron failure isolation + audit trail", () => {
  it("a per-org failure in reporting-daily writes an audit_events row and reports ok:false", async () => {
    const originalQuery = pool.query.bind(pool);
    const spy = vi.spyOn(pool, "query").mockImplementation(async (text: string, params: any[] = []) => {
      if (text.includes("insert into org_stats_daily") && params[1] === ORG) {
        throw new Error("simulated reporting-daily failure");
      }
      return originalQuery(text, params);
    });

    try {
      const res = await request(app)
        .post("/api/cron/reporting-daily")
        .set("x-cron-secret", CRON_SECRET)
        .send({ date: "2026-09-10" });

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ organizationId: ORG, error: "simulated reporting-daily failure" }),
        ])
      );

      const auditRes = await db.query(
        `select * from audit_events where organization_id = $1 and action = $2`,
        [ORG, "cron.reporting_daily_failed"]
      );
      expect((auditRes.rows as any[]).length).toBeGreaterThan(0);
      const row = (auditRes.rows as any[])[0];
      expect(row.payload.error).toBe("simulated reporting-daily failure");
      expect(row.payload.date).toBe("2026-09-10");
    } finally {
      spy.mockRestore();
    }
  });
});
