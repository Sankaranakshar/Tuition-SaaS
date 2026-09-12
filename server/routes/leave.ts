import express from "express";
import { pool, withTransaction } from "../db.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { authenticateToken, requireOrg, requireRole, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";
import { isValidLeaveRange, leaveDateRangeToTimestampBounds } from "../../shared/leave.ts";
import { reassignSessionTutorTx } from "./scheduling.ts";
import {
  createLeaveRequestSchema,
  decideLeaveRequestSchema,
  reassignSubstituteRequestSchema,
  type LeaveRequestRow,
  type AffectedSessionRow,
  type ReassignResult,
} from "../../shared/schemas/leave.ts";

// B-13 (MASTER_PLAN.md §3 R2 / EXECUTION_PLAN.md Step 23): substitute and
// leave management. A tutor (or staff, on their behalf) logs a leave date
// range; owner/admin approve or reject it; staff then find the sessions it
// affects and reassign a substitute tutor to them, one session at a time via
// scheduling.ts's reassignSessionTutorTx (same conflict-checked primitive a
// one-off substitute swap uses directly through PATCH /scheduling/sessions/:id/tutor).
const router = express.Router();
router.use(authenticateToken, requireOrg);

// Same set scheduling.ts's CAN_SCHEDULE uses -- leave/substitute management
// is a scheduling operation, not a payroll one (contrast payouts.ts's
// narrower owner/admin/accountant CAN_PAYOUT).
const CAN_SCHEDULE = ["owner", "admin", "tutor", "frontdesk"] as const;

async function assertOrgMember(orgId: string, userId: string, notFoundMessage: string) {
  const { data } = await supabaseAdmin
    .from("organization_members").select("user_id")
    .eq("organization_id", orgId).eq("user_id", userId).maybeSingle();
  if (!data) {
    throw Object.assign(new Error(notFoundMessage), { status: 404, code: "not_found" });
  }
}

interface LeaveRow {
  id: string;
  organization_id: string;
  tutor_id: string;
  start_date: string;
  end_date: string;
  status: string;
}

async function loadLeave(orgId: string, leaveId: string): Promise<LeaveRow> {
  const res = await pool.query(
    // Cast the two date columns to text -- node-postgres's default type
    // parser turns a `date` column into a local-midnight JS Date object, not
    // the "YYYY-MM-DD" string every caller here (leaveDateRangeToTimestampBounds,
    // the reassign/affected-sessions routes) expects.
    `select id, organization_id, tutor_id, start_date::text, end_date::text, status from tutor_leave_requests where id = $1`,
    [leaveId]
  );
  if (res.rowCount === 0 || res.rows[0].organization_id !== orgId) {
    throw Object.assign(new Error("Leave request not found"), { status: 404, code: "not_found" });
  }
  return res.rows[0];
}

// Any org member can request their own leave; staff can request on behalf of
// another member (e.g. a tutor who called in sick without opening the app).
// tutorId is deliberately not restricted to role 'tutor' -- an
// independent tutor's own org-of-one membership is 'owner' (D-01), and they
// still deliver sessions as class_sessions.tutor_id themselves.
router.post("/", requireRole(...CAN_SCHEDULE), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const body = createLeaveRequestSchema.parse(req.body);
    const tutorId = body.tutorId ?? req.user!.id;

    if (tutorId !== req.user!.id && req.user!.role !== "owner" && req.user!.role !== "admin") {
      return res.status(403).json({ error: { code: "forbidden", message: "Only owner/admin can log leave on someone else's behalf" } });
    }
    if (!isValidLeaveRange(body.startDate, body.endDate)) {
      return res.status(422).json({ error: { code: "invalid_range", message: "endDate must be on or after startDate" } });
    }
    await assertOrgMember(orgId, tutorId, "Not a member of this organization");

    const insertRes = await pool.query(
      `insert into tutor_leave_requests (organization_id, tutor_id, start_date, end_date, reason, requested_by)
       values ($1, $2, $3, $4, $5, $6)
       returning id`,
      [orgId, tutorId, body.startDate, body.endDate, body.reason ?? null, req.user!.id]
    );
    const id = insertRes.rows[0].id as string;

    await writeAudit(orgId, req.user!.id, "leave.request", "tutor_leave_requests", id, { tutorId, startDate: body.startDate, endDate: body.endDate });
    res.json({ ok: true, id });
  } catch (err) { next(err); }
});

// A tutor sees only their own leave; every other CAN_SCHEDULE role sees the
// whole org's -- same "self vs staff" split Today.tsx/payouts.ts use,
// keyed off req.user.role so an independent tutor (whose own role is
// 'owner', D-01) correctly sees everyone's (there is only their own anyway).
router.get("/", requireRole(...CAN_SCHEDULE), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const status = typeof req.query.status === "string" ? req.query.status : null;
    const selfOnly = req.user!.role === "tutor";

    const conditions = ["organization_id = $1"];
    const params: unknown[] = [orgId];
    if (selfOnly) {
      params.push(req.user!.id);
      conditions.push(`tutor_id = $${params.length}`);
    }
    if (status) {
      params.push(status);
      conditions.push(`status = $${params.length}`);
    }

    const result = await pool.query(
      `select id, tutor_id, start_date::text, end_date::text, reason, status, requested_by, decided_by, decided_at, created_at
       from tutor_leave_requests where ${conditions.join(" and ")} order by start_date desc`,
      params
    );
    const requests: LeaveRequestRow[] = result.rows.map((r) => ({
      id: r.id, tutorId: r.tutor_id, startDate: r.start_date, endDate: r.end_date, reason: r.reason,
      status: r.status, requestedBy: r.requested_by, decidedBy: r.decided_by, decidedAt: r.decided_at, createdAt: r.created_at,
    }));
    res.json({ ok: true, requests });
  } catch (err) { next(err); }
});

