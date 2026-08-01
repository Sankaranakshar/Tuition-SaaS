import { pool } from "../db.ts";

// Tables covered by the org export (DEV_PLAN §5, old E16.3): the org's core
// business data — people, academics, and money. Deliberately excludes
// internal/system tables that aren't meaningful to hand back to an org:
// audit_events/billing_events/platform_admin_actions (internal logs),
// notifications (ephemeral), conversations/messages (a future export
// candidate, held back for this first pass to keep scope tractable),
// documents (storage-file metadata without the underlying files is not
// useful on its own), google_tokens/feature_flags (internal config, not
// the org's data). One entry here = one sheet in the XLSX and one array key
// in the JSON.
const EXPORT_TABLES: Array<{ key: string; query: string }> = [
  { key: "organization", query: "select id, name, address, phone, email, created_at from organizations where id = $1" },
  {
    key: "members",
    query: `select om.user_id, om.role, om.created_at, p.name, p.email
            from organization_members om left join profiles p on p.id = om.user_id
            where om.organization_id = $1`,
  },
  { key: "students", query: "select * from students where organization_id = $1 order by created_at" },
  { key: "courses", query: "select * from courses where organization_id = $1 order by created_at" },
  { key: "class_sessions", query: "select * from class_sessions where organization_id = $1 order by start_time" },
  { key: "enrollments", query: "select * from enrollments where organization_id = $1 order by created_at" },
  { key: "attendance_records", query: "select * from attendance_records where organization_id = $1 order by session_start" },
  { key: "invoices", query: "select * from invoices where organization_id = $1 order by created_at" },
  { key: "payments", query: "select * from payments where organization_id = $1 order by at" },
  { key: "refunds", query: "select * from refunds where organization_id = $1 order by at" },
  { key: "wallets", query: "select * from wallets where organization_id = $1" },
  { key: "wallet_ledger", query: "select * from wallet_ledger where organization_id = $1 order by at" },
  { key: "parent_links", query: "select * from parent_links where organization_id = $1" },
  { key: "leads", query: "select * from leads where organization_id = $1 order by created_at" },
  { key: "subscriptions", query: "select plan, status, student_limit, price_paise, trial_ends_at, current_period_end, updated_at from subscriptions where organization_id = $1" },
];

export interface OrgExportTable {
  key: string;
  rows: Record<string, unknown>[];
}

/** Fetches every export table for one org. Each table is independently
 *  org-scoped by `organization_id = $1` (or `id = $1` for the organizations
 *  row itself), so this is safe to call with any orgId — callers are
 *  responsible for authorizing that the caller may see that org's data. */
export async function fetchOrgExportData(orgId: string): Promise<OrgExportTable[]> {
  // The 15 table queries are independent, so they go out together rather than
  // paying a full round trip each in series. The pool (PG_POOL_MAX, default 3)
  // caps real concurrency; this just keeps those connections busy instead of
  // idle between statements. Order is preserved by Promise.all, so the sheet
  // and JSON-key order stays exactly as EXPORT_TABLES declares it.
  return Promise.all(
    EXPORT_TABLES.map(async (table) => {
      const { rows } = await pool.query(table.query, [orgId]);
      return { key: table.key, rows };
    })
  );
}
