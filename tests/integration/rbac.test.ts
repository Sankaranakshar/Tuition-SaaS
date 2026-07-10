/**
 * Postgres RLS test suite: the executable RBAC constitution.
 *
 * Successor to the deleted tests/rules/rbac.test.ts (Firestore rules, run
 * against the Firebase emulator). Same coverage — C1-C5 plus parent/student
 * access and server-only tables — ported onto supabase/migrations/*.sql's
 * RLS policies. Runs against a real Postgres engine (PGlite: Postgres
 * compiled to WASM, not an emulation) with every migration file applied, so
 * this tests the actual policies that ship, not a paraphrase of them.
 *
 * Any PR touching supabase/migrations/*.sql or a privileged server route
 * must keep this suite green.
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import type { PGlite } from "@electric-sql/pglite";
import { bootDb, scenario, expectDenied, type As } from "./db.ts";
import { seed, ORG, OTHER_ORG, uids, ids } from "./fixtures.ts";

let db: PGlite;

beforeAll(async () => {
  db = await bootDb();
});

afterAll(async () => {
  await db.close();
});

/** Runs `body` inside a fresh, fully-seeded, rolled-back-at-the-end transaction. */
function withFixtures(body: (tx: PGlite, as: As) => Promise<void>) {
  return () =>
    scenario(db, async (tx, as) => {
      await as(null, "service_role");
      await seed(tx);
      await body(tx, as);
    });
}

// ===================================================================
// C1: privilege escalation via self-writable fields
// ===================================================================
describe("C1: no self-service role escalation", () => {
  it(
    "denies a user escalating their own profile's organization_id",
    withFixtures(async (tx, as) => {
      await tx.query(`insert into profiles (id, organization_id, name) values ($1, $2, 'Student S')`, [uids.student, ORG]);
      await as(uids.student, "authenticated");
      await expectDenied(tx, () => tx.query(`update profiles set organization_id = $1 where id = $2`, [OTHER_ORG, uids.student]));
    })
  );

  it(
    "allows harmless profile updates on own profile",
    withFixtures(async (tx, as) => {
      await tx.query(`insert into profiles (id, organization_id, name) values ($1, $2, 'Student S')`, [uids.student, ORG]);
      await as(uids.student, "authenticated");
      const res = await tx.query(`update profiles set name = 'New Name', phone = '123' where id = $1`, [uids.student]);
      expect(res.affectedRows).toBe(1);
    })
  );

  it(
    "denies inserting a profile row for someone else",
    withFixtures(async (tx, as) => {
      await as(uids.anon, "authenticated");
      await expectDenied(tx, () => tx.query(`insert into profiles (id, name) values ($1, 'Forged')`, [uids.student]));
    })
  );

  it(
    "denies any client write to organization_members",
    withFixtures(async (tx, as) => {
      await as(uids.student, "authenticated");
      await expectDenied(tx, () => tx.query(`insert into organization_members (organization_id, user_id, role) values ($1, $2, 'owner')`, [ORG, uids.student]));

      await as(uids.owner, "authenticated");
      await expectDenied(tx, () => tx.query(`insert into organization_members (organization_id, user_id, role) values ($1, gen_random_uuid(), 'tutor')`, [ORG]));
    })
  );
});

