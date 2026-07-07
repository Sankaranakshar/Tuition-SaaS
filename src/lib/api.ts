import { auth } from "../firebase";

// Thin authenticated client for the privileged API (/api/v1).
// Money and attendance mutations must go through here; they have no
// client-side Firestore write path by design.
export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const token = await auth.currentUser?.getIdToken();
  if (!token) throw new Error("Not signed in");

  const resp = await fetch(`/api/v1${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });

  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    const message = (data as any)?.error?.message || `Request failed (${resp.status})`;
    throw Object.assign(new Error(message), { status: resp.status, code: (data as any)?.error?.code });
  }
  return data as T;
}

export type AttendanceStatus = "present" | "absent" | "late" | "excused";

export function markAttendance(sessionId: string, records: { studentId: string; status: AttendanceStatus }[]) {
  return api<{ ok: true; billed: string[]; invoiced: string[] }>("/billing/attendance", {
    method: "POST",
    body: { sessionId, records },
  });
}

export function cancelSession(sessionId: string) {
  return api<{ ok: true }>("/billing/sessions/cancel", { method: "POST", body: { sessionId } });
}

export function recordManualPayment(input: {
  invoiceId: string;
  amountPaise: number;
  method: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
  note?: string;
}) {
  return api<{ ok: true; invoiceStatus: string }>("/billing/payments/manual", {
    method: "POST",
    body: { ...input, idempotencyKey: crypto.randomUUID() },
  });
}

export function voidInvoice(invoiceId: string) {
  return api<{ ok: true }>(`/billing/invoices/${invoiceId}/void`, { method: "POST" });
}

/** Assign a gap-free invoice number and snapshot tax details (draft → sent). */
export function finalizeInvoice(invoiceId: string) {
  return api<{ ok: true; invoiceNumber: string }>(`/billing/invoices/${invoiceId}/finalize`, { method: "POST" });
}

/** Create (or reuse) a Razorpay UPI payment link for the outstanding amount. */
export function createInvoicePaymentLink(invoiceId: string) {
  return api<{ ok: true; shortUrl: string; reused: boolean }>(
    `/billing/invoices/${invoiceId}/payment-link`,
    { method: "POST" }
  );
}

export function refundPayment(input: { invoiceId: string; amountPaise: number; reason?: string }) {
  return api<{ ok: true; invoiceStatus: string; duplicate: boolean }>("/billing/refunds", {
    method: "POST",
    body: { ...input, idempotencyKey: crypto.randomUUID() },
  });
}

export function reconcilePayments() {
  return api<{ ok: true; scanned: number; reconciled: number }>("/billing/reconcile", { method: "POST" });
}

// Gateway + tax settings (owner/admin).
export function getGatewaySettings() {
  return api<{ connected: boolean; keyId: string | null; tax: Record<string, unknown> | null }>("/gateway");
}

export function connectRazorpay(input: { keyId: string; keySecret: string; webhookSecret: string }) {
  return api<{ ok: true; connected: boolean; keyId: string }>("/gateway/razorpay", { method: "PUT", body: input });
}

export function disconnectRazorpay() {
  return api<{ ok: true; connected: boolean }>("/gateway/razorpay", { method: "DELETE" });
}

export function saveTaxSettings(tax: {
  legalName?: string;
  gstin?: string;
  addressLines?: string[];
  placeOfSupply?: string;
  defaultTaxRatePercent?: number;
  invoicePrefix?: string;
}) {
  return api<{ ok: true; tax: unknown }>("/gateway/tax", { method: "PUT", body: tax });
}
