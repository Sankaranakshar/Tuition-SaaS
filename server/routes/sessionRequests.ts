import express from "express";
import { pool, withTransaction } from "../db.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";
import { createEnrollmentTx, createSessionTx } from "./scheduling.ts";
import { getPaymentPermissions } from "../utils/paymentPermissions.ts";
import {
  createBookingRequestSchema,
  declineBookingRequestSchema,
  proposeAlternativeSchema,
  respondToProposalSchema,
} from "../../shared/schemas/bookingRequests.ts";

// Booking-request approval (EXECUTION_PLAN.md Step 5, carried from spec v2
// Tutor tab, MASTER_PLAN.md §3). Reads/writes the session_requests table
// fleshed out by supabase/migrations/20260905120000_booking_requests.sql.
// Table row: any authenticated org member (staff entering a phone inquiry,
// or a parent/student self-serving) submits a request. Its target is
// exactly one of two shapes — join an existing recurring class
// (templateId) or book a one-on-one with a tutor at a specific time
// (tutorId + requestedStartTime/EndTime) — matching the DB's XOR check.
const router = express.Router();
router.use(authenticateToken, requireOrg);

const CAN_RESPOND = ["owner", "admin", "tutor", "frontdesk"] as const;

router.get("/", requireRole(...CAN_RESPOND), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const status = typeof req.query.status === "string" ? req.query.status : null;

    const result = await pool.query(
      `select
         sr.id, sr.status, sr.notes, sr.response_note, sr.created_at, sr.responded_at,
         sr.student_id, sr.template_id, sr.tutor_id, sr.requested_start_time, sr.requested_end_time,
         sr.proposed_template_id, sr.proposed_start_time, sr.proposed_end_time,
         sr.requested_by_user_id, sr.requires_parent_approval,
         s.name as student_name,
         ct.name as template_name,
         tp.name as tutor_name,
         pt.name as proposed_template_name,
         rp.name as requested_by_name
       from session_requests sr
       join students s on s.id = sr.student_id
       left join class_templates ct on ct.id = sr.template_id
       left join profiles tp on tp.id = sr.tutor_id
       left join class_templates pt on pt.id = sr.proposed_template_id
       left join profiles rp on rp.id = sr.requested_by_user_id
       where sr.organization_id = $1
         and ($2::text is null or sr.status = $2)
       order by sr.created_at desc
       limit 100`,
      [orgId, status]
    );
    res.json({ ok: true, requests: result.rows });
  } catch (err) { next(err); }
});

router.post("/", async (req: AuthRequest, res, next) => {
  try {
    const body = createBookingRequestSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const uid = req.user!.id;

    if ("templateId" in body) {
      const templateRes = await pool.query(`select organization_id from class_templates where id = $1`, [body.templateId]);
      if (templateRes.rowCount === 0 || templateRes.rows[0].organization_id !== orgId) {
        return res.status(404).json({ error: { code: "not_found", message: "Class template not found" } });
      }
    } else {
      if (new Date(body.requestedEndTime).getTime() <= new Date(body.requestedStartTime).getTime()) {
        return res.status(422).json({ error: { code: "invalid_range", message: "End time must be after start time" } });
      }
      const tutorRes = await pool.query(
        `select 1 from organization_members where organization_id = $1 and user_id = $2 and role = 'tutor'`,
        [orgId, body.tutorId]
      );
      if (tutorRes.rowCount === 0) {
        return res.status(404).json({ error: { code: "not_found", message: "Tutor not found in this organization" } });
      }
    }

    // D-05 (EXECUTION_PLAN.md Step 19): this route has no requireRole gate —
    // a student-role account can submit its own request with no parent
    // involved. Gate it here: closed by default, per the student's own
    // student_payment_permissions row (no row = no self-pay).
    const requiresParentApproval =
      req.user!.role === "student" ? !(await getPaymentPermissions(body.studentId)).selfPayAllowed : false;

    const insertRes = await pool.query(
      "templateId" in body
        ? `insert into session_requests (organization_id, requested_by_user_id, student_id, template_id, notes, requires_parent_approval)
           values ($1, $2, $3, $4, $5, $6) returning id`
        : `insert into session_requests (organization_id, requested_by_user_id, student_id, tutor_id, requested_start_time, requested_end_time, notes, requires_parent_approval)
           values ($1, $2, $3, $4, $5, $6, $7, $8) returning id`,
      "templateId" in body
        ? [orgId, uid, body.studentId, body.templateId, body.notes ?? null, requiresParentApproval]
        : [orgId, uid, body.studentId, body.tutorId, body.requestedStartTime, body.requestedEndTime, body.notes ?? null, requiresParentApproval]
    );
    const requestId = insertRes.rows[0].id as string;

    await writeAudit(orgId, uid, "booking_request.create", "session_requests", requestId, { studentId: body.studentId, requiresParentApproval });
    res.status(201).json({ ok: true, requestId, requiresParentApproval });
  } catch (err) { next(err); }
});

