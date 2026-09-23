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

// Vercel Cron always invokes via GET (https://vercel.com/docs/cron-jobs#how-cron-jobs-work),
// never POST — the gap this suite closes. All four routes were POST-only from
// Step 26 (2026-09-14) until this fix: every real unattended scheduled
// invocation 404'd, silently, for 9 days, while every manual/test POST
// request succeeded and masked it. These four assert the actual Vercel
// invocation shape, not just the auth guard.
describe("cron routes accept GET, the method Vercel Cron actually sends", () => {
  it("materialize-sessions", async () => {
    const res = await request(app).get("/api/cron/materialize-sessions").set("Authorization", `Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("reporting-daily", async () => {
    const res = await request(app).get("/api/cron/reporting-daily").set("Authorization", `Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("reconcile-wallets", async () => {
    const res = await request(app).get("/api/cron/reconcile-wallets").set("Authorization", `Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("expire-credits", async () => {
    const res = await request(app).get("/api/cron/expire-credits").set("Authorization", `Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  it("delivery-sweep", async () => {
    const res = await request(app).get("/api/cron/delivery-sweep").set("Authorization", `Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });
});

// B-17 (EXECUTION_PLAN.md Step 27): the delivery sweep sends queued messages
// through the console provider (no live vendor exists yet — see
// server/utils/messaging/provider.ts) and moves a permanently-failing one
// through retry, sms fallback, and dead-letter.
describe("delivery-sweep: send, retry/fallback, and dead-letter", () => {
  it("sends a queued message and marks it sent", async () => {
    const id = crypto.randomUUID();
    await pool.query(
      `insert into message_outbox
         (id, organization_id, recipient_phone, channel, template_key, payload, state, source, idempotency_key)
       values ($1, $2, '+911234567890', 'whatsapp', 'invoice_raised', $3::jsonb, 'queued', '{}'::jsonb, $4)`,
      [id, ORG, JSON.stringify({ studentName: "Test", amountPaise: 1000, dueDate: null, portalUrl: "https://x" }), `sweep-test-${id}`]
    );

    const res = await request(app).get("/api/cron/delivery-sweep").set("Authorization", `Bearer ${CRON_SECRET}`);
    expect(res.status).toBe(200);
    expect(res.body.sent).toBeGreaterThanOrEqual(1);

    const row = (await pool.query(`select state, provider_message_id from message_outbox where id = $1`, [id])).rows[0];
    expect(row.state).toBe("sent");
    expect(row.provider_message_id).toBeTruthy();
  });

  it("a permanently-failing send retries with sms fallback, then dead-letters, writing one audit row", async () => {
    const id = crypto.randomUUID();
    await pool.query(
      `insert into message_outbox
         (id, organization_id, recipient_phone, channel, template_key, payload, state, source, idempotency_key)
       values ($1, $2, '+911234567890', 'whatsapp', 'not_a_real_template', '{}'::jsonb, 'queued', '{}'::jsonb, $3)`,
      [id, ORG, `dead-letter-test-${id}`]
    );

    // renderTemplate throws on an unknown key — every sweep attempt for this
    // row fails deterministically, so driving it to dead_letter needs no
    // provider mock, just enough sweep calls to exhaust MAX_DELIVERY_ATTEMPTS.
    // Each retry's backoff is pushed into the future, so force next_attempt_at
    // back to "now" before each subsequent sweep to avoid a real wall-clock wait.
    for (let i = 0; i < 5; i++) {
      await pool.query(`update message_outbox set next_attempt_at = now() where id = $1`, [id]);
      await request(app).get("/api/cron/delivery-sweep").set("Authorization", `Bearer ${CRON_SECRET}`);
    }

    const row = (await pool.query(`select state, channel, attempts, error from message_outbox where id = $1`, [id])).rows[0];
    expect(row.state).toBe("dead_letter");
    expect(row.channel).toBe("sms"); // flipped from whatsapp on the first failure
    expect(row.attempts).toBe(5);

    const auditRes = await pool.query(
      `select * from audit_events where organization_id = $1 and action = 'cron.messaging_dead_letter' and payload ->> 'entityId' = $2`,
      [ORG, id]
    );
    expect((auditRes.rows as any[]).length).toBe(1);
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
