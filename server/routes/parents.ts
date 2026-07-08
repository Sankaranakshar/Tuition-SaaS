import express from "express";
import crypto from "node:crypto";
import { z } from "zod";
import { adminDb } from "../firebaseAdmin.ts";
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
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const orgId = req.user!.organizationId;
    if (!orgId) {
      return res.status(403).json({ error: { code: "no_organization", message: "User does not belong to an organization" } });
    }
    if (!req.user!.role || !STAFF_WHO_CAN_INVITE.includes(req.user!.role)) {
      return res.status(403).json({ error: { code: "forbidden", message: "Insufficient role" } });
    }
    const { studentId } = z.object({ studentId: z.string().min(1) }).parse(req.body);

    const studentSnap = await db.collection("students").doc(studentId).get();
    if (!studentSnap.exists || studentSnap.data()!.organizationId !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Student not found" } });
    }

    const token = crypto.randomBytes(24).toString("base64url");
    const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
    await db.collection("parent_invites").doc(token).set({
      organizationId: orgId,
      studentId,
      createdBy: req.user!.id,
      createdAt: new Date(),
      expiresAt,
      used: false,
    });
    await writeAudit(orgId, req.user!.id, "parent_invite.create", "students", studentId, { token: token.slice(0, 8) + "…" });

    res.status(201).json({ ok: true, token, expiresAt: expiresAt.toISOString(), studentName: studentSnap.data()!.name || null });
  } catch (err) { next(err); }
});

async function loadInvite(db: FirebaseFirestore.Firestore, token: string) {
  const snap = await db.collection("parent_invites").doc(token).get();
  if (!snap.exists) {
    throw Object.assign(new Error("Invite not found"), { status: 404, code: "not_found" });
  }
  const invite = snap.data()!;
  if (invite.used) {
    throw Object.assign(new Error("Invite already used"), { status: 410, code: "invite_used" });
  }
  const expiresAt = invite.expiresAt?.toDate ? invite.expiresAt.toDate() : new Date(invite.expiresAt);
  if (expiresAt.getTime() < Date.now()) {
    throw Object.assign(new Error("Invite expired"), { status: 410, code: "invite_expired" });
  }
  return { ref: snap.ref, invite };
}

// A phone-OTP verified user previews who they're about to link to before
// consenting. No Firestore read path exists for parent_invites — this is it.
router.get("/invites/:token/preview", async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const { invite } = await loadInvite(db, req.params.token);

    const [studentSnap, orgSnap] = await Promise.all([
      db.collection("students").doc(invite.studentId).get(),
      db.collection("organizations").doc(invite.organizationId).get(),
    ]);

    res.json({
      ok: true,
      studentName: studentSnap.exists ? studentSnap.data()!.name || null : null,
      organizationName: orgSnap.exists ? orgSnap.data()!.name || null : null,
    });
  } catch (err) { next(err); }
});

const redeemSchema = z.object({
  token: z.string().min(10),
  consent: z.literal(true),
});

// Creates the parent_links doc (the only thing isParentOf() checks) and
// grants the parent role + org membership, atomically enough: the Firestore
// side (link + invite burn) is transactional; custom claims follow the same
// two-step pattern as members.ts bootstrap (Admin Auth calls can't join a
// Firestore transaction). Consent is DPDP capture — required, not optional.
router.post("/redeem", async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const body = redeemSchema.parse(req.body);
    const uid = req.user!.id;

    const { ref: inviteRef, invite } = await loadInvite(db, body.token);

    // A parent's custom claims carry one organizationId. Block redeeming an
    // invite from a different org than one they're already linked into,
    // same posture as the tutor/admin bootstrap conflict check.
    if (req.user!.organizationId && req.user!.organizationId !== invite.organizationId) {
      return res.status(409).json({ error: { code: "org_conflict", message: "Account is already linked to a different organization" } });
    }

    const linkRef = db.collection("parent_links").doc(`${uid}_${invite.studentId}`);
    await db.runTransaction(async (tx) => {
      const [linkSnap, freshInvite] = await Promise.all([tx.get(linkRef), tx.get(inviteRef)]);
      if (freshInvite.data()?.used) {
        throw Object.assign(new Error("Invite already used"), { status: 410, code: "invite_used" });
      }
      if (!linkSnap.exists) {
        tx.set(linkRef, {
          organizationId: invite.organizationId,
          parentUserId: uid,
          studentId: invite.studentId,
          consentGivenAt: new Date(),
          consentVersion: "dpdp-v1",
          createdAt: new Date(),
        });
      }
      tx.update(inviteRef, { used: true, usedBy: uid, usedAt: new Date() });
    });

    await setMembership(invite.organizationId, uid, "parent", uid);
    await writeAudit(invite.organizationId, uid, "parent_invite.redeem", "parent_links", `${uid}_${invite.studentId}`, {
      studentId: invite.studentId,
    });

    res.json({ ok: true, organizationId: invite.organizationId, studentId: invite.studentId });
  } catch (err) { next(err); }
});

export default router;
