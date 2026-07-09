import express from "express";
import { z } from "zod";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest, type Role } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";

const router = express.Router();

const STAFF_ROLES: Role[] = ["owner", "admin", "tutor", "frontdesk", "accountant"];
const ALL_ROLES: Role[] = [...STAFF_ROLES, "parent", "student"];

const memberSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ALL_ROLES as [Role, ...Role[]]),
});

// Membership is a plain Postgres row, read fresh by the auth middleware on
// every request — no custom claims to set, no token revocation needed for a
// role change or removal to take effect.
export async function setMembership(orgId: string, userId: string, role: Role, _actorId: string) {
  const { error } = await supabaseAdmin
    .from("organization_members")
    .upsert({ organization_id: orgId, user_id: userId, role }, { onConflict: "organization_id,user_id" });
  if (error) throw error;
}

// Bootstrap: a user with no org creates one and becomes its owner.
router.post("/bootstrap", authenticateToken, async (req: AuthRequest, res, next) => {
  try {
    if (req.user?.organizationId) {
      return res.status(409).json({ error: { code: "already_member", message: "User already belongs to an organization" } });
    }
    const body = z.object({ organizationName: z.string().min(2).max(120) }).parse(req.body);

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
    const body = memberSchema.parse(req.body);
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

    await writeAudit(orgId, req.user!.id, "member.remove", "organization_members", `${orgId}_${userId}`, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
