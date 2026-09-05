/**
 * B-11 / EXECUTION_PLAN.md Step 10: DPDP consent record + per-student
 * erasure. The DB-level contract under test:
 *
 *   - consent_records is server-write-only (no insert/update/delete policy),
 *     readable by the consenting user (their own rows) and by org staff.
 *   - students.erased_at / erased_by exist and default null.
 *   - an anonymized (erased) students stub keeps every financial foreign key
 *     resolvable — no invoice/payment/wallet/attendance row is touched — so
 *     the 8-year retention obligation is met even after erasure, same
 *     property org offboarding relies on.
 *
 * The erasure route logic itself (server/utils/erasure.ts) runs on the
 * service_role connection and is covered by tests/contract/studentErasure.ts;
 * this suite is the RLS/constraint layer underneath it.
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
      // one consent row for the fixture parent linking to the fixture student
      await tx.query(
        `insert into consent_records (organization_id, user_id, student_id, role, consent_version)
         values ($1, $2, $3, 'parent', 'dpdp-test.v1')`,
        [ORG, uids.parent, ids.stu1]
      );
      await body(tx, as);
    });
}

describe("consent_records RLS", () => {
  it(
    "lets the consenting user read their own row",
    withFixtures(async (tx, as) => {
      await as(uids.parent, "authenticated");
      const res = await tx.query(`select role, consent_version from consent_records where user_id = $1`, [uids.parent]);
      expect(res.rows).toEqual([{ role: "parent", consent_version: "dpdp-test.v1" }]);
    })
  );

  it(
    "lets org staff read the org's consent rows",
    withFixtures(async (tx, as) => {
      await as(uids.tutor, "authenticated");
      const res = await tx.query<{ n: number }>(`select count(*)::int as n from consent_records where organization_id = $1`, [ORG]);
      expect(res.rows[0].n).toBe(1);
    })
  );

  it(
    "hides a consent row from an unrelated user in another org",
    withFixtures(async (tx, as) => {
      await as(uids.outsider, "authenticated");
      const res = await tx.query<{ n: number }>(`select count(*)::int as n from consent_records`);
      expect(res.rows[0].n).toBe(0);
    })
  );

  it(
    "hides another user's consent row from a non-staff member (student self)",
    withFixtures(async (tx, as) => {
      await as(uids.student, "authenticated");
      const res = await tx.query<{ n: number }>(`select count(*)::int as n from consent_records where user_id = $1`, [uids.parent]);
      expect(res.rows[0].n).toBe(0);
    })
  );

  it(
    "has no client insert path — even an owner cannot write one directly",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      await expectDenied(tx, () =>
        tx.query(
          `insert into consent_records (organization_id, user_id, student_id, role, consent_version)
           values ($1, $2, $3, 'parent', 'x')`,
          [ORG, uids.owner, ids.stu1]
        )
      );
    })
  );

  it(
    "rejects a role outside the ('parent','student') enum",
    withFixtures(async (tx) => {
      await expectDenied(tx, () =>
        tx.query(
          `insert into consent_records (organization_id, user_id, student_id, role, consent_version)
           values ($1, $2, $3, 'owner', 'x')`,
          [ORG, uids.admin, ids.stu1]
        )
      );
    })
  );
});

describe("students erasure columns", () => {
  it(
    "erased_at / erased_by exist and default null",
    withFixtures(async (tx) => {
      const res = await tx.query(`select erased_at, erased_by from students where id = $1`, [ids.stu1]);
      expect(res.rows).toEqual([{ erased_at: null, erased_by: null }]);
    })
  );

  it(
    "an anonymized erased stub keeps the fixture invoice/wallet rows intact and readable by staff",
    withFixtures(async (tx, as) => {
      // simulate what server/utils/erasure.ts does to the students row
      await tx.query(
        `update students set name = 'Erased student', phone = null, email = null, parent_name = null,
           student_user_id = null, is_deleted = true, erased_at = now(), erased_by = $2 where id = $1`,
        [ids.stu1, uids.owner]
      );
      // financial rows untouched
      const inv = await tx.query(`select total_paise from invoices where id = $1`, [ids.inv1]);
      expect(inv.rows).toEqual([{ total_paise: 300000 }]);
      const wal = await tx.query(`select balance_credits from wallets where id = $1`, [ids.wal1]);
      expect(wal.rows).toEqual([{ balance_credits: 5 }]);

      await as(uids.admin, "authenticated");
      const asAdmin = await tx.query(`select name from students where id = $1`, [ids.stu1]);
      expect(asAdmin.rows).toEqual([{ name: "Erased student" }]);
    })
  );
});
