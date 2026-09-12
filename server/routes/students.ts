import express from "express";
import crypto from "node:crypto";
import multer from "multer";
import ExcelJS from "exceljs";
import Papa from "papaparse";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { withTransaction } from "../db.ts";
import { authenticateToken, requireOrg, requireRole, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";
import { setMembership, setActiveOrganization, hasMembership } from "./members.ts";
import {
  studentInviteRequestSchema, studentRedeemRequestSchema, eraseStudentRequestSchema,
  bulkImportMappingSchema, bulkImportResolutionsSchema,
  type ImportField, type BulkImportInspectResponse, type BulkImportPreviewResponse,
  type BulkImportCommitResponse, type BulkImportCandidate, type BulkImportDuplicate,
  type EraseStudentResponse,
} from "../../shared/schemas/students.ts";
import { suggestColumnMapping, parseImportRows, detectDuplicates, type ExistingStudent } from "../utils/bulkImport.ts";
import { eraseStudentTx, deleteErasedStorageObjects, getErasurePolicy, ErasureError } from "../utils/erasure.ts";
import { CONSENT_VERSION } from "../../shared/consent.ts";

const router = express.Router();
router.use(authenticateToken);

const STAFF_WHO_CAN_INVITE = ["owner", "admin", "frontdesk"];
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

// Tech Debt #16 (DEV_PLAN.md): a student had no way to join an org at all —
// role_type 'student' never triggered loadUser's bootstrap path, unlike
// tutor/admin. Mirrors the parent_invites pattern (Epic 10) exactly, except
// redeeming claims an existing `students` roster row (sets student_user_id)
// instead of creating a parent_links row.
router.post("/invites", async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: { code: "no_organization", message: "User does not belong to an organization" } });
    }
    if (!req.user!.role || !STAFF_WHO_CAN_INVITE.includes(req.user!.role)) {
      return res.status(403).json({ error: { code: "forbidden", message: "Insufficient role" } });
    }
    const { studentId } = studentInviteRequestSchema.parse(req.body);

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students").select("name, organization_id, student_user_id").eq("id", studentId).maybeSingle();
    if (studentErr) throw studentErr;
    if (!student || student.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Student not found" } });
    }
    if (student.student_user_id) {
      return res.status(409).json({ error: { code: "already_linked", message: "This student already has a portal account linked" } });
    }

    const token = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const { error: inviteErr } = await supabaseAdmin.from("student_invites").insert({
      token, organization_id: orgId, student_id: studentId, expires_at: expiresAt.toISOString(),
    });
    if (inviteErr) throw inviteErr;
    await writeAudit(orgId, req.user!.id, "student_invite.create", "students", studentId, { token: token.slice(0, 8) + "…" });

    res.status(201).json({ ok: true, token, expiresAt: expiresAt.toISOString(), studentName: student.name || null });
  } catch (err) { next(err); }
});

async function loadInvite(token: string) {
  const { data: invite, error } = await supabaseAdmin.from("student_invites").select("*").eq("token", token).maybeSingle();
  if (error) throw error;
  if (!invite) {
    throw Object.assign(new Error("Invite not found"), { status: 404, code: "not_found" });
  }
  if (invite.used_at) {
    throw Object.assign(new Error("Invite already used"), { status: 410, code: "invite_used" });
  }
  if (new Date(invite.expires_at).getTime() < Date.now()) {
    throw Object.assign(new Error("Invite expired"), { status: 410, code: "invite_expired" });
  }
  return invite;
}

// A signed-in user previews who/what they're about to link to before
// confirming. No client select policy exists on student_invites — this is
// the only read path.
router.get("/invites/:token/preview", async (req: AuthRequest, res, next) => {
  try {
    const invite = await loadInvite(req.params.token);

    const [{ data: student }, { data: org }] = await Promise.all([
      supabaseAdmin.from("students").select("name").eq("id", invite.student_id).maybeSingle(),
      supabaseAdmin.from("organizations").select("name").eq("id", invite.organization_id).maybeSingle(),
    ]);

    res.json({
      ok: true,
      studentName: student?.name || null,
      organizationName: org?.name || null,
    });
  } catch (err) { next(err); }
});

