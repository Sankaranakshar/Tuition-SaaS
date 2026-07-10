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

// Staff mints a single-use, expiring token tied to one student. Shared with
// the parent as a link (or read aloud/typed as a code); redeemed below.
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
      .from("students").select("name, organization_id").eq("id", studentId).maybeSingle();
    if (studentErr) throw studentErr;
    if (!student || student.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Student not found" } });
    }

    const token = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const { error: inviteErr } = await supabaseAdmin.from("parent_invites").insert({
      token, organization_id: orgId, student_id: studentId, expires_at: expiresAt.toISOString(),
    });
    if (inviteErr) throw inviteErr;
    await writeAudit(orgId, req.user!.id, "parent_invite.create", "students", studentId, { token: token.slice(0, 8) + "…" });

    res.status(201).json({ ok: true, token, expiresAt: expiresAt.toISOString(), studentName: student.name || null });
  } catch (err) { next(err); }
});

async function loadInvite(token: string) {
  const { data: invite, error } = await supabaseAdmin.from("parent_invites").select("*").eq("token", token).maybeSingle();
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

// A phone-OTP verified user previews who they're about to link to before
// consenting. No client select policy exists on parent_invites — this is
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

const redeemSchema = z.object({
  token: z.string().min(10),
  consent: z.literal(true),
});

// Creates the parent_links row (the only thing is_parent_of() checks) and
// grants the parent role + org membership. The link + invite-burn happens in
// one Postgres transaction; membership then follows as a second write, same
// two-step posture as members.ts bootstrap (nothing atomic requires it to be
// combined — membership is idempotent to retry). Consent is DPDP capture —
// required, not optional.
router.post("/redeem", async (req: AuthRequest, res, next) => {
  try {
    const body = redeemSchema.parse(req.body);
    const uid = req.user!.id;

    const invite = await loadInvite(body.token);

    // A parent belongs to one organization. Block redeeming an invite from a
    // different org than one they're already linked into, same posture as
    // the tutor/admin bootstrap conflict check.
    if (req.user!.organizationId && req.user!.organizationId !== invite.organization_id) {
      return res.status(409).json({ error: { code: "org_conflict", message: "Account is already linked to a different organization" } });
    }

    await withTransaction(async (client) => {
      const freshInvite = await client.query(`select used_at from parent_invites where token = $1 for update`, [body.token]);
      if (freshInvite.rows[0]?.used_at) {
        throw Object.assign(new Error("Invite already used"), { status: 410, code: "invite_used" });
      }
      await client.query(
        `insert into parent_links (parent_user_id, student_id, organization_id)
         values ($1, $2, $3) on conflict (parent_user_id, student_id) do nothing`,
        [uid, invite.student_id, invite.organization_id]
      );
      await client.query(
        `update parent_invites set used_at = now(), used_by = $1 where token = $2`,
        [uid, body.token]
      );
      // Same id-space backfill as students.ts redeem: sessions materialized
      // before this parent linked never had their user id in the array.
      await client.query(
        `update class_sessions
         set parent_user_ids = array_append(parent_user_ids, $1)
         where organization_id = $2 and $3 = any(student_ids) and not ($1 = any(parent_user_ids))`,
        [uid, invite.organization_id, invite.student_id]
      );
    });

    await setMembership(invite.organization_id, uid, "parent", uid);
    await writeAudit(invite.organization_id, uid, "parent_invite.redeem", "parent_links", `${uid}_${invite.student_id}`, {
      studentId: invite.student_id,
    });

    res.json({ ok: true, organizationId: invite.organization_id, studentId: invite.student_id });
  } catch (err) { next(err); }
});

export default router;
