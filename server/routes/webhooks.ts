import express from "express";
import type { PoolClient } from "pg";
import { withTransaction } from "../db.ts";
import { getGatewayCreds, verifyWebhookSignature } from "../utils/razorpay.ts";
import { applyPayment, type InvoiceStatus } from "../utils/invoiceStatus.ts";
import { writeAudit } from "../utils/audit.ts";

// Razorpay webhook receiver (DEV_PLAN E6.2). Public but signature-gated: the
// body is HMAC-verified against the org's stored webhook secret before we
// trust a byte of it. Idempotent by gateway payment id (unique constraint on
// payments.idempotency_key), so duplicate deliveries reconcile exactly once.
// Mounted with a RAW body parser (see server.ts) because signature
// verification needs the exact bytes.
const router = express.Router();

// One org per webhook URL: Razorpay is configured with .../razorpay/{orgId},
// which tells us whose secret to verify against before parsing.
router.post("/razorpay/:orgId", async (req, res) => {
  const orgId = req.params.orgId;
  const signature = req.header("x-razorpay-signature") || "";
  // express.raw gives us a Buffer; keep the exact bytes for the HMAC.
  const rawBody = Buffer.isBuffer(req.body) ? req.body.toString("utf8") : "";

  try {
    const creds = await getGatewayCreds(orgId);
    if (!creds) return res.status(404).json({ error: { code: "not_connected", message: "Gateway not configured" } });

    if (!verifyWebhookSignature(rawBody, signature, creds.webhookSecret)) {
      return res.status(400).json({ error: { code: "bad_signature", message: "Signature verification failed" } });
    }

    const event = JSON.parse(rawBody);
    const outcome = await handleEvent(orgId, event);
    // Always 200 on a verified event Razorpay understands, so it stops retrying.
    return res.json({ ok: true, ...outcome });
  } catch (err: any) {
    // Signature already verified for real deliveries; a throw here is our bug,
    // so 500 lets Razorpay retry rather than silently dropping a real payment.
    req.log?.error?.({ err }, "Razorpay webhook processing failed");
    return res.status(500).json({ error: { code: "internal", message: "Webhook processing failed" } });
  }
});

async function handleEvent(orgId: string, event: any) {
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
  const idempotencyKey = `rzp_${paymentId}`;

  const result = await withTransaction(async (client: PoolClient) => {
    const existing = await client.query(
      `select invoice_status from payments where organization_id = $1 and idempotency_key = $2`,
      [orgId, idempotencyKey]
    );
    if ((existing.rowCount ?? 0) > 0) {
      return { duplicate: true, status: existing.rows[0].invoice_status as InvoiceStatus };
    }

    // Lock the invoice row so a concurrent manual payment / reconcile pass
    // can't read a stale paid_paise total.
    const invRes = await client.query(
      `select organization_id, student_id, status, total_paise, paid_paise from invoices where id = $1 for update`,
      [invoiceId]
    );
    if (invRes.rowCount === 0 || invRes.rows[0].organization_id !== orgId) {
      return { orphan: true };
    }
    const inv = invRes.rows[0];
    const applied = applyPayment(
      { status: inv.status as InvoiceStatus, totalPaise: inv.total_paise, paidPaise: inv.paid_paise },
      amountPaise
    );

    await client.query(
      `insert into payments
         (organization_id, invoice_id, student_id, amount_paise, method, gateway, gateway_payment_id, gateway_link_id, invoice_status, idempotency_key, at)
       values ($1, $2, $3, $4, 'upi', 'razorpay', $5, $6, $7, $8, now())`,
      [orgId, invoiceId, inv.student_id, amountPaise, paymentId, linkEntity?.id || null, applied.status, idempotencyKey]
    );
    await client.query(
      `update invoices set paid_paise = $1, status = $2, last_payment_at = now() where id = $3`,
      [applied.paidPaise, applied.status, invoiceId]
    );

    // Overpayment becomes wallet credit, recorded on the append-only ledger.
    if (applied.overpaidPaise > 0 && inv.student_id) {
      await client.query(
        `insert into wallet_ledger (organization_id, student_id, type, credits, paise, reason, invoice_id, gateway_payment_id, by, at)
         values ($1, $2, 'credit_currency', 0, $3, 'overpayment', $4, $5, 'razorpay_webhook', now())`,
        [orgId, inv.student_id, applied.overpaidPaise, invoiceId, paymentId]
      );
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