// Claims the students row (sets student_user_id — the only thing
// is_student_self() checks) and grants the student role + org membership.
// The claim + invite-burn happens in one Postgres transaction; membership
// then follows as a second write, same two-step posture as parents.ts redeem.
router.post("/redeem", async (req: AuthRequest, res, next) => {
  try {
    const body = studentRedeemRequestSchema.parse(req.body);
    const uid = req.user!.id;

    const invite = await loadInvite(body.token);

    // A student may hold more than one org membership (B-06b, Step 16). Block
    // only a real duplicate — redeeming an invite for an org they're already
    // a member of — not merely belonging to some other org too.
    if (await hasMembership(uid, invite.organization_id)) {
      return res.status(409).json({ error: { code: "org_conflict", message: "Account is already linked to this organization" } });
    }

    await withTransaction(async (client) => {
      const freshInvite = await client.query(`select used_at from student_invites where token = $1 for update`, [body.token]);
      if (freshInvite.rows[0]?.used_at) {
        throw Object.assign(new Error("Invite already used"), { status: 410, code: "invite_used" });
      }
      const claim = await client.query(
        `update students set student_user_id = $1 where id = $2 and student_user_id is null`,
        [uid, invite.student_id]
      );
      if (claim.rowCount === 0) {
        throw Object.assign(new Error("This student already has a portal account linked"), { status: 409, code: "already_linked" });
      }
      await client.query(
        `update student_invites set used_at = now(), used_by = $1 where token = $2`,
        [uid, body.token]
      );
      // B-11 (EXECUTION_PLAN.md Step 10): persist the DPDP consent record.
      // Claiming your own portal account is the consent event on the student
      // side, version-stamped so a center can show what was agreed and when.
      await client.query(
        `insert into consent_records (organization_id, user_id, student_id, role, consent_version)
         values ($1, $2, $3, 'student', $4)`,
        [invite.organization_id, uid, invite.student_id, CONSENT_VERSION]
      );
      // Sessions materialized before this redeem never had this student's
      // user id in their id-space array (resolveUserIds only sees it at
      // insert/materialize time, scheduling.ts) — backfill existing rows so
      // the student can see sessions booked before they had a portal account.
      await client.query(
        `update class_sessions
         set student_user_ids = array_append(student_user_ids, $1)
         where organization_id = $2 and $3 = any(student_ids) and not ($1 = any(student_user_ids))`,
        [uid, invite.organization_id, invite.student_id]
      );
    });

    await setMembership(invite.organization_id, uid, "student", uid);
    await setActiveOrganization(uid, invite.organization_id);
    await writeAudit(invite.organization_id, uid, "student_invite.redeem", "students", invite.student_id, {});

    res.json({ ok: true, organizationId: invite.organization_id, studentId: invite.student_id });
  } catch (err) { next(err); }
});

// B-09 bulk import (EXECUTION_PLAN.md Step 6). Same staff set as
// documents.ts's CAN_UPLOAD / billing.ts's CAN_MARK — anyone who can create
// a student one at a time via People.tsx can also bulk-import them.
const CAN_IMPORT = ["owner", "admin", "tutor", "frontdesk"] as const;
const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 5 * 1024 * 1024 } });

/** Parses an uploaded CSV or XLSX buffer into header + data rows. Format is
 *  sniffed from real content (zip magic bytes), never trusted from the
 *  client-declared filename/mimetype — same posture as documents.ts. */
async function parseSpreadsheet(buffer: Buffer): Promise<string[][]> {
  const isXlsx = buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
  if (isXlsx) {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);
    const sheet = workbook.worksheets[0];
    if (!sheet) return [];
    const rows: string[][] = [];
    sheet.eachRow({ includeEmpty: false }, (row) => {
      // exceljs 1-indexes row.values and always leaves index 0 empty.
      const values = (row.values as unknown[]).slice(1);
      rows.push(values.map((v) => (v === null || v === undefined ? "" : String(v))));
    });
    return rows;
  }
  const parsed = Papa.parse<string[]>(buffer.toString("utf-8"), { skipEmptyLines: true });
  return parsed.data;
}

function friendlyRowError(err: any): string {
  if (typeof err?.message === "string" && err.message.includes("plan_limit_exceeded")) {
    return "Your plan's active-student limit was reached — remaining rows were not created. Upgrade in Settings → Plan & Billing to add more.";
  }
  return err?.message || "Failed to create this row.";
}

