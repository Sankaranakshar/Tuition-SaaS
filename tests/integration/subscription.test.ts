/**
 * Stage 3 SaaS subscription billing (DEV_PLAN §5) — the plan-limit trigger
 * and subscriptions RLS are the enforceable part of this feature (pricing
 * display, checkout degradation, etc. are covered by tests/unit/subscription.test.ts).
 * Runs against the same PGlite-backed migration set as tests/integration/rbac.test.ts.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootDb, scenario, expectDenied, type As } from "./db.ts";
import { seed, ORG, OTHER_ORG, uids } from "./fixtures.ts";

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

describe("subscriptions: auto-created on org creation", () => {
  it(
    "gives a freshly-created org a free-plan subscription row with the right cap",
    withFixtures(async (tx) => {
      const res = await tx.query(
        `select plan, status, student_limit, price_paise from subscriptions where organization_id = $1`,
        [ORG]
      );
      expect(res.rows).toEqual([{ plan: "free", status: "active", student_limit: 15, price_paise: 0 }]);
    })
  );

  it(
    "gives a brand-new org (created after seed, not by seed itself) its own free-plan row",
    withFixtures(async (tx) => {
      const newOrgId = "00000000-0000-0000-0000-0000000000c1";
      await tx.query(`insert into organizations (id, name) values ($1, 'Org C')`, [newOrgId]);
      const res = await tx.query(`select plan, student_limit from subscriptions where organization_id = $1`, [newOrgId]);
      expect(res.rows).toEqual([{ plan: "free", student_limit: 15 }]);
    })
  );
});

describe("subscriptions: RLS (admin-only read)", () => {
  it(
    "lets an org admin read their own org's subscription",
    withFixtures(async (tx, as) => {
      await as(uids.admin, "authenticated");
      const res = await tx.query(`select plan from subscriptions where organization_id = $1`, [ORG]);
      expect(res.rows.length).toBe(1);
    })
  );

  it(
    "denies a non-admin staff member (tutor) reading their own org's subscription",
    withFixtures(async (tx, as) => {
      await as(uids.tutor, "authenticated");
      const res = await tx.query(`select plan from subscriptions where organization_id = $1`, [ORG]);
      expect(res.rows.length).toBe(0); // RLS filters rather than errors on SELECT
    })
  );

  it(
    "denies an outsider (member of a different org) reading this org's subscription",
    withFixtures(async (tx, as) => {
      await as(uids.outsider, "authenticated");
      const res = await tx.query(`select plan from subscriptions where organization_id = $1`, [ORG]);
      expect(res.rows.length).toBe(0);
    })
  );

  it(
    "no client role can write to subscriptions directly (server/service_role only)",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      // No update policy exists at all, so RLS filters the target row out
      // rather than raising an error — same pattern as invoices/payments
      // (see rbac.test.ts's "no client write" assertions).
      const res = await tx.query(`update subscriptions set plan = 'scale' where organization_id = $1`, [ORG]);
      expect(res.affectedRows).toBe(0);
    })
  );
});

describe("students_enforce_plan_limit trigger", () => {
  it(
    "allows creating a student while under the plan's cap",
    withFixtures(async (tx, as) => {
      // Free plan cap is 15; seed() already created 1 (Riya) for ORG. Uses
      // "authenticated" (not service_role) to match the real path — staff
      // create students via a direct client insert (People.tsx), not a
      // server route, so the trigger must not interfere with that RLS-
      // permitted path.
      await as(uids.owner, "authenticated");
      const res = await tx.query(
        `insert into students (organization_id, name, status) values ($1, 'New Student', 'active') returning id`,
        [ORG]
      );
      expect(res.rows.length).toBe(1);
    })
  );

  it(
    "rejects creating a student once the plan's cap is reached, regardless of role",
    withFixtures(async (tx, as) => {
      await as(null, "service_role");
      await tx.query(`update subscriptions set student_limit = 1 where organization_id = $1`, [ORG]);
      // seed() already put ORG at exactly 1 active student (Riya) — at cap now.
      await as(uids.owner, "authenticated");
      await expectDenied(tx, () =>
        tx.query(`insert into students (organization_id, name, status) values ($1, 'Over Cap', 'active')`, [ORG])
      );
    })
  );

  it(
    "does not count archived (is_deleted) or inactive students against the cap",
    withFixtures(async (tx, as) => {
      await as(null, "service_role");
      await tx.query(`update subscriptions set student_limit = 1 where organization_id = $1`, [ORG]);
      await tx.query(`update students set is_deleted = true where organization_id = $1`, [ORG]);
      const res = await tx.query(
        `insert into students (organization_id, name, status) values ($1, 'Replacement', 'active') returning id`,
        [ORG]
      );
      expect(res.rows.length).toBe(1);
    })
  );

  it(
    "caps are independent per org — a full ORG doesn't block OTHER_ORG",
    withFixtures(async (tx, as) => {
      await as(null, "service_role");
      await tx.query(`update subscriptions set student_limit = 1 where organization_id = $1`, [ORG]);
      const res = await tx.query(
        `insert into students (organization_id, name, status) values ($1, 'Org B Student', 'active') returning id`,
        [OTHER_ORG]
      );
      expect(res.rows.length).toBe(1);
    })
  );

  it(
    "an unlimited plan (null student_limit) never rejects",
    withFixtures(async (tx, as) => {
      await as(null, "service_role");
      await tx.query(`update subscriptions set plan = 'scale', student_limit = null where organization_id = $1`, [ORG]);
      const res = await tx.query(
        `insert into students (organization_id, name, status) values ($1, 'Unlimited', 'active') returning id`,
        [ORG]
      );
      expect(res.rows.length).toBe(1);
    })
  );
});
