// B-11 / EXECUTION_PLAN.md Step 10: per-student erasure (DPDP right to
// erasure), reconciled against India's 8-year financial-record retention
// (GO_TO_MARKET_BLUEPRINT.md §8.2, HANDOFF.md §5).
//
// Founder-confirmed model (2026-09-05): WIPE the personal + academic data,
// KEEP the money trail as anonymized rows.
//
//   HARD DELETE   student_notes, assessments, enrollments, parent_links,
//                 session_requests, parent_invites, student_invites,
//                 documents (rows + the underlying Storage objects)
//   ANONYMIZE     the students row itself — every identifying column nulled,
//                 name -> "Erased student", student_user_id detached,
//                 is_deleted = true, erased_at / erased_by stamped. The row
//                 stays so the financial foreign keys still resolve.
//   UNTOUCHED     invoices, payments, refunds, wallets, wallet_ledger,
//                 attendance_records — they carry no PII of their own once
//                 the students row is scrubbed, and they're inside the
//                 retention window. Wallet balance is handled per the org's
//                 erasure policy (block vs writeoff) BEFORE this runs.
//   SCRUBBED      the detached user ids are array_remove'd from any *future*
//                 scheduled class_sessions so a lingering portal login can't
//                 still see upcoming classes; past sessions' rosters are left
//                 as the historical record.
//
// The anonymized stub keeps B-03's `balance == ledger sum` invariant intact:
// nothing on wallets / wallet_ledger changes here (the optional writeoff is a
// balanced pair — a negative ledger row plus the matching balance decrement).
import type { PoolClient } from "pg";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { rupeesToPaise, paiseToRupees } from "../../shared/money.ts";
import {
  resolveErasurePolicy,
  DEFAULT_ERASURE_POLICY,
  type ErasurePolicy,
  type ErasureWalletPolicy,
} from "../../shared/erasure.ts";

export { resolveErasurePolicy, DEFAULT_ERASURE_POLICY };
export type { ErasurePolicy, ErasureWalletPolicy };

/** Reads an org's erasure policy, defaulting to "block". */
export async function getErasurePolicy(orgId: string): Promise<ErasurePolicy> {
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("settings")
    .eq("id", orgId)
    .maybeSingle();
  if (error) throw error;
  return resolveErasurePolicy((data?.settings as Record<string, unknown> | undefined)?.erasure);
}

// Every identifying / free-text column on `students`. Kept explicit rather
// than "everything except a keep-list" so a column added later is wiped only
// after someone has looked at it — a new PII column silently surviving
// erasure is the worse failure.
const STUDENT_PII_COLUMNS = [
  "notes",
  "phone",
  "email",
  "address",
  "parent_name",
  "parent_phone",
  "parent_email",
  "emergency_contact_name",
  "emergency_contact_phone",
  "student_phone",
  "student_email",
  "age",
  "gender",
  "school_name",
  "board",
  "grade",
  "subject",
  "areas_of_difficulty",
  "learning_goals",
  "fee_structure",
] as const;

export interface EraseStudentResult {
  walletWriteOff: { credits: number; paise: number } | null;
  deleted: {
    studentNotes: number;
    assessments: number;
    enrollments: number;
    parentLinks: number;
    sessionRequests: number;
    documents: number;
    invites: number;
  };
  /** Storage object paths the caller must delete after the tx commits. */
  storagePaths: string[];
}

export class ErasureError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

/**
 * Runs the whole erasure inside the caller's transaction. Throws
 * ErasureError (mapped to an HTTP status by the route) for the two guard
 * failures: already erased, or a non-zero wallet under a "block" policy.
 *
 * The student row must already be locked FOR UPDATE by the caller.
 */