async function loadRequestForUpdate(client: import("pg").PoolClient, orgId: string, requestId: string) {
  const res = await client.query(`select * from session_requests where id = $1 for update`, [requestId]);
  if (res.rowCount === 0) {
    throw Object.assign(new Error("Booking request not found"), { status: 404, code: "not_found" });
  }
  const row = res.rows[0];
  if (row.organization_id !== orgId) {
    throw Object.assign(new Error("Request belongs to another organization"), { status: 403, code: "forbidden" });
  }
  return row;
}

router.post("/:id/accept", requireRole(...CAN_RESPOND), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const uid = req.user!.id;
    const requestId = req.params.id;

    await withTransaction(async (client) => {
      const row = await loadRequestForUpdate(client, orgId, requestId);
      if (row.status !== "pending") {
        throw Object.assign(new Error(`Request is already ${row.status}`), { status: 409, code: "invalid_status" });
      }
      // D-05 (EXECUTION_PLAN.md Step 19): a student-self request with no
      // self-pay permission can't be accepted until a parent clears it via
      // POST /:id/parent-approve.
      if (row.requires_parent_approval) {
        throw Object.assign(new Error("Awaiting parent approval before this request can be accepted"), { status: 403, code: "parent_approval_required" });
      }

      let enrollmentId: string | null = null;
      let sessionId: string | null = null;
      if (row.template_id) {
        enrollmentId = await createEnrollmentTx(client, orgId, row.student_id, row.template_id);
      } else {
        sessionId = await createSessionTx(client, orgId, {
          tutorId: row.tutor_id,
          studentIds: [row.student_id],
          startTime: row.requested_start_time,
          endTime: row.requested_end_time,
        });
      }

      await client.query(
        `update session_requests
         set status = 'accepted', responded_by_user_id = $1, responded_at = now(),
             resulting_enrollment_id = $2, resulting_session_id = $3
         where id = $4`,
        [uid, enrollmentId, sessionId, requestId]
      );
    });

    await writeAudit(orgId, uid, "booking_request.accept", "session_requests", requestId, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post("/:id/decline", requireRole(...CAN_RESPOND), async (req: AuthRequest, res, next) => {
  try {
    const { responseNote } = declineBookingRequestSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const uid = req.user!.id;
    const requestId = req.params.id;

    await withTransaction(async (client) => {
      const row = await loadRequestForUpdate(client, orgId, requestId);
      if (row.status !== "pending" && row.status !== "countered") {
        throw Object.assign(new Error(`Request is already ${row.status}`), { status: 409, code: "invalid_status" });
      }
      await client.query(
        `update session_requests
         set status = 'declined', responded_by_user_id = $1, responded_at = now(), response_note = $2
         where id = $3`,
        [uid, responseNote ?? null, requestId]
      );
    });

    await writeAudit(orgId, uid, "booking_request.decline", "session_requests", requestId, { responseNote });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// D-05 (EXECUTION_PLAN.md Step 19): the student's own request has
// requires_parent_approval set; only a parent linked to that student can
// clear it (mirrors billing.ts:729-734's parent_links lookup). Not gated to
// CAN_RESPOND — a parent's org role is "parent", not staff.
router.post("/:id/parent-approve", async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const uid = req.user!.id;
    const requestId = req.params.id;

    await withTransaction(async (client) => {
      const row = await loadRequestForUpdate(client, orgId, requestId);

      const linkRes = await client.query(
        `select 1 from parent_links where parent_user_id = $1 and student_id = $2`,
        [uid, row.student_id]
      );
      if (linkRes.rowCount === 0) {
        throw Object.assign(new Error("Not linked to this student"), { status: 403, code: "forbidden" });
      }
      if (!row.requires_parent_approval) {
        throw Object.assign(new Error("This request does not require parent approval"), { status: 409, code: "invalid_status" });
      }

      await client.query(`update session_requests set requires_parent_approval = false where id = $1`, [requestId]);
    });

    await writeAudit(orgId, uid, "booking_request.parent_approve", "session_requests", requestId, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.post("/:id/propose", requireRole(...CAN_RESPOND), async (req: AuthRequest, res, next) => {
  try {
    const body = proposeAlternativeSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const uid = req.user!.id;
    const requestId = req.params.id;

    await withTransaction(async (client) => {
      const row = await loadRequestForUpdate(client, orgId, requestId);
      if (row.status !== "pending") {
        throw Object.assign(new Error(`Request is already ${row.status}`), { status: 409, code: "invalid_status" });
      }
      // Counter-offer must match the request's own target shape — a
      // template-join request only gets a proposed_template_id, a
      // one-on-one request only gets a proposed time range.
      const isTemplateProposal = "proposedTemplateId" in body;
      if (isTemplateProposal !== !!row.template_id) {
        throw Object.assign(new Error("Counter-offer must match the request's target type"), { status: 422, code: "target_mismatch" });
      }
      await client.query(
        `update session_requests
         set status = 'countered', responded_by_user_id = $1, responded_at = now(), response_note = $2,
             proposed_template_id = $3, proposed_start_time = $4, proposed_end_time = $5
         where id = $6`,
        [
          uid,
          body.responseNote ?? null,
          isTemplateProposal ? body.proposedTemplateId : null,
          isTemplateProposal ? null : body.proposedStartTime,
          isTemplateProposal ? null : body.proposedEndTime,
          requestId,
        ]
      );
    });

    await writeAudit(orgId, uid, "booking_request.propose", "session_requests", requestId, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// The original requester (not staff) accepts or declines a counter-offer.
router.post("/:id/respond-to-proposal", async (req: AuthRequest, res, next) => {
  try {
    const { accept } = respondToProposalSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const uid = req.user!.id;
    const requestId = req.params.id;

    await withTransaction(async (client) => {
      const row = await loadRequestForUpdate(client, orgId, requestId);
      if (row.requested_by_user_id !== uid) {
        throw Object.assign(new Error("Only the original requester can respond to a counter-offer"), { status: 403, code: "forbidden" });
      }
      if (row.status !== "countered") {
        throw Object.assign(new Error(`Request is already ${row.status}`), { status: 409, code: "invalid_status" });
      }

      if (!accept) {
        await client.query(
          `update session_requests set status = 'declined', responded_by_user_id = $1, responded_at = now() where id = $2`,
          [uid, requestId]
        );
        return;
      }

      let enrollmentId: string | null = null;
      let sessionId: string | null = null;
      if (row.proposed_template_id) {
        enrollmentId = await createEnrollmentTx(client, orgId, row.student_id, row.proposed_template_id);
      } else {
        sessionId = await createSessionTx(client, orgId, {
          tutorId: row.tutor_id,
          studentIds: [row.student_id],
          startTime: row.proposed_start_time,
          endTime: row.proposed_end_time,
        });
      }
      await client.query(
        `update session_requests
         set status = 'accepted', responded_by_user_id = $1, responded_at = now(),
             resulting_enrollment_id = $2, resulting_session_id = $3
         where id = $4`,
        [uid, enrollmentId, sessionId, requestId]
      );
    });

    await writeAudit(orgId, uid, "booking_request.respond_to_proposal", "session_requests", requestId, { accept });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
