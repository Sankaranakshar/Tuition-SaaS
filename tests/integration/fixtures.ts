import type { PGlite } from "@electric-sql/pglite";

// Ported 1:1 from the deleted tests/rules/rbac.test.ts's seed() — same
// entities, same relationships, same names — just mapped onto the Postgres
// schema's column names/types (uuid ids instead of Firestore doc-id strings,
// paise-integer money instead of the old rupee fields, etc).
export const ORG = "00000000-0000-0000-0000-00000000000a";
export const OTHER_ORG = "00000000-0000-0000-0000-00000000000b";

export const uids = {
  owner: "10000000-0000-0000-0000-000000000001",
  admin: "10000000-0000-0000-0000-000000000002",
  tutor: "10000000-0000-0000-0000-000000000003",
  tutor2: "10000000-0000-0000-0000-000000000004",
  frontdesk: "10000000-0000-0000-0000-000000000005",
  accountant: "10000000-0000-0000-0000-000000000006",
  parent: "10000000-0000-0000-0000-000000000007",
  student: "10000000-0000-0000-0000-000000000008",
  outsider: "10000000-0000-0000-0000-000000000009", // member of OTHER_ORG
  anon: "10000000-0000-0000-0000-00000000000a", // authenticated, no memberships
};

export const ids = {
  stu1: "20000000-0000-0000-0000-000000000001",
  inv1: "20000000-0000-0000-0000-000000000002",
  wal1: "20000000-0000-0000-0000-000000000003",
  sess1: "20000000-0000-0000-0000-000000000004",
  conv1: "20000000-0000-0000-0000-000000000005",
  msg1: "20000000-0000-0000-0000-000000000006",
  lead1: "20000000-0000-0000-0000-000000000007",
  aud1: "20000000-0000-0000-0000-000000000008",
};

/**
 * Seeds one full scenario's worth of fixtures. Must be called while `as` is
 * set to service_role (bypasses RLS) — see scenario() in db.ts. Every test
 * runs this fresh inside its own rolled-back transaction, so there's no
 * cross-test state and no reset/truncate step needed, matching the original
 * suite's per-test beforeEach(clearFirestore + seed()).
 */
export async function seed(tx: PGlite) {
  for (const uid of Object.values(uids)) {
    await tx.query(`insert into auth.users (id) values ($1)`, [uid]);
  }

  await tx.query(`insert into organizations (id, name) values ($1, 'Org A'), ($2, 'Org B')`, [ORG, OTHER_ORG]);

  const roles: [string, string, string][] = [
    [ORG, uids.owner, "owner"],
    [ORG, uids.admin, "admin"],
    [ORG, uids.tutor, "tutor"],
    [ORG, uids.tutor2, "tutor"],
    [ORG, uids.frontdesk, "frontdesk"],
    [ORG, uids.accountant, "accountant"],
    [ORG, uids.parent, "parent"],
    [ORG, uids.student, "student"],
    [OTHER_ORG, uids.outsider, "owner"],
  ];
  for (const [orgId, userId, role] of roles) {
    await tx.query(
      `insert into organization_members (organization_id, user_id, role) values ($1, $2, $3)`,
      [orgId, userId, role]
    );
  }

  await tx.query(
    `insert into students (id, organization_id, student_user_id, name) values ($1, $2, $3, 'Riya')`,
    [ids.stu1, ORG, uids.student]
  );
  await tx.query(
    `insert into parent_links (parent_user_id, student_id, organization_id) values ($1, $2, $3)`,
    [uids.parent, ids.stu1, ORG]
  );
  await tx.query(
    `insert into invoices (id, organization_id, student_id, total_paise, paid_paise, status)
     values ($1, $2, $3, 300000, 0, 'unpaid')`,
    [ids.inv1, ORG, ids.stu1]
  );
  await tx.query(
    `insert into wallets (id, organization_id, student_id, balance_credits, balance_currency)
     values ($1, $2, $3, 5, 0)`,
    [ids.wal1, ORG, ids.stu1]
  );
  // student_ids holds STUDENT RECORD ids (what the booking UI/staff views
  // key off); student_user_ids/parent_user_ids are the separate,
  // auth-uid-keyed arrays RLS matches against a logged-in student/parent —
  // see 0013_class_sessions_id_space_fix.sql. Seeding this the way the real
  // scheduling.ts route actually populates it, not shortcut-seeding user ids
  // straight into student_ids the way this fixture used to (which matched
  // the bug, not the fix).
  await tx.query(
    `insert into class_sessions (id, organization_id, tutor_id, student_ids, student_user_ids, parent_user_ids, start_time, end_time, status)
     values ($1, $2, $3, $4, $5, $6, '2026-07-01T10:00:00Z', '2026-07-01T11:00:00Z', 'scheduled')`,
    [ids.sess1, ORG, uids.tutor, [ids.stu1], [uids.student], [uids.parent]]
  );
  await tx.query(
    `insert into attendance_records (organization_id, session_id, student_id, tutor_id, status, billed, session_start)
     values ($1, $2, $3, $4, 'present', true, '2026-07-01T10:00:00Z')`,
    [ORG, ids.sess1, ids.stu1, uids.tutor]
  );
  await tx.query(
    `insert into conversations (id, organization_id, participant_ids) values ($1, $2, $3)`,
    [ids.conv1, ORG, [uids.tutor, uids.parent]]
  );
  await tx.query(
    `insert into messages (id, organization_id, conversation_id, sender_id, receiver_id, body)
     values ($1, $2, $3, $4, $5, 'private note about fees')`,
    [ids.msg1, ORG, ids.conv1, uids.tutor, uids.parent]
  );
  await tx.query(
    `insert into leads (id, organization_id, name, status) values ($1, $2, 'Mrs. Sharma', 'new')`,
    [ids.lead1, ORG]
  );
  await tx.query(
    `insert into tutor_profiles (user_id, organization_id, full_name) values ($1, $2, 'Tutor T')`,
    [uids.tutor, ORG]
  );
  await tx.query(
    `insert into audit_events (id, organization_id, actor_id, action) values ($1, $2, $3, 'payment.record_manual')`,
    [ids.aud1, ORG, uids.admin]
  );
  await tx.query(
    `insert into parent_invites (token, organization_id, student_id, expires_at) values ('tok1', $1, $2, now() + interval '7 days')`,
    [ORG, ids.stu1]
  );
  await tx.query(
    `insert into student_invites (token, organization_id, student_id, expires_at) values ('stok1', $1, $2, now() + interval '7 days')`,
    [ORG, ids.stu1]
  );
  await tx.query(`insert into invoice_counters (organization_id, year, seq) values ($1, 2026, 1)`, [ORG]);
  await tx.query(`insert into payment_gateways (organization_id, key_id) values ($1, 'rzp_test')`, [ORG]);
  await tx.query(
    `insert into google_tokens (organization_id, user_id, access_token_enc) values ($1, $2, 'enc')`,
    [ORG, uids.tutor]
  );
}