// Column headers detected from the raw file plus a best-guess mapping, so
// the client can render the column-mapping UI without shipping its own
// CSV/XLSX parser (papaparse is a client dependency already, but only for
// Onboarding's simpler fixed-alias CSV path — exceljs's browser cost is too
// high for the bundle budget, so XLSX header detection stays server-side).
router.post("/import/inspect", requireOrg, requireRole(...CAN_IMPORT), importUpload.single("file"), async (req: AuthRequest, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: { code: "no_file", message: "No file uploaded" } });
    const rows = await parseSpreadsheet(req.file.buffer);
    if (rows.length === 0) {
      return res.status(422).json({ error: { code: "empty_file", message: "The file has no rows" } });
    }
    const [headerRow, ...dataRows] = rows;
    const body: BulkImportInspectResponse = {
      ok: true,
      headers: headerRow,
      sampleRows: dataRows.slice(0, 5),
      totalRows: dataRows.length,
      suggestedMapping: suggestColumnMapping(headerRow),
    };
    res.json(body);
  } catch (err) { next(err); }
});

// Single endpoint for both dry-run and commit (mirrors billing.ts's
// reason-enum-controls-behavior convention rather than splitting into two
// URLs): the client resubmits the same file + mapping with `commit: "true"`
// once staff have reviewed the dry-run preview and resolved every flagged
// duplicate. The server is stateless between calls — nothing about the
// upload is cached — so the full file goes over the wire each time; for a
// few-hundred-row roster this is negligible.
router.post("/import", requireOrg, requireRole(...CAN_IMPORT), importUpload.single("file"), async (req: AuthRequest, res, next) => {
  try {
    if (!req.file) return res.status(400).json({ error: { code: "no_file", message: "No file uploaded" } });
    const orgId = req.user!.organizationId!;

    let mappingRaw: unknown;
    let resolutionsRaw: unknown = {};
    try {
      mappingRaw = JSON.parse(req.body.mapping ?? "[]");
      if (req.body.resolutions) resolutionsRaw = JSON.parse(req.body.resolutions);
    } catch {
      return res.status(422).json({ error: { code: "validation", message: "mapping/resolutions must be valid JSON" } });
    }
    const mapping = bulkImportMappingSchema.parse(mappingRaw) as (ImportField | null)[];
    const resolutions = bulkImportResolutionsSchema.parse(resolutionsRaw);
    const commit = req.body.commit === "true";

    const rows = await parseSpreadsheet(req.file.buffer);
    if (rows.length === 0) {
      return res.status(422).json({ error: { code: "empty_file", message: "The file has no rows" } });
    }
    const [, ...dataRows] = rows;
    const { rows: parsedRows, errors } = parseImportRows(dataRows, mapping);

    // Dedup rule (server/utils/bulkImport.ts's header has the full log):
    // name AND phone must both match, either an existing active student or
    // an earlier row in this same file. Duplicates never write on a dry run
    // and never auto-commit — every one needs an explicit per-row
    // resolution, keyed by rowIndex, in the commit request.
    const { data: existingRaw, error: existingErr } = await supabaseAdmin
      .from("students").select("id, name, phone").eq("organization_id", orgId).eq("is_deleted", false);
    if (existingErr) throw existingErr;
    const existing: ExistingStudent[] = (existingRaw || []).map((s: any) => ({ id: s.id, name: s.name, phone: s.phone }));

    const duplicates: BulkImportDuplicate[] = detectDuplicates(parsedRows, existing);
    const duplicateRowIndexes = new Set(duplicates.map((d) => d.rowIndex));

    if (!commit) {
      const toCreate: BulkImportCandidate[] = parsedRows
        .filter((r) => !duplicateRowIndexes.has(r.rowIndex))
        .map((r) => ({
          rowIndex: r.rowIndex, name: r.record.name!, phone: r.record.phone,
          parentName: r.record.parentName, parentPhone: r.record.parentPhone,
          grade: r.record.grade, subject: r.record.subject,
        }));
      const body: BulkImportPreviewResponse = { ok: true, dryRun: true, totalRows: dataRows.length, toCreate, duplicates, errors };
      return res.json(body);
    }

    const created: BulkImportCommitResponse["created"] = [];
    const skippedDuplicates: BulkImportDuplicate[] = [];
    const commitErrors = [...errors];

    // Row-by-row, not a single batch insert: a bad or capped-out row must
    // report on itself, never fail the rest of the file (Step 6's DoD).
    for (const row of parsedRows) {
      if (duplicateRowIndexes.has(row.rowIndex)) {
        if (resolutions[String(row.rowIndex)] !== "import") {
          skippedDuplicates.push(duplicates.find((d) => d.rowIndex === row.rowIndex)!);
          continue;
        }
      }
      try {
        const { data: inserted, error: insertErr } = await supabaseAdmin.from("students").insert({
          organization_id: orgId,
          // Unconditional, matching People.tsx's StudentModal (the manual
          // add-one-student path): tutor_id is set to whoever created the
          // row regardless of their org role. Conditioning this on
          // req.user!.role === "tutor" (the org authorization role) left a
          // bulk-imported row with tutor_id null whenever an owner/admin ran
          // the import — invisible to that person's own People list, since
          // useStudentsList() scopes a tutor-*person* (role_type, a
          // different field entirely — see AuthContext.tsx) to only
          // students whose tutor_id is their own id. Found live: a real
          // import created 3 students that vanished from the demo owner's
          // own list until this was fixed.
          tutor_id: req.user!.id,
          status: "active",
          name: row.record.name,
          phone: row.record.phone ?? null,
          parent_name: row.record.parentName ?? null,
          parent_phone: row.record.parentPhone ?? null,
          grade: row.record.grade ?? null,
          subject: row.record.subject ?? null,
        }).select("id").single();
        if (insertErr) throw insertErr;
        created.push({ rowIndex: row.rowIndex, studentId: inserted.id, name: row.record.name! });
      } catch (err: any) {
        commitErrors.push({ rowIndex: row.rowIndex, message: friendlyRowError(err) });
      }
    }

    await writeAudit(orgId, req.user!.id, "students.bulk_import", "students", orgId, {
      createdCount: created.length, skippedDuplicateCount: skippedDuplicates.length, errorCount: commitErrors.length,
    });

    const body: BulkImportCommitResponse = { ok: true, dryRun: false, createdCount: created.length, created, skippedDuplicates, errors: commitErrors };
    res.json(body);
  } catch (err) { next(err); }
});

