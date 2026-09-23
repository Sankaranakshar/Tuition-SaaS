import type { Pool, PoolClient } from "pg";

type Queryable = Pick<Pool | PoolClient, "query">;

export interface Recipient {
  recipientUserId: string | null;
  recipientPhone: string;
}

// Every student-anchored template (invoice raised, fee reminder, payment
// received, session reminder, absence alert) needs "who do we tell about
// this child" -- centralized here rather than re-derived per producer.
// Prefers linked guardian accounts (parent_links -> profiles.phone, one
// message per linked parent, same "every guardian sees it" posture D-06
// already established for tutor-student threads); falls back to
// students.parent_phone only when no parent has redeemed an invite yet, so a
// family isn't unreachable for the entire pre-signup window.
export async function resolveStudentGuardianRecipients(db: Queryable, studentId: string): Promise<Recipient[]> {
  const linkedRes = await db.query(
    `select pl.parent_user_id, p.phone
     from parent_links pl
     join profiles p on p.id = pl.parent_user_id
     where pl.student_id = $1`,
    [studentId]
  );
  const linked: Recipient[] = linkedRes.rows
    .filter((r: { phone: string | null }) => !!r.phone)
    .map((r: { parent_user_id: string; phone: string }) => ({ recipientUserId: r.parent_user_id, recipientPhone: r.phone }));
  if (linked.length > 0) return linked;

  const studentRes = await db.query(`select parent_phone from students where id = $1`, [studentId]);
  const parentPhone = studentRes.rows[0]?.parent_phone as string | null | undefined;
  return parentPhone ? [{ recipientUserId: null, recipientPhone: parentPhone }] : [];
}
