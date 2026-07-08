import express from "express";
import { z } from "zod";
import { adminAuth, adminDb } from "../firebaseAdmin.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest, type Role } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";

const router = express.Router();

const STAFF_ROLES: Role[] = ["owner", "admin", "tutor", "frontdesk", "accountant"];
const ALL_ROLES: Role[] = [...STAFF_ROLES, "parent", "student"];

const memberSchema = z.object({
  userId: z.string().min(1),
  role: z.enum(ALL_ROLES as [Role, ...Role[]]),
});

export async function setMembership(orgId: string, userId: string, role: Role, actorId: string) {
  if (!adminAuth || !adminDb) throw new Error("Firebase Admin not initialized");

  const memberRef = adminDb.collection("organization_members").doc(`${orgId}_${userId}`);
  await memberRef.set({
    organizationId: orgId,
    userId,
    role,
    updatedAt: new Date(),
    updatedBy: actorId,
  }, { merge: true });

  // Custom claims are the single authorization source (middleware + rules).
  await adminAuth.setCustomUserClaims(userId, { role, organizationId: orgId });
  // Force re-issue of tokens so stale roles die immediately.
  await adminAuth.revokeRefreshTokens(userId);
}

// Bootstrap: a user with no org creates one and becomes its owner.
router.post("/bootstrap", authenticateToken, async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    if (req.user?.organizationId) {
      return res.status(409).json({ error: { code: "already_member", message: "User already belongs to an organization" } });
    }
    const body = z.object({ organizationName: z.string().min(2).max(120) }).parse(req.body);

    const orgRef = adminDb.collection("organizations").doc();
    await orgRef.set({
      name: body.organizationName,
      ownerUserId: req.user!.id,
      createdAt: new Date(),
    });
    await setMembership(orgRef.id, req.user!.id, "owner", req.user!.id);
    await writeAudit(orgRef.id, req.user!.id, "org.create", "organizations", orgRef.id, { name: body.organizationName });

    res.status(201).json({ organizationId: orgRef.id });
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

// Remove a member: membership doc deleted, claims cleared, tokens revoked.
router.delete("/:userId", authenticateToken, requireOrg, requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    if (!adminAuth || !adminDb) throw new Error("Firebase Admin not initialized");
    const orgId = req.user!.organizationId!;
    const { userId } = req.params;

    if (userId === req.user!.id) {
      return res.status(400).json({ error: { code: "cannot_remove_self", message: "Transfer ownership before leaving" } });
    }
    await adminDb.collection("organization_members").doc(`${orgId}_${userId}`).delete();
    await adminAuth.setCustomUserClaims(userId, {});
    await adminAuth.revokeRefreshTokens(userId);
    await writeAudit(orgId, req.user!.id, "member.remove", "organization_members", `${orgId}_${userId}`, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

export default router;