// B-11 / EXECUTION_PLAN.md Step 10: per-student erasure (DPDP right to
// erasure). Owner/admin only (founder decision 2026-09-05 — admins run
// day-to-day data requests and owner-only would bottleneck the statutory
// response window), type the student's exact current name to confirm
// (re-checked server-side, same posture as org offboarding). Irreversible.
//
// The table-by-table split (server/utils/erasure.ts): hard-delete the
// personal + academic rows, anonymize the students row into a stub, leave
// the financial trail (invoices/payments/wallets/wallet_ledger/attendance)
// untouched for 8-year retention. A leftover wallet balance is handled per
// the org's `settings.erasure.walletPolicy` — block (default) or writeoff.
const CAN_ERASE = ["owner", "admin"] as const;
router.post("/:studentId/erase", requireOrg, requireRole(...CAN_ERASE), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const studentId = req.params.studentId;
    const { confirmName } = eraseStudentRequestSchema.parse(req.body);

    const { data: student, error: studentErr } = await supabaseAdmin
      .from("students").select("name, organization_id, erased_at").eq("id", studentId).maybeSingle();
    if (studentErr) throw studentErr;
    if (!student || student.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Student not found" } });
    }
    if (student.erased_at) {
      return res.status(409).json({ error: { code: "already_erased", message: "This student has already been erased" } });
    }
    if (confirmName.trim() !== (student.name ?? "").trim()) {
      return res.status(422).json({ error: { code: "name_mismatch", message: "Typed name doesn't match the student's name" } });
    }

    const policy = await getErasurePolicy(orgId);

    let result;
    try {
      result = await withTransaction((client) =>
        eraseStudentTx(client, { orgId, studentId, actorId: req.user!.id, walletPolicy: policy.walletPolicy })
      );
    } catch (err) {
      if (err instanceof ErasureError) {
        return res.status(err.status).json({ error: { code: err.code, message: err.message } });
      }
      throw err;
    }

    // Storage is not transactional — delete the orphaned objects only after
    // the DB erasure has committed, best-effort.
    await deleteErasedStorageObjects(result.storagePaths);

    await writeAudit(orgId, req.user!.id, "student.erased", "students", studentId, {
      studentName: student.name,
      walletPolicy: policy.walletPolicy,
      walletWriteOff: result.walletWriteOff,
      deleted: result.deleted,
      storageObjectsDeleted: result.storagePaths.length,
      consentVersion: CONSENT_VERSION,
    });

    const body: EraseStudentResponse = { ok: true, walletWriteOff: result.walletWriteOff, deleted: result.deleted };
    res.json(body);
  } catch (err) { next(err); }
});

export default router;