router.patch("/:id", requireRole(...CAN_SCHEDULE), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const leaveId = req.params.id;
    const body = decideLeaveRequestSchema.parse(req.body);
    const leave = await loadLeave(orgId, leaveId);

    const isAdmin = req.user!.role === "owner" || req.user!.role === "admin";
    if ((body.action === "approve" || body.action === "reject") && !isAdmin) {
      return res.status(403).json({ error: { code: "forbidden", message: "Only owner/admin can approve or reject leave" } });
    }
    if (body.action === "cancel" && req.user!.id !== leave.tutor_id && !isAdmin) {
      return res.status(403).json({ error: { code: "forbidden", message: "Only the requesting tutor or owner/admin can cancel a leave request" } });
    }
    if (leave.status !== "pending") {
      return res.status(409).json({ error: { code: "not_pending", message: `Leave request is already ${leave.status}` } });
    }

    const newStatus = body.action === "approve" ? "approved" : body.action === "reject" ? "rejected" : "cancelled";
    await pool.query(
      `update tutor_leave_requests set status = $1, decided_by = $2, decided_at = now() where id = $3`,
      [newStatus, req.user!.id, leaveId]
    );

    await writeAudit(orgId, req.user!.id, `leave.${body.action}`, "tutor_leave_requests", leaveId, { tutorId: leave.tutor_id });
    res.json({ ok: true, status: newStatus });
  } catch (err) { next(err); }
});

router.get("/:id/affected-sessions", requireRole(...CAN_SCHEDULE), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const leave = await loadLeave(orgId, req.params.id);
    const bounds = leaveDateRangeToTimestampBounds(leave.start_date, leave.end_date);

    const result = await pool.query(
      `select id, start_time, end_time, student_ids from class_sessions
       where tutor_id = $1 and status = 'scheduled'
         and start_time < $3::timestamptz and end_time > $2::timestamptz
       order by start_time`,
      [leave.tutor_id, bounds.start, bounds.end]
    );
    const sessions: AffectedSessionRow[] = result.rows.map((r) => ({
      id: r.id, startTime: r.start_time, endTime: r.end_time, studentIds: r.student_ids ?? [],
    }));
    res.json({ ok: true, sessions });
  } catch (err) { next(err); }
});

// Bulk-reassigns the leave's affected sessions (or a caller-chosen subset of
// them) to one substitute tutor. Each session is reassigned in its own
// transaction via reassignSessionTutorTx, so one session's conflict (the
// substitute is already booked elsewhere at that time) fails just that row
// instead of rolling back every other successful reassignment in the batch
// -- same "return conflicts to the caller, never swallow them" posture
// materializeTemplate already uses for template-wide session generation.
router.post("/:id/reassign", requireRole(...CAN_SCHEDULE), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const leaveId = req.params.id;
    const body = reassignSubstituteRequestSchema.parse(req.body);
    const leave = await loadLeave(orgId, leaveId);

    if (leave.status !== "approved") {
      return res.status(409).json({ error: { code: "not_approved", message: "Leave must be approved before assigning a substitute" } });
    }
    if (body.substituteTutorId === leave.tutor_id) {
      return res.status(422).json({ error: { code: "same_tutor", message: "Substitute cannot be the tutor who is on leave" } });
    }
    await assertOrgMember(orgId, body.substituteTutorId, "Substitute is not a member of this organization");

    let sessionIds = body.sessionIds;
    if (!sessionIds) {
      const bounds = leaveDateRangeToTimestampBounds(leave.start_date, leave.end_date);
      const affected = await pool.query(
        `select id from class_sessions where tutor_id = $1 and status = 'scheduled'
           and start_time < $3::timestamptz and end_time > $2::timestamptz`,
        [leave.tutor_id, bounds.start, bounds.end]
      );
      sessionIds = affected.rows.map((r) => r.id as string);
    }

    const results: ReassignResult[] = [];
    for (const sessionId of sessionIds) {
      try {
        const { oldTutorId } = await withTransaction(async (client) => {
          const sRes = await client.query(
            `select tutor_id from class_sessions where id = $1 and organization_id = $2`,
            [sessionId, orgId]
          );
          if (sRes.rowCount === 0) {
            throw Object.assign(new Error("Session not found"), { status: 404, code: "not_found" });
          }
          if (sRes.rows[0].tutor_id !== leave.tutor_id) {
            throw Object.assign(new Error("Session does not belong to the tutor on leave"), { status: 409, code: "not_leave_tutor" });
          }
          return reassignSessionTutorTx(client, orgId, sessionId, body.substituteTutorId);
        });
        await writeAudit(orgId, req.user!.id, "session.reassign_tutor", "class_sessions", sessionId, {
          fromTutorId: oldTutorId, toTutorId: body.substituteTutorId, leaveRequestId: leaveId,
        });
        results.push({ sessionId, ok: true });
      } catch (err: any) {
        results.push({ sessionId, ok: false, error: err.code ?? err.message });
      }
    }

    await writeAudit(orgId, req.user!.id, "leave.substitute_assigned", "tutor_leave_requests", leaveId, {
      substituteTutorId: body.substituteTutorId,
      reassigned: results.filter((r) => r.ok).length,
      failed: results.filter((r) => !r.ok).length,
    });
    res.json({ ok: true, results });
  } catch (err) { next(err); }
});

export default router;