export async function eraseStudentTx(
  client: PoolClient,
  opts: { orgId: string; studentId: string; actorId: string; walletPolicy: ErasureWalletPolicy }
): Promise<EraseStudentResult> {
  const { orgId, studentId, actorId, walletPolicy } = opts;

  const studentRes = await client.query(
    `select id, name, student_user_id, erased_at from students
     where id = $1 and organization_id = $2 for update`,
    [studentId, orgId]
  );
  const student = studentRes.rows[0];
  if (!student) throw new ErasureError(404, "not_found", "Student not found");
  if (student.erased_at) throw new ErasureError(409, "already_erased", "This student has already been erased");

  // ---- wallet balance: block or write off --------------------------------
  const walletRes = await client.query(
    `select id, balance_credits, balance_currency from wallets
     where organization_id = $1 and student_id = $2`,
    [orgId, studentId]
  );
  const wallet = walletRes.rows[0];
  let walletWriteOff: { credits: number; paise: number } | null = null;

  if (wallet) {
    const credits = Number(wallet.balance_credits) || 0;
    const paise = rupeesToPaise(Number(wallet.balance_currency) || 0);
    if (credits !== 0 || paise !== 0) {
      if (walletPolicy === "block") {
        throw new ErasureError(
          409,
          "wallet_balance_outstanding",
          "This student still has an unused wallet balance. Refund or adjust it to zero before erasing, or switch the center's erasure policy to write-off."
        );
      }
      // writeoff: one balanced pair — a negative ledger row plus the matching
      // wallet decrement, so sum(ledger) still equals the (now zero) balance.
      const key = `erasure_writeoff_${studentId}`;
      const dup = await client.query(
        `select 1 from wallet_ledger where organization_id = $1 and idempotency_key = $2`,
        [orgId, key]
      );
      if ((dup.rowCount ?? 0) === 0) {
        // New `type` literal, same as Step 2's credit_reversal / Step 9's
        // credit_expiry — wallet_ledger.type has no CHECK constraint.
        await client.query(
          `insert into wallet_ledger
             (organization_id, student_id, type, credits, paise, reason, by, idempotency_key, at)
           values ($1, $2, 'erasure_writeoff', $3, $4, 'erasure_writeoff', $5, $6, now())`,
          [orgId, studentId, -credits, -paise, actorId, key]
        );
        await client.query(
          `update wallets set balance_credits = 0, balance_currency = 0 where id = $1`,
          [wallet.id]
        );
      }
      walletWriteOff = { credits, paise };
    }
  }

  // ---- hard-delete the non-financial rows --------------------------------
  const docRows = await client.query(
    `select storage_path from documents where organization_id = $1 and student_id = $2 and storage_path is not null`,
    [orgId, studentId]
  );
  const storagePaths: string[] = docRows.rows.map((r) => r.storage_path);

  const del = async (sql: string) => (await client.query(sql, [orgId, studentId])).rowCount ?? 0;
  const studentNotes = await del(`delete from student_notes where organization_id = $1 and student_id = $2`);
  const assessments = await del(`delete from assessments where organization_id = $1 and student_id = $2`);
  const enrollments = await del(`delete from enrollments where organization_id = $1 and student_id = $2`);
  const parentLinks = await del(`delete from parent_links where organization_id = $1 and student_id = $2`);
  const sessionRequests = await del(`delete from session_requests where organization_id = $1 and student_id = $2`);
  const documents = await del(`delete from documents where organization_id = $1 and student_id = $2`);
  const invites =
    (await del(`delete from parent_invites where organization_id = $1 and student_id = $2`)) +
    (await del(`delete from student_invites where organization_id = $1 and student_id = $2`));

  // The consent fact is kept (it's about the user, and it's a compliance
  // artifact); its link to this student is not.
  await client.query(
    `update consent_records set student_id = null where organization_id = $1 and student_id = $2`,
    [orgId, studentId]
  );

  // ---- detach the erased student's own portal login from future sessions --
  // Only `students.student_user_id` — that uid belongs to this one student, so
  // pulling it from an upcoming roster is unambiguous. `parent_user_ids` is
  // left alone on purpose: a parent can be linked to a sibling in the same
  // batch session, and deleting parent_links above has already dropped this
  // parent's is_parent_of() access to the erased student.
  if (student.student_user_id) {
    await client.query(
      `update class_sessions
         set student_user_ids = (
               select coalesce(array_agg(u), '{}'::uuid[])
               from unnest(student_user_ids) u
               where u <> $3
             )
       where organization_id = $1
         and start_time > now()
         and status = 'scheduled'
         and ($2 = any(student_ids))
         and ($3 = any(student_user_ids))`,
      [orgId, studentId, student.student_user_id]
    );
  }

  // ---- anonymize the students row --------------------------------------
  const setClause = STUDENT_PII_COLUMNS.map((c) => `${c} = null`).join(",\n       ");
  await client.query(
    `update students set
       name = 'Erased student',
       student_user_id = null,
       is_deleted = true,
       status = 'inactive',
       erased_at = now(),
       erased_by = $2,
       updated_at = now(),
       ${setClause}
     where id = $1`,
    [studentId, actorId]
  );

  return {
    walletWriteOff,
    deleted: { studentNotes, assessments, enrollments, parentLinks, sessionRequests, documents, invites },
    storagePaths,
  };
}

/** Best-effort deletion of the Storage objects an erasure orphaned. Runs
 *  after the DB transaction commits — Storage is not transactional, and a
 *  failed object delete must not roll back a completed erasure. */
export async function deleteErasedStorageObjects(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  try {
    const { error } = await supabaseAdmin.storage.from("documents").remove(paths);
    if (error) console.error("Erasure: failed to delete Storage objects", error);
  } catch (err) {
    console.error("Erasure: failed to delete Storage objects", err);
  }
}

// paiseToRupees is imported for symmetry with the rest of the money code and
// may be used by callers formatting the writeoff result.
export { paiseToRupees };
