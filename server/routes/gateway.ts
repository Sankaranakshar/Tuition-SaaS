import express from "express";
import { z } from "zod";
import { adminDb } from "../firebaseAdmin.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { encrypt } from "../utils/crypto.ts";
import { writeAudit } from "../utils/audit.ts";

// Per-org payment gateway + tax settings. Secrets are AES-GCM-encrypted in the
// server-only `payment_gateways` collection (no client rules match → default
// deny). Secrets are never returned to the client; only connection state and
// the public key id are.
const router = express.Router();
router.use(authenticateToken, requireOrg);

const CAN_CONFIG = ["owner", "admin"] as const;
const GW = "payment_gateways";

const credsSchema = z.object({
  keyId: z.string().min(6),
  keySecret: z.string().min(6),
  webhookSecret: z.string().min(6),
});

const taxSchema = z.object({
  legalName: z.string().max(200).optional(),
  gstin: z.string().max(20).optional(),
  addressLines: z.array(z.string().max(200)).max(5).optional(),
  placeOfSupply: z.string().max(60).optional(),
  defaultTaxRatePercent: z.number().min(0).max(28).optional(),
  invoicePrefix: z.string().max(8).optional(),
});

// Connection state + tax settings. Secrets are never included.
router.get("/", requireRole(...CAN_CONFIG), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const snap = await adminDb.collection(GW).doc(req.user!.organizationId!).get();
    const d = snap.exists ? snap.data()! : {};
    res.json({
      connected: Boolean(d.keyId && d.keySecretEnc && d.webhookSecretEnc),
      keyId: d.keyId || null,
      tax: d.tax || null,
    });
  } catch (err) { next(err); }
});

router.put("/razorpay", requireRole(...CAN_CONFIG), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const { keyId, keySecret, webhookSecret } = credsSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    await adminDb.collection(GW).doc(orgId).set({
      organizationId: orgId,
      provider: "razorpay",
      keyId,
      keySecretEnc: encrypt(keySecret),
      webhookSecretEnc: encrypt(webhookSecret),
      connectedAt: new Date(),
      connectedBy: req.user!.id,
    }, { merge: true });
    await writeAudit(orgId, req.user!.id, "gateway.connect", GW, orgId, { provider: "razorpay", keyId });
    res.json({ ok: true, connected: true, keyId });
  } catch (err) { next(err); }
});

router.delete("/razorpay", requireRole(...CAN_CONFIG), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const orgId = req.user!.organizationId!;
    await adminDb.collection(GW).doc(orgId).set(
      { keyId: null, keySecretEnc: null, webhookSecretEnc: null, disconnectedAt: new Date() },
      { merge: true }
    );
    await writeAudit(orgId, req.user!.id, "gateway.disconnect", GW, orgId, {});
    res.json({ ok: true, connected: false });
  } catch (err) { next(err); }
});

router.put("/tax", requireRole(...CAN_CONFIG), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const tax = taxSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    await adminDb.collection(GW).doc(orgId).set({ organizationId: orgId, tax }, { merge: true });
    await writeAudit(orgId, req.user!.id, "gateway.tax_update", GW, orgId, { gstin: tax.gstin || null });
    res.json({ ok: true, tax });
  } catch (err) { next(err); }
});

export default router;
