import express from "express";
import { z } from "zod";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { encrypt } from "../utils/crypto.ts";
import { writeAudit } from "../utils/audit.ts";

// Per-org payment gateway + tax settings. Secrets are AES-GCM-encrypted in the
// server-only `payment_gateways` table (no client RLS policy exists → default
// deny for anon/authenticated roles). Secrets are never returned to the
// client; only connection state and the public key id are.
const router = express.Router();
router.use(authenticateToken, requireOrg);

const CAN_CONFIG = ["owner", "admin"] as const;

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
    const orgId = req.user!.organizationId!;
    const { data, error } = await supabaseAdmin
      .from("payment_gateways")
      .select("key_id, key_secret_enc, webhook_secret_enc, tax")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error) throw error;
    const d = data || ({} as Record<string, unknown>);
    res.json({
      connected: Boolean(d.key_id && d.key_secret_enc && d.webhook_secret_enc),
      keyId: d.key_id || null,
      tax: d.tax || null,
    });
  } catch (err) { next(err); }
});

router.put("/razorpay", requireRole(...CAN_CONFIG), async (req: AuthRequest, res, next) => {
  try {
    const { keyId, keySecret, webhookSecret } = credsSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const { error } = await supabaseAdmin.from("payment_gateways").upsert({
      organization_id: orgId,
      key_id: keyId,
      key_secret_enc: encrypt(keySecret),
      webhook_secret_enc: encrypt(webhookSecret),
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    await writeAudit(orgId, req.user!.id, "gateway.connect", "payment_gateways", orgId, { provider: "razorpay", keyId });
    res.json({ ok: true, connected: true, keyId });
  } catch (err) { next(err); }
});

router.delete("/razorpay", requireRole(...CAN_CONFIG), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const { error } = await supabaseAdmin.from("payment_gateways").upsert({
      organization_id: orgId,
      key_id: null,
      key_secret_enc: null,
      webhook_secret_enc: null,
      updated_at: new Date().toISOString(),
    });
    if (error) throw error;
    await writeAudit(orgId, req.user!.id, "gateway.disconnect", "payment_gateways", orgId, {});
    res.json({ ok: true, connected: false });
  } catch (err) { next(err); }
});

router.put("/tax", requireRole(...CAN_CONFIG), async (req: AuthRequest, res, next) => {
  try {
    const tax = taxSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const { error } = await supabaseAdmin.from("payment_gateways").upsert({
      organization_id: orgId,
      tax,
    });
    if (error) throw error;
    await writeAudit(orgId, req.user!.id, "gateway.tax_update", "payment_gateways", orgId, { gstin: tax.gstin || null });
    res.json({ ok: true, tax });
  } catch (err) { next(err); }
});

export default router;
