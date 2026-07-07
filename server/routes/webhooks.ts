import express from "express";
import { adminDb } from "../firebaseAdmin.ts";
import { getGatewayCreds, verifyWebhookSignature } from "../utils/razorpay.ts";
import { applyPayment, type InvoiceStatus } from "../utils/invoiceStatus.ts";
import { writeAudit } from "../utils/audit.ts";

// Razorpay webhook receiver (DEV_PLAN E6.2). Public but signature-gated: the
// body is HMAC-verified against the org's stored webhook secret before we
// trust a byte of it. Idempotent by gateway payment id, so duplicate
// deliveries reconcile exactly once. Mounted with a RAW body parser (see
// server.ts) because signature verification needs the exact bytes.
const router = express.Router();

// One org per webhook URL: Razorpay is configured with .../razorpay/{orgId},
// which tells us whose secret to verify against before parsing.
router.post("/razorpay/:orgId", async (req, res) => {
  const orgId = req.params.orgId;
  const signature = req.header("x-razorpay-signature") || "";
  // express.raw gives us a Buffer; keep the exact bytes for the HMAC.
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";

  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const creds = await getGatewayCreds(adminDb, orgId);
    if (!creds) return res.status(404).json({ error: { code: "not_connected", message: "Gateway not configured" } });

    if (!verifyWebhookSignature(rawBody, signature, creds.webhookSecret)) {
      return res.status(400).json({ error: { code: "bad_signature", message: "Signature verification failed" } });
    }

    const event = JSON.parse(rawBody);
    const outcome = await handleEvent(adminDb, orgId, event);
    // Always 200 on a verified event Razorpay understands, so it stops retrying.
    return res.json({ ok: true, ...outcome });
  } catch (err: any) {
    // Signature already verified for real deliveries; a throw here is our bug,
    // so 500 lets Razorpay retry rather than silently dropping a real payment.
    req.log?.error?.({ err }, "Razorpay webhook processing failed");
    return res.status(500).json({ error: { code: "internal", message: "Webhook processing failed" } });
  }
});

async function handleEvent(db: FirebaseFirestore.Firestore, orgId: string, event: any) {
  const type = event?.event as string | undefined;
  const linkEntity = event?.payload?.payment_link?.entity;
  const paymentEntity = event?.payload?.payment?.entity;

  // We only act on money actually captured.
  if (type !== "payment_link.paid" && type !== "payment.captured") {
    return { ignored: true, type };
  }
  if (!paymentEntity?.id) return { ignored: true, reason: "no_payment" };

  const invoiceId =
    linkEntity?.reference_id ||
    linkEntity?.notes?.invoiceId ||
    paymentEntity?.notes?.invoiceId;
  if (!invoiceId) return { ignored: true, reason: "no_invoice_ref" };

  const amountPaise = Number(paymentEntity.amount);
  const paymentId = String(paymentEntity.id);

  // Pre-read the student's wallet ref outside the txn (reads-before-writes).
  const invRef = db.collection("invoices").doc(invoiceId);
  const payRef = db.collection("payments").doc(`rzp_${paymentId}`);

  const result = await db.runTransaction(async (tx) => {
    const [paySnap, invSnap] = await Promise.all([tx.get(payRef), tx.get(invRef)]);
    if (paySnap.exists) return { duplicate: true, status: paySnap.data()!.invoiceStatus as InvoiceStatus };
    if (!invSnap.exists || invSnap.data()!.organizationId !== orgId) {
      return { orphan: true };
    }
    const inv = invSnap.data()!;
    const totalPaise = inv.totalPaise ?? Math.round((inv.totalAmount || 0) * 100);
    const applied = applyPayment(
      { status: inv.status as InvoiceStatus, totalPaise, paidPaise: inv.paidPaise || 0 },
      amountPaise
    );

    tx.set(payRef, {
      organizationId: orgId,
      invoiceId,
      studentId: inv.studentId || null,
      amountPaise,
      method: "upi",
      gateway: "razorpay",
      gatewayPaymentId: paymentId,
      gatewayLinkId: linkEntity?.id || null,
      invoiceStatus: applied.status,
      at: new Date(),
    });
    tx.update(invRef, { paidPaise: applied.paidPaise, status: applied.status, lastPaymentAt: new Date() });

    // Overpayment becomes wallet credit, recorded on the append-only ledger.
    if (applied.overpaidPaise > 0 && inv.studentId) {
      tx.set(db.collection("wallet_ledger").doc(), {
        organizationId: orgId, studentId: inv.studentId, type: "credit_currency",
        credits: 0, paise: applied.overpaidPaise, reason: "overpayment", invoiceId,
        gatewayPaymentId: paymentId, at: new Date(), by: "razorpay_webhook",
      });
    }
    return { duplicate: false, status: applied.status, overpaidPaise: applied.overpaidPaise };
  });

  if (result.orphan) return { ignored: true, reason: "invoice_not_found" };
  if (!result.duplicate) {
    await writeAudit(orgId, "razorpay_webhook", "payment.gateway_captured", "invoices", invoiceId, {
      gatewayPaymentId: paymentId, amountPaise, invoiceStatus: result.status,
    });
  }
  return result;
}

export default router;