// ===================================================================
// C2: money is never client-writable
// ===================================================================
describe("C2: financial tables deny all client writes", () => {
  it(
    "student cannot mark their invoice paid",
    withFixtures(async (tx, as) => {
      await as(uids.student, "authenticated");
      const res = await tx.query(`update invoices set status = 'paid' where id = $1`, [ids.inv1]);
      expect(res.affectedRows).toBe(0); // no update policy at all -> RLS filters the row out, no error
    })
  );

  it(
    "even the org owner cannot write invoices from the client",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      const upd = await tx.query(`update invoices set status = 'paid' where id = $1`, [ids.inv1]);
      expect(upd.affectedRows).toBe(0);
      await expectDenied(tx, () => tx.query(`insert into invoices (organization_id, student_id, total_paise) values ($1, $2, 1)`, [ORG, ids.stu1]));
    })
  );

  it(
    "nobody can top up a wallet from the client",
    withFixtures(async (tx, as) => {
      await as(uids.student, "authenticated");
      const r1 = await tx.query(`update wallets set balance_credits = 9999 where id = $1`, [ids.wal1]);
      expect(r1.affectedRows).toBe(0);

      await as(uids.owner, "authenticated");
      const r2 = await tx.query(`update wallets set balance_credits = 9999 where id = $1`, [ids.wal1]);
      expect(r2.affectedRows).toBe(0);
    })
  );

  it(
    "attendance records reject client writes",
    withFixtures(async (tx, as) => {
      await as(uids.tutor, "authenticated");
      await expectDenied(tx, () => tx.query(
          `insert into attendance_records (organization_id, session_id, student_id, status, session_start)
           values ($1, $2, $3, 'present', now())`,
          [ORG, ids.sess1, ids.stu1]
        ));
    })
  );

  it(
    "sessions cannot be flipped to completed from the client",
    withFixtures(async (tx, as) => {
      await as(uids.tutor, "authenticated");
      await expectDenied(tx, () => tx.query(`update class_sessions set status = 'completed' where id = $1`, [ids.sess1]));
    })
  );

  it(
    "but scheduling updates (reschedule) by staff still work",
    withFixtures(async (tx, as) => {
      await as(uids.tutor, "authenticated");
      const res = await tx.query(`update class_sessions set room_number = 'B2' where id = $1`, [ids.sess1]);
      expect(res.affectedRows).toBe(1);
    })
  );

  // E3.6: capacity/conflict checks must run inside a server transaction, not
  // a client read-then-write. Direct client create is denied for both
  // tables; only POST /api/v1/scheduling/* (service_role) can create them.
  it(
    "class_sessions reject client-side create (capacity/conflict must be server-checked)",
    withFixtures(async (tx, as) => {
      await as(uids.tutor, "authenticated");
      await expectDenied(tx, () => tx.query(
          `insert into class_sessions (organization_id, tutor_id, start_time, end_time, status)
           values ($1, $2, '2026-01-01T10:00:00Z', '2026-01-01T11:00:00Z', 'scheduled')`,
          [ORG, uids.tutor]
        ));
    })
  );

  it(
    "enrollments reject client-side create (capacity must be server-checked)",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      await tx.query(
        `insert into class_templates (id, organization_id, name) values (gen_random_uuid(), $1, 'tmpl') returning id`,
        [ORG]
      );
      const tmpl = await tx.query<{ id: string }>(`select id from class_templates where organization_id = $1 limit 1`, [ORG]);
      await expectDenied(tx, () => tx.query(
          `insert into enrollments (organization_id, student_id, template_id, status) values ($1, $2, $3, 'active')`,
          [ORG, ids.stu1, tmpl.rows[0].id]
        ));
    })
  );
});

// ===================================================================
// C3: role granularity replaces a flat "is org member" check
// ===================================================================
describe("C3: role-aware access", () => {
  it(
    "student org member cannot read the lead pipeline",
    withFixtures(async (tx, as) => {
      await as(uids.student, "authenticated");
      const res = await tx.query(`select * from leads where id = $1`, [ids.lead1]);
      expect(res.rows.length).toBe(0);
    })
  );

  it(
    "parent org member cannot read leads either",
    withFixtures(async (tx, as) => {
      await as(uids.parent, "authenticated");
      const res = await tx.query(`select * from leads where id = $1`, [ids.lead1]);
      expect(res.rows.length).toBe(0);
    })
  );

  it(
    "accountant cannot read leads (matrix: none)",
    withFixtures(async (tx, as) => {
      await as(uids.accountant, "authenticated");
      const res = await tx.query(`select * from leads where id = $1`, [ids.lead1]);
      expect(res.rows.length).toBe(0);
    })
  );

  it(
    "frontdesk can create leads",
    withFixtures(async (tx, as) => {
      await as(uids.frontdesk, "authenticated");
      const res = await tx.query(
        `insert into leads (organization_id, name, status) values ($1, 'New Lead', 'new') returning id`,
        [ORG]
      );
      expect(res.affectedRows).toBe(1);
    })
  );

  it(
    "student cannot delete a student record",
    withFixtures(async (tx, as) => {
      await as(uids.student, "authenticated");
      const res = await tx.query(`delete from students where id = $1`, [ids.stu1]);
      expect(res.affectedRows).toBe(0);
    })
  );

  it(
    "nobody hard-deletes students, not even the owner",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      const res = await tx.query(`delete from students where id = $1`, [ids.stu1]);
      expect(res.affectedRows).toBe(0);
    })
  );

  it(
    "tutor updates are limited to notes",
    withFixtures(async (tx, as) => {
      await as(uids.tutor, "authenticated");
      const ok = await tx.query(`update students set notes = 'doing well' where id = $1`, [ids.stu1]);
      expect(ok.affectedRows).toBe(1);
      await expectDenied(tx, () => tx.query(`update students set name = 'Renamed' where id = $1`, [ids.stu1]));
    })
  );

  it(
    "accountant reads invoices (but frontdesk-only actions stay closed)",
    withFixtures(async (tx, as) => {
      await as(uids.accountant, "authenticated");
      const res = await tx.query(`select * from invoices where id = $1`, [ids.inv1]);
      expect(res.rows.length).toBe(1);
    })
  );

  it(
    "cross-org staff see nothing",
    withFixtures(async (tx, as) => {
      await as(uids.outsider, "authenticated");
      const s = await tx.query(`select * from students where id = $1`, [ids.stu1]);
      const i = await tx.query(`select * from invoices where id = $1`, [ids.inv1]);
      const l = await tx.query(`select * from leads where id = $1`, [ids.lead1]);
      expect(s.rows.length).toBe(0);
      expect(i.rows.length).toBe(0);
      expect(l.rows.length).toBe(0);
    })
  );
});

