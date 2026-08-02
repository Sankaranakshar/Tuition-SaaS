import express from "express";
import crypto from "node:crypto";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { withTransaction } from "../db.ts";
import { authenticateToken, requireRole, requireOrg, invalidateMembership, type AuthRequest, type Role } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";
import {
  setMemberRoleRequestSchema, bootstrapOrgRequestSchema,
  createStaffInviteRequestSchema, staffRedeemRequestSchema,
} from "../../shared/schemas/members.ts";

const router = express.Router();
const INVITE_TTL_MS = 7 * 24 * 3600 * 1000;

// Membership is a plain Postgres row, read fresh by the auth middleware on
// every request — no custom claims to set, no token revocation needed for a
// role change or removal to take effect.
export async function setMembership(orgId: string, userId: string, role: Role, _actorId: string) {
  const { error } = await supabaseAdmin
    .from("organization_members")
    .upsert({ organization_id: orgId, user_id: userId, role }, { onConflict: "organization_id,user_id" });
  if (error) throw error;
  invalidateMembership(userId);

  // profiles.organization_id is client-immutable (20260709021200) and not
  // authorization-bearing itself, but Today.tsx's admin-lanes tutor-name
  // lookup reads it — keep it in sync with the real membership here, the one
  // place both bootstrap and role changes flow through.
  const { error: profileErr } = await supabaseAdmin.from("profiles").update({ organization_id: orgId }).eq("id", userId);
  if (profileErr) throw profileErr;
}

// Bootstrap: a user with no org creates one and becomes its owner.
router.post("/bootstrap", authenticateToken, async (req: AuthRequest, res, next) => {
  try {
    if (req.user?.organizationId) {
      return res.status(409).json({ error: { code: "already_member", message: "User already belongs to an organization" } });
    }
    const body = bootstrapOrgRequestSchema.parse(req.body);

    const { data: org, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .insert({ name: body.organizationName })
      .select("id")
      .single();
    if (orgErr) throw orgErr;

    await setMembership(org.id, req.user!.id, "owner", req.user!.id);
    await writeAudit(org.id, req.user!.id, "org.create", "organizations", org.id, { name: body.organizationName });

    res.status(201).json({ organizationId: org.id });
  } catch (err) { next(err); }
});

// Add or change a member's role. Owner/admin only, same org enforced.
router.put("/", authenticateToken, requireOrg, requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    const body = setMemberRoleRequestSchema.parse(req.body);
    const orgId = req.user!.organizationId!;

    // Only the owner may grant owner/admin; admins manage lower roles.
    if ((body.role === "owner" || body.role === "admin") && req.user!.role !== "owner") {
      return res.status(403).json({ error: { code: "forbidden", message: "Only the owner can grant owner or admin roles" } });
    }
    await setMembership(orgId, body.userId, body.role, req.user!.id);
    await writeAudit(orgId, req.user!.id, "member.set_role", "organization_members", `${orgId}_${body.userId}`, { role: body.role });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Remove a member: membership row deleted. Their session stays technically
// valid until it expires, but org-scoped routes 403 immediately since
// authenticateToken finds no membership row on the next request.
router.delete("/:userId", authenticateToken, requireOrg, requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const { userId } = req.params;

    if (userId === req.user!.id) {
      return res.status(400).json({ error: { code: "cannot_remove_self", message: "Transfer ownership before leaving" } });
    }
    const { error } = await supabaseAdmin
      .from("organization_members")
      .delete()
      .eq("organization_id", orgId)
      .eq("user_id", userId);
    if (error) throw error;
    invalidateMembership(userId);

    await writeAudit(orgId, req.user!.id, "member.remove", "organization_members", `${orgId}_${userId}`, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Tech Debt #1: staff invites. Mirrors the parent_invites/student_invites
// pattern exactly, redeeming into organization_members via setMembership()
// above instead of a parent_links row or claiming a students row.
router.post("/invites", authenticateToken, requireOrg, requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    const body = createStaffInviteRequestSchema.parse(req.body);
    const orgId = req.user!.organizationId!;

    // Same rule as PUT /: only the owner may grant the admin role.
    if (body.role === "admin" && req.user!.role !== "owner") {
      return res.status(403).json({ error: { code: "forbidden", message: "Only the owner can invite an admin" } });
    }

    const token = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    const { error } = await supabaseAdmin.from("staff_invites").insert({
      token, organization_id: orgId, role: body.role, invited_by: req.user!.id, expires_at: expiresAt.toISOString(),
    });
    if (error) throw error;
    await writeAudit(orgId, req.user!.id, "staff_invite.create", "organization_members", orgId, { role: body.role, token: token.slice(0, 8) + "…" });

    res.status(201).json({ ok: true, token, expiresAt: expiresAt.toISOString(), role: body.role });
  } catch (err) { next(err); }
});

async function loadStaffInvite(token: string) {
  const { data: invite, error } = await supabaseAdmin.from("staff_invites").select("*").eq("token", token).maybeSingle();
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

// A signed-in user previews which org/role they're about to join before
// confirming. No client select policy exists on staff_invites — this is the
// only read path.
router.get("/invites/:token/preview", authenticateToken, async (req: AuthRequest, res, next) => {
  try {
    const invite = await loadStaffInvite(req.params.token);
    const { data: org } = await supabaseAdmin.from("organizations").select("name").eq("id", invite.organization_id).maybeSingle();
    res.json({ ok: true, organizationName: org?.name || null, role: invite.role as Role });
  } catch (err) { next(err); }
});

router.post("/invites/redeem", authenticateToken, async (req: AuthRequest, res, next) => {
  try {
    const body = staffRedeemRequestSchema.parse(req.body);
    const uid = req.user!.id;

    const invite = await loadStaffInvite(body.token);

    // A user belongs to one organization. Block redeeming an invite from a
    // different org than one they're already linked into, same posture as
    // the parent/student invite conflict check.
    if (req.user!.organizationId && req.user!.organizationId !== invite.organization_id) {
      return res.status(409).json({ error: { code: "org_conflict", message: "Account is already linked to a different organization" } });
    }

    await withTransaction(async (client) => {
      const freshInvite = await client.query(`select used_at from staff_invites where token = $1 for update`, [body.token]);
      if (freshInvite.rows[0]?.used_at) {
        throw Object.assign(new Error("Invite already used"), { status: 410, code: "invite_used" });
      }
      await client.query(`update staff_invites set used_at = now(), used_by = $1 where token = $2`, [uid, body.token]);
    });

    await setMembership(invite.organization_id, uid, invite.role as Role, uid);
    await writeAudit(invite.organization_id, uid, "staff_invite.redeem", "organization_members", `${invite.organization_id}_${uid}`, { role: invite.role });

    res.json({ ok: true, organizationId: invite.organization_id, role: invite.role as Role });
  } catch (err) { next(err); }
});

export default router;
