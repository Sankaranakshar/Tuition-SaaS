import express from "express";
import ExcelJS from "exceljs";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";
import { fetchOrgExportData } from "../utils/orgExport.ts";
import { offboardRequestSchema, type OffboardResponse } from "../../shared/schemas/orgExport.ts";

// Stage 3: org export/offboarding (DEV_PLAN §5, old E16.3). Export is
// owner/admin (matches subscription.ts's viewing tier); offboarding is
// owner-only, since it's the closest thing this app has to an irreversible
// action on an org. See server/utils/orgExport.ts's header for exactly what
// tables are covered, and 20260719130000_org_offboarding.sql's header for
// why "deletion" here is a status flip, never a row delete.
const router = express.Router();
router.use(authenticateToken, requireOrg);

router.get("/json", requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const tables = await fetchOrgExportData(orgId);
    const payload: Record<string, unknown> = { exportedAt: new Date().toISOString() };
    for (const t of tables) payload[t.key] = t.rows;

    await writeAudit(orgId, req.user!.id, "org.export_json", "organizations", orgId, {});
    res.setHeader("Content-Type", "application/json");
    res.setHeader("Content-Disposition", `attachment; filename="org-export-${orgId}.json"`);
    res.send(JSON.stringify(payload, null, 2));
  } catch (err) { next(err); }
});

router.get("/xlsx", requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const tables = await fetchOrgExportData(orgId);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "ClassStackr";
    workbook.created = new Date();

    for (const t of tables) {
      // Excel sheet names cap at 31 chars and can't contain some punctuation;
      // our table keys are already short snake_case identifiers so this is
      // just a defensive truncate, not expected to trigger in practice.
      const sheet = workbook.addWorksheet(t.key.slice(0, 31));
      const columns = t.rows.length > 0 ? Object.keys(t.rows[0]) : [];
      sheet.columns = columns.map((c) => ({ header: c, key: c, width: 20 }));
      for (const row of t.rows) {
        // jsonb/array columns need stringifying — Excel cells are scalars.
        const flat: Record<string, unknown> = {};
        for (const c of columns) {
          const v = (row as Record<string, unknown>)[c];
          flat[c] = v !== null && typeof v === "object" ? JSON.stringify(v) : v;
        }
        sheet.addRow(flat);
      }
    }

    const buffer = await workbook.xlsx.writeBuffer();
    await writeAudit(orgId, req.user!.id, "org.export_xlsx", "organizations", orgId, {});
    res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    res.setHeader("Content-Disposition", `attachment; filename="org-export-${orgId}.xlsx"`);
    res.send(Buffer.from(buffer));
  } catch (err) { next(err); }
});

// Owner-only: marks the org offboarded (status flip, never a row delete —
// see the migration's header). Requires typing the org's exact current name
// to confirm, re-checked server-side (the client check is UX only, not the
// security boundary — same posture as every other confirm-to-destroy flow
// in this codebase).
router.post("/offboard", requireRole("owner"), async (req: AuthRequest, res, next) => {
  try {
    const { confirmOrgName } = offboardRequestSchema.parse(req.body);
    const orgId = req.user!.organizationId!;

    const { data: org, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .select("name, status")
      .eq("id", orgId)
      .single();
    if (orgErr) throw orgErr;
    if (org.status === "offboarded") {
      return res.status(409).json({ error: { code: "already_offboarded", message: "This organization is already offboarded" } });
    }
    if (confirmOrgName.trim() !== org.name.trim()) {
      return res.status(422).json({ error: { code: "name_mismatch", message: "Typed name doesn't match the organization's name" } });
    }

    const { error } = await supabaseAdmin
      .from("organizations")
      .update({ status: "offboarded", offboarded_at: new Date().toISOString(), offboarded_by: req.user!.id })
      .eq("id", orgId);
    if (error) throw error;

    await writeAudit(orgId, req.user!.id, "org.offboarded", "organizations", orgId, {});
    const body: OffboardResponse = { ok: true };
    res.json(body);
  } catch (err) { next(err); }
});

export default router;
