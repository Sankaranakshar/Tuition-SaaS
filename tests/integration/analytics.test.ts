/**
 * C-07 (EXECUTION_PLAN.md Step 32): product_events, org_activation and
 * org_weekly_loop are server-only (D-11). No client role, including the
 * org's own owner, may read or write any of them; product_events is
 * append-only even for service_role, except through foreign-key cascades.
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
      await tx.query(
        `insert into product_events (organization_id, actor_user_id, name, properties, dedupe_key)
         values ($1, $2, 'org.created', '{}'::jsonb, 'rls-org-created')`,
        [ORG, uids.owner]
      );
      await tx.query(
        `insert into org_activation (organization_id, signup_at, window_ends_at) values ($1, now(), now() + interval '14 days')`,
        [ORG]
      );
      await tx.query(`insert into org_weekly_loop (organization_id, week_start) values ($1, '2026-09-21')`, [ORG]);
      await body(tx, as);
    });
}

const TABLES = ["product_events", "org_activation", "org_weekly_loop"] as const;

describe("analytics tables have no client read path", () => {
  for (const table of TABLES) {
    it(
      `${table}: invisible to owner, admin, accountant, tutor, parent, student and an outsider`,
      withFixtures(async (tx, as) => {
        for (const who of ["owner", "admin", "accountant", "tutor", "parent", "student", "outsider"] as const) {
          await as(uids[who], "authenticated");
          const res = await tx.query(`select * from ${table} where organization_id = $1`, [ORG]);
          expect(res.rows.length, `${who} read ${table}`).toBe(0);
        }
        await as(null, "anon");
        const anon = await tx.query(`select * from ${table}`);
        expect(anon.rows.length).toBe(0);

        // The seeded rows really are there: service_role sees them.
        await as(null, "service_role");
        const svc = await tx.query(`select * from ${table} where organization_id = $1`, [ORG]);
        expect(svc.rows.length).toBe(1);
      })
    );
  }
});

describe("analytics tables have no client write path", () => {
  it(
    "product_events: an owner cannot insert, update or delete, even for their own org",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      await expectDenied(tx, () =>
        tx.query(`insert into product_events (organization_id, actor_user_id, name) values ($1, $2, 'org.activated')`, [ORG, uids.owner])
      );
      const upd = await tx.query(`update product_events set name = 'org.activated'`);
      expect(upd.affectedRows).toBe(0);
      const del = await tx.query(`delete from product_events`);
      expect(del.affectedRows).toBe(0);
    })
  );

  it(
    "product_events: an anonymous caller cannot insert an onboarding event either",
    withFixtures(async (tx, as) => {
      await as(null, "anon");
      await expectDenied(tx, () =>
        tx.query(`insert into product_events (name, properties) values ('onboarding.beat_viewed', '{"beat":1}'::jsonb)`)
      );
    })
  );

  it(
    "org_activation and org_weekly_loop: an owner cannot write their own org's rollup",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      // No WHERE clause on purpose: an UPDATE with a WHERE also needs a
      // select policy to find rows, so it would read 0 even if someone added
      // an update-only policy. An unfiltered UPDATE needs only the update
      // policy, so this catches that hole too (proven by re-breaking).
      const upd1 = await tx.query(`update org_activation set activated_at = now()`);
      expect(upd1.affectedRows).toBe(0);
      const upd2 = await tx.query(`update org_weekly_loop set collected_paise = 99999999`);
      expect(upd2.affectedRows).toBe(0);
      await expectDenied(tx, () =>
        tx.query(`insert into org_weekly_loop (organization_id, week_start) values ($1, '2026-09-28')`, [ORG])
      );
      await expectDenied(tx, () =>
        tx.query(`insert into org_activation (organization_id, signup_at, window_ends_at) values ($1, now(), now())`, [ORG])
      );
    })
  );
});

describe("product_events is append-only, even for service_role", () => {
  it(
    "a direct update or delete is refused",
    withFixtures(async (tx) => {
      await expectDenied(tx, () => tx.query(`update product_events set properties = '{}'::jsonb where dedupe_key = 'rls-org-created'`));
      await expectDenied(tx, () => tx.query(`delete from product_events where dedupe_key = 'rls-org-created'`));
      const still = await tx.query(`select 1 from product_events where dedupe_key = 'rls-org-created'`);
      expect(still.rows.length).toBe(1);
    })
  );

  it(
    "deleting an org still deletes its events, and deleting a user still clears the actor",
    withFixtures(async (tx) => {
      const orgId = "00000000-0000-0000-0000-0000000000cc";
      const userId = "10000000-0000-0000-0000-0000000000cc";
      await tx.query(`insert into organizations (id, name) values ($1, 'Throwaway')`, [orgId]);
      await tx.query(`insert into auth.users (id, email) values ($1, 'gone@example.com')`, [userId]);
      await tx.query(
        `insert into product_events (organization_id, actor_user_id, name, dedupe_key) values ($1, $2, 'org.created', 'rls-cascade-org'),
                                                                                             ($3, $2, 'org.created', 'rls-cascade-user')`,
        [orgId, userId, ORG]
      );

      await tx.query(`delete from auth.users where id = $1`, [userId]);
      const orphaned = await tx.query(`select actor_user_id from product_events where dedupe_key = 'rls-cascade-user'`);
      expect(orphaned.rows).toEqual([{ actor_user_id: null }]);

      await tx.query(`delete from organizations where id = $1`, [orgId]);
      const gone = await tx.query(`select 1 from product_events where dedupe_key = 'rls-cascade-org'`);
      expect(gone.rows.length).toBe(0);
    })
  );
});

describe("product_events shape constraints", () => {
  it(
    "only onboarding events may have no org",
    withFixtures(async (tx) => {
      const ok = await tx.query(`insert into product_events (actor_user_id, name, properties) values ($1, 'onboarding.beat_viewed', '{"beat":1}'::jsonb)`, [uids.anon]);
      expect(ok.affectedRows).toBe(1);
      await expectDenied(tx, () => tx.query(`insert into product_events (name) values ('attendance.marked')`));
    })
  );

  it(
    "a dedupe key lands once; names are namespaced; properties are a small object",
    withFixtures(async (tx) => {
      const dup = await tx.query(
        `insert into product_events (organization_id, name, dedupe_key) values ($1, 'org.created', 'rls-org-created') on conflict do nothing`,
        [ORG]
      );
      expect(dup.affectedRows).toBe(0);
      await expectDenied(tx, () => tx.query(`insert into product_events (organization_id, name) values ($1, 'Asha Rao')`, [ORG]));
      await expectDenied(tx, () => tx.query(`insert into product_events (organization_id, name, properties) values ($1, 'org.created', '[1]'::jsonb)`, [ORG]));
      await expectDenied(tx, () =>
        tx.query(`insert into product_events (organization_id, name, properties) values ($1, 'org.created', $2::jsonb)`, [ORG, JSON.stringify({ x: "a".repeat(2000) })])
      );
    })
  );
});
