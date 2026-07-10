import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { withTransaction } from "../db.ts";
import { authenticateToken, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";
import { setMembership } from "./members.ts";

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
    const { studentId } = z.object({ studentId: z.string().uuid() }).parse(req.body);

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

const redeemSchema = z.object({ token: z.string().min(10) });

// Claims the students row (sets student_user_id — the only thing
// is_student_self() checks) and grants the student role + org membership.
// The claim + invite-burn happens in one Postgres transaction; membership
// then follows as a second write, same two-step posture as parents.ts redeem.
router.post("/redeem", async (req: AuthRequest, res, next) => {
  try {
    const body = redeemSchema.parse(req.body);
    const uid = req.user!.id;

    const invite = await loadInvite(body.token);

    // A student belongs to one organization. Block redeeming an invite from a
    // different org than one they're already linked into, same posture as
    // the tutor/admin bootstrap conflict check.
    if (req.user!.organizationId && req.user!.organizationId !== invite.organization_id) {
      return res.status(409).json({ error: { code: "org_conflict", message: "Account is already linked to a different organization" } });
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
    });

    await setMembership(invite.organization_id, uid, "student", uid);
    await writeAudit(invite.organization_id, uid, "student_invite.redeem", "students", invite.student_id, {});

    res.json({ ok: true, organizationId: invite.organization_id, studentId: invite.student_id });
  } catch (err) { next(err); }
});

export default router;