// ===================================================================
// C4: messaging is participants-only
// ===================================================================
describe("C4: conversation privacy", () => {
  it(
    "a non-participant staff member cannot read another tutor's conversation",
    withFixtures(async (tx, as) => {
      await as(uids.tutor2, "authenticated");
      const m = await tx.query(`select * from messages where id = $1`, [ids.msg1]);
      const c = await tx.query(`select * from conversations where id = $1`, [ids.conv1]);
      expect(m.rows.length).toBe(0);
      expect(c.rows.length).toBe(0);
    })
  );

  it(
    "participants can read their thread",
    withFixtures(async (tx, as) => {
      await as(uids.parent, "authenticated");
      const m = await tx.query(`select * from messages where id = $1`, [ids.msg1]);
      expect(m.rows.length).toBe(1);

      await as(uids.tutor, "authenticated");
      const c = await tx.query(`select * from conversations where id = $1`, [ids.conv1]);
      expect(c.rows.length).toBe(1);
    })
  );

  it(
    "sender identity cannot be forged on create",
    withFixtures(async (tx, as) => {
      await as(uids.parent, "authenticated");
      await expectDenied(tx, () => tx.query(
          `insert into messages (organization_id, sender_id, receiver_id, body) values ($1, $2, $3, 'forged')`,
          [ORG, uids.tutor, uids.parent]
        ));
    })
  );
});

// ===================================================================
// C5: no cross-tenant profile leaks
// ===================================================================
describe("C5: tutor profiles are org-scoped", () => {
  it(
    "an outsider cannot read a tutor profile from another org",
    withFixtures(async (tx, as) => {
      await as(uids.outsider, "authenticated");
      const res = await tx.query(`select * from tutor_profiles where user_id = $1`, [uids.tutor]);
      expect(res.rows.length).toBe(0);
    })
  );

  it(
    "staff in the same org can",
    withFixtures(async (tx, as) => {
      await as(uids.frontdesk, "authenticated");
      const res = await tx.query(`select * from tutor_profiles where user_id = $1`, [uids.tutor]);
      expect(res.rows.length).toBe(1);
    })
  );

  // Real bug found rebuilding tutor verification into the People workspace
  // (DEV_PLAN §2a Stage 2 item 1): the old policy's `with check` only ever
  // allowed `user_id = auth.uid()`, so an admin's UPDATE of someone else's
  // `is_verified` always satisfied `using` but always failed `with check` —
  // 0 rows updated, no error. Fixed in migration 20260710140000.
  it(
    "an org admin can verify another tutor's profile",
    withFixtures(async (tx, as) => {
      await as(uids.admin, "authenticated");
      const res = await tx.query(
        `update tutor_profiles set is_verified = true where user_id = $1 returning user_id`,
        [uids.tutor]
      );
      expect(res.rows.length).toBe(1);
    })
  );

  it(
    "a non-admin staff member (frontdesk) cannot verify a tutor",
    withFixtures(async (tx, as) => {
      await as(uids.frontdesk, "authenticated");
      await expectDenied(tx, () => tx.query(
        `update tutor_profiles set is_verified = true where user_id = $1`,
        [uids.tutor]
      ));
    })
  );

  it(
    "a tutor cannot verify another tutor's profile",
    withFixtures(async (tx, as) => {
      await as(uids.tutor2, "authenticated");
      await expectDenied(tx, () => tx.query(
        `update tutor_profiles set is_verified = true where user_id = $1`,
        [uids.tutor]
      ));
    })
  );
});

