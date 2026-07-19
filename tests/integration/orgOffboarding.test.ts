/**
 * Stage 3: org export/offboarding (DEV_PLAN §5, old E16.3). The DB-level
 * contract under test: offboarding an org is a status flip on `organizations`
 * only, so RLS keeps working exactly as before and — critically — no row on
 * any financial table is ever touched, satisfying the 8-year retention
 * requirement even in the offboarded state. The actual "block further app
 * usage" enforcement lives in server/middleware/auth.ts's requireOrg, which
 * is Express-level and out of PGlite's reach — covered by the manual
 * browser walkthrough in HANDOFF instead until the supertest hardening pass
 * (DEV_PLAN §9) adds route-level coverage.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootDb, scenario, expectDenied, type As } from "./db.ts";
import { seed, ORG, uids, ids } from "./fixtures.ts";

let db: PGlite;

beforeAll(async () => {
  db = await bootDb();
});

afterAll(async () => {
  await db.close();
});

function withFixtures(body: (tx: PGlite, as: As) => Promise<void>) {
  return () =>
    scenario(db, async (tx, as) => {
      await as(null, "service_role");
      await seed(tx);
      await body(tx, as);
    });
}

describe("organizations.status", () => {
  it(
    "defaults new orgs to 'active'",
    withFixtures(async (tx) => {
      const res = await tx.query(`select status from organizations where id = $1`, [ORG]);
      expect(res.rows).toEqual([{ status: "active" }]);
    })
  );

  it(
    "rejects a status outside the allowed enum",
    withFixtures(async (tx) => {
      await expectDenied(tx, () =>
        tx.query(`update organizations set status = 'deleted' where id = $1`, [ORG])
      );
    })
  );

  it(
    "lets service_role flip an org to offboarded (the offboard route's own write)",
    withFixtures(async (tx) => {
      await tx.query(
        `update organizations set status = 'offboarded', offboarded_at = now(), offboarded_by = $2 where id = $1`,
        [ORG, uids.owner]
      );
      const res = await tx.query(`select status, offboarded_by from organizations where id = $1`, [ORG]);
      expect(res.rows).toEqual([{ status: "offboarded", offboarded_by: uids.owner }]);
    })
  );
});

describe("offboarding never touches financial data", () => {
  it(
    "leaves every invoice/payment row exactly as it was after the org is offboarded",
    withFixtures(async (tx, as) => {
      const before = await tx.query(`select id, total_paise, paid_paise, status from invoices where organization_id = $1`, [ORG]);
      expect(before.rows.length).toBeGreaterThan(0);

      await tx.query(`update organizations set status = 'offboarded', offboarded_at = now() where id = $1`, [ORG]);

      const after = await tx.query(`select id, total_paise, paid_paise, status from invoices where organization_id = $1`, [ORG]);
      expect(after.rows).toEqual(before.rows);

      // Admin-role RLS reads still work unchanged — offboarding introduces
      // no new RLS restriction, it's purely an app-layer usage block.
      await as(uids.admin, "authenticated");
      const asAdmin = await tx.query(`select id from invoices where organization_id = $1`, [ORG]);
      expect(asAdmin.rows.length).toBe(before.rows.length);
    })
  );

  it(
    "the invoice fixture row still exists by id after offboarding, not just by count",
    withFixtures(async (tx) => {
      await tx.query(`update organizations set status = 'offboarded' where id = $1`, [ORG]);
      const res = await tx.query(`select id from invoices where id = $1`, [ids.inv1]);
      expect(res.rows).toEqual([{ id: ids.inv1 }]);
    })
  );
});
