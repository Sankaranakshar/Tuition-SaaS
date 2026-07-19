/**
 * Stage 3 super-admin console (DEV_PLAN §5) — platform_admins/
 * platform_admin_actions RLS. The console's own routes (server/routes/admin.ts)
 * are guarded by requirePlatformAdmin, which is a server-side check against
 * platform_admins using the service_role client — this suite covers the one
 * thing RLS itself needs to enforce: that platform_admins is otherwise a
 * self-check-only table, and platform_admin_actions is fully server-only.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootDb, scenario, expectDenied, type As } from "./db.ts";
import { seed, ORG, uids } from "./fixtures.ts";

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
      await tx.query(`insert into platform_admins (user_id, note) values ($1, 'test admin')`, [uids.owner]);
      await body(tx, as);
    });
}

describe("platform_admins RLS", () => {
  it(
    "a user can see their own platform_admins row",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      const res = await tx.query(`select user_id from platform_admins where user_id = $1`, [uids.owner]);
      expect(res.rows.length).toBe(1);
    })
  );

  it(
    "a non-admin user's self-check correctly finds no row",
    withFixtures(async (tx, as) => {
      await as(uids.tutor, "authenticated");
      const res = await tx.query(`select user_id from platform_admins where user_id = $1`, [uids.tutor]);
      expect(res.rows.length).toBe(0);
    })
  );

  it(
    "a user cannot see ANOTHER user's platform_admins row, even the real admin's",
    withFixtures(async (tx, as) => {
      await as(uids.tutor, "authenticated");
      const res = await tx.query(`select user_id from platform_admins where user_id = $1`, [uids.owner]);
      expect(res.rows.length).toBe(0); // RLS filters to self only, regardless of the query's own WHERE clause
    })
  );

  it(
    "no client role can insert into platform_admins (server/service_role only)",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      await expectDenied(tx, () =>
        tx.query(`insert into platform_admins (user_id) values ($1)`, [uids.tutor])
      );
    })
  );
});

describe("platform_admin_actions RLS", () => {
  it(
    "no client role can read platform_admin_actions at all",
    withFixtures(async (tx, as) => {
      await as(null, "service_role");
      await tx.query(
        `insert into platform_admin_actions (actor_id, action, target_organization_id) values ($1, 'impersonate', $2)`,
        [uids.owner, ORG]
      );
      await as(uids.owner, "authenticated"); // even the platform admin themself, via the client role
      const res = await tx.query(`select id from platform_admin_actions`);
      expect(res.rows.length).toBe(0);
    })
  );

  it(
    "no client role can write to platform_admin_actions",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      await expectDenied(tx, () =>
        tx.query(`insert into platform_admin_actions (actor_id, action) values ($1, 'impersonate')`, [uids.owner])
      );
    })
  );
});