// ===================================================================
// Parent/student read paths
// ===================================================================
describe("Parent and student access", () => {
  it(
    "parent reads own child's student record, invoice, wallet, attendance",
    withFixtures(async (tx, as) => {
      await as(uids.parent, "authenticated");
      const s = await tx.query(`select * from students where id = $1`, [ids.stu1]);
      const i = await tx.query(`select * from invoices where id = $1`, [ids.inv1]);
      const w = await tx.query(`select * from wallets where id = $1`, [ids.wal1]);
      const a = await tx.query(`select * from attendance_records where session_id = $1 and student_id = $2`, [ids.sess1, ids.stu1]);
      expect(s.rows.length).toBe(1);
      expect(i.rows.length).toBe(1);
      expect(w.rows.length).toBe(1);
      expect(a.rows.length).toBe(1);
    })
  );

  it(
    "student reads own records",
    withFixtures(async (tx, as) => {
      await as(uids.student, "authenticated");
      const s = await tx.query(`select * from students where id = $1`, [ids.stu1]);
      const i = await tx.query(`select * from invoices where id = $1`, [ids.inv1]);
      expect(s.rows.length).toBe(1);
      expect(i.rows.length).toBe(1);
    })
  );

  it(
    "student reads own session via denormalized student_user_ids",
    withFixtures(async (tx, as) => {
      await as(uids.student, "authenticated");
      const res = await tx.query(`select * from class_sessions where id = $1`, [ids.sess1]);
      expect(res.rows.length).toBe(1);
    })
  );

  // Regression test for a real bug found post-migration: student_ids holds
  // student RECORD ids (what the booking UI populates), so RLS/client
  // queries matching a logged-in user must go through the separate
  // student_user_ids/parent_user_ids arrays instead — see
  // 0013_class_sessions_id_space_fix.sql.
  it(
    "parent reads their child's session via denormalized parent_user_ids",
    withFixtures(async (tx, as) => {
      await as(uids.parent, "authenticated");
      const res = await tx.query(`select * from class_sessions where id = $1`, [ids.sess1]);
      expect(res.rows.length).toBe(1);
    })
  );

  it(
    "an unrelated authenticated user reads none of it",
    withFixtures(async (tx, as) => {
      await as(uids.anon, "authenticated");
      const s = await tx.query(`select * from students where id = $1`, [ids.stu1]);
      const i = await tx.query(`select * from invoices where id = $1`, [ids.inv1]);
      const c = await tx.query(`select * from class_sessions where id = $1`, [ids.sess1]);
      expect(s.rows.length).toBe(0);
      expect(i.rows.length).toBe(0);
      expect(c.rows.length).toBe(0);
    })
  );

  it(
    "parent_links cannot be forged from the client",
    withFixtures(async (tx, as) => {
      await as(uids.anon, "authenticated");
      await expectDenied(tx, () => tx.query(
          `insert into parent_links (parent_user_id, student_id, organization_id) values ($1, $2, $3)`,
          [uids.anon, ids.stu1, ORG]
        ));
    })
  );

  // E10.1: parent_invites is a token store minted/redeemed only by
  // /api/v1/parents (service_role). It has zero client read or write path,
  // including for the staff who created the invite or the owner. Unlike
  // Firestore (where a rules-denied read throws), a Postgres table with RLS
  // enabled and no policy for a role just returns zero rows for SELECT —
  // still zero access, just a different failure shape.
  it(
    "parent_invites has no client read or write path at all",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      const asOwner = await tx.query(`select * from parent_invites where token = 'tok1'`);
      expect(asOwner.rows.length).toBe(0);
      await expectDenied(tx, () => tx.query(
          `insert into parent_invites (token, organization_id, student_id, expires_at) values ('tok2', $1, $2, now() + interval '1 day')`,
          [ORG, ids.stu1]
        ));

      await as(uids.admin, "authenticated");
      const asAdmin = await tx.query(`select * from parent_invites where token = 'tok1'`);
      expect(asAdmin.rows.length).toBe(0);
    })
  );

  // Tech Debt #16: student_invites mirrors parent_invites exactly — a token
  // store minted/redeemed only by /api/v1/students (service_role), zero
  // client read or write path for anyone, including staff who created it.
  it(
    "student_invites has no client read or write path at all",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      const asOwner = await tx.query(`select * from student_invites where token = 'stok1'`);
      expect(asOwner.rows.length).toBe(0);
      await expectDenied(tx, () => tx.query(
          `insert into student_invites (token, organization_id, student_id, expires_at) values ('stok2', $1, $2, now() + interval '1 day')`,
          [ORG, ids.stu1]
        ));

      await as(uids.admin, "authenticated");
      const asAdmin = await tx.query(`select * from student_invites where token = 'stok1'`);
      expect(asAdmin.rows.length).toBe(0);
    })
  );
});

