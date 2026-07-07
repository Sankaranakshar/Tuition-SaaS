import crypto from "crypto";
import type { Firestore } from "firebase-admin/firestore";
import { decrypt } from "./crypto.ts";

// Razorpay integration (blueprint 5.2, DEV_PLAN E6.1/E6.2). Each org connects
// its own Razorpay account so fees land in the center's bank, not ours; keys
// are stored AES-GCM-encrypted in the server-only `payment_gateways`
// collection (mirrors google_tokens). Nothing here trusts client input for
// money: webhooks are signature-verified and idempotent by gateway payment id.

const RZP_API = "https://api.razorpay.com/v1";

export interface RazorpayCreds {
  keyId: string;
  keySecret: string;
  webhookSecret: string;
}

/**
 * Verify a Razorpay webhook signature. HMAC-SHA256 of the raw request body
 * with the org's webhook secret, timing-safe-compared to X-Razorpay-Signature.
 * Pure and unit-tested; MUST be given the raw (unparsed) body bytes.
 */
export function verifyWebhookSignature(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(signature, "utf8");
  // Length check first: timingSafeEqual throws on unequal-length buffers.
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

/** Load and decrypt an org's Razorpay credentials, or null if not connected. */
export async function getGatewayCreds(db: Firestore, orgId: string): Promise<RazorpayCreds | null> {
  const snap = await db.collection("payment_gateways").doc(orgId).get();
  if (!snap.exists) return null;
  const d = snap.data()!;
  const keyId = d.keyId as string | undefined;
  const keySecret = d.keySecretEnc ? decrypt(d.keySecretEnc) : null;
  const webhookSecret = d.webhookSecretEnc ? decrypt(d.webhookSecretEnc) : null;
  if (!keyId || !keySecret || !webhookSecret) return null;
  return { keyId, keySecret, webhookSecret };
}

function authHeader(creds: RazorpayCreds): string {
  return "Basic " + Buffer.from(`${creds.keyId}:${creds.keySecret}`).toString("base64");
}

export interface PaymentLinkParams {
  amountPaise: number;
  referenceId: string; // our invoiceId — Razorpay enforces uniqueness on it
  description: string;
  customer: { name?: string; contact?: string; email?: string };
  notes: Record<string, string>;
  callbackUrl?: string;
}

export interface PaymentLinkResult {
  id: string;
  shortUrl: string;
  status: string;
}

/** Create a hosted Razorpay payment link for an invoice's outstanding amount. */
export async function createPaymentLink(
  creds: RazorpayCreds,
  params: PaymentLinkParams
): Promise<PaymentLinkResult> {
  const res = await fetch(`${RZP_API}/payment_links`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: authHeader(creds) },
    body: JSON.stringify({
      amount: params.amountPaise,
      currency: "INR",
      accept_partial: false,
      reference_id: params.referenceId,
      description: params.description.slice(0, 2048),
      customer: params.customer,
      notify: { sms: false, email: false }, // we deliver via our own channel router (Epic 7)
      reminder_enable: false,
      notes: params.notes,
      callback_url: params.callbackUrl,
      callback_method: params.callbackUrl ? "get" : undefined,
    }),
  });

  const json = (await res.json().catch(() => ({}))) as any;
  if (!res.ok) {
    const message = json?.error?.description || `Razorpay error ${res.status}`;
    throw Object.assign(new Error(message), { status: 502, code: "gateway_error" });
  }
  return { id: json.id, shortUrl: json.short_url, status: json.status };
}

/** Fetch a payment link's current state, for the reconciliation poll. */
export async function fetchPaymentLink(creds: RazorpayCreds, linkId: string): Promise<any> {
  const res = await fetch(`${RZP_API}/payment_links/${linkId}`, {
    headers: { Authorization: authHeader(creds) },
  });
  if (!res.ok) throw Object.assign(new Error(`Razorpay error ${res.status}`), { status: 502, code: "gateway_error" });
  return res.json();
}