// ===================================================================
// Governance / server-only tables
// ===================================================================
describe("Audit and server-only tables", () => {
  it(
    "admin and accountant read audit events; tutor does not",
    withFixtures(async (tx, as) => {
      await as(uids.admin, "authenticated");
      const asAdmin = await tx.query(`select * from audit_events where id = $1`, [ids.aud1]);
      expect(asAdmin.rows.length).toBe(1);

      await as(uids.accountant, "authenticated");
      const asAccountant = await tx.query(`select * from audit_events where id = $1`, [ids.aud1]);
      expect(asAccountant.rows.length).toBe(1);

      await as(uids.tutor, "authenticated");
      const asTutor = await tx.query(`select * from audit_events where id = $1`, [ids.aud1]);
      expect(asTutor.rows.length).toBe(0);
    })
  );

  it(
    "audit events reject client writes",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      await expectDenied(tx, () => tx.query(`insert into audit_events (organization_id, action) values ($1, 'fake')`, [ORG]));
    })
  );

  it(
    "google_tokens are unreachable from any client",
    withFixtures(async (tx, as) => {
      await as(uids.tutor, "authenticated");
      const res = await tx.query(`select * from google_tokens where user_id = $1`, [uids.tutor]);
      expect(res.rows.length).toBe(0);
      await expectDenied(tx, () => tx.query(
          `insert into google_tokens (organization_id, user_id, access_token_enc) values ($1, $2, 'x')`,
          [OTHER_ORG, uids.tutor]
        ));
    })
  );

  it(
    "payment_gateways (encrypted Razorpay secrets) are unreachable from any client",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      const res = await tx.query(`select * from payment_gateways where organization_id = $1`, [ORG]);
      expect(res.rows.length).toBe(0);
      // No policy at all -> RLS filters the row out silently (0 rows), not an error.
      const upd = await tx.query(`update payment_gateways set key_id = 'rzp_evil' where organization_id = $1`, [ORG]);
      expect(upd.affectedRows).toBe(0);
    })
  );

  it(
    "invoice-number counters cannot be tampered with client-side",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      const res = await tx.query(`select * from invoice_counters where organization_id = $1 and year = 2026`, [ORG]);
      expect(res.rows.length).toBe(0);
      await expectDenied(tx, () => tx.query(`insert into invoice_counters (organization_id, year, seq) values ($1, 2027, 9999)`, [ORG]));
    })
  );

  it(
    "refunds are server-written only",
    withFixtures(async (tx, as) => {
      await as(uids.owner, "authenticated");
      await expectDenied(tx, () => tx.query(
          `insert into refunds (organization_id, invoice_id, amount_paise, invoice_status, idempotency_key)
           values ($1, $2, 100000, 'paid', 'test-key')`,
          [ORG, ids.inv1]
        ));
    })
  );

  it(
    "organizations cannot be created client-side (bootstrap API only)",
    withFixtures(async (tx, as) => {
      await as(uids.anon, "authenticated");
      await expectDenied(tx, () => tx.query(`insert into organizations (name) values ('Rogue Org')`));
    })
  );
});
