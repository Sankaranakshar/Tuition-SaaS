import { supabase } from "../supabase";

// Thin authenticated client for the privileged API (/api/v1).
// Money and attendance mutations must go through here; they have no
// client-side write path (blocked by RLS) by design.
export async function api<T = unknown>(
  path: string,
  options: { method?: string; body?: unknown } = {}
): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
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

/** Create a free-form invoice with custom line items (rupee amounts). */
export function createInvoice(input: {
  studentId: string;
  items: { description: string; amount: number; quantity: number }[];
  taxPercentage?: number;
  dueDate?: string;
}) {
  return api<{ ok: true; invoiceId: string }>("/billing/invoices", { method: "POST", body: input });
}

/** Staff-recorded wallet top-up (offline/in-person payment credited to the student's prepaid balance). */
export function topUpWallet(input: {
  studentId: string;
  amountPaise: number;
  method: "cash" | "upi" | "bank_transfer" | "cheque" | "other";
  note?: string;
}) {
  return api<{ ok: true; duplicate: boolean }>("/billing/wallets/topup", {
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

/** Download the server-rendered invoice PDF. Streams as a Blob; triggers a
 *  file save via a synthetic anchor click. */
export async function downloadInvoicePdf(invoiceId: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not signed in");
  const resp = await fetch(`/api/v1/billing/invoices/${invoiceId}/pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw Object.assign(
      new Error((data as any)?.error?.message || `Couldn't download PDF (${resp.status})`),
      { status: resp.status }
    );
  }
  const blob = await resp.blob();
  const cd = resp.headers.get("content-disposition") || "";
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match?.[1] || `invoice-${invoiceId}.pdf`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/** Uploads a document to Cloud Storage via the server (DEV_PLAN E3.9): the
 *  server sniffs the real file signature and sanitizes the filename before
 *  it ever lands in storage, so this can't go through the JSON `api()`
 *  helper — it needs a multipart body. */
export async function uploadDocument(input: { file: File; studentId: string; category: string; notes?: string }) {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not signed in");
  const form = new FormData();
  form.append("file", input.file);
  form.append("studentId", input.studentId);
  form.append("category", input.category);
  form.append("notes", input.notes || "");

  const resp = await fetch("/api/v1/documents", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw Object.assign(new Error((data as any)?.error?.message || `Upload failed (${resp.status})`), { status: resp.status });
  }
  return data as { ok: true; documentId: string };
}

/** Mints a short-lived signed URL for viewing/downloading a document. */
export function getDocumentUrl(documentId: string) {
  return api<{ ok: true; url: string }>(`/documents/${documentId}/url`);
}

export function deleteDocument(documentId: string) {
  return api<{ ok: true }>(`/documents/${documentId}`, { method: "DELETE" });
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

// Parent portal (Epic 10). A parent's only client write path to `students`
// data is through these three server-mediated calls; parent_links itself has
// no client write path at all (see firestore.rules).

/** Staff: mint a single-use, 7-day invite token for a student. */
export function createParentInvite(studentId: string) {
  return api<{ ok: true; token: string; expiresAt: string; studentName: string | null }>(
    "/parents/invites",
    { method: "POST", body: { studentId } }
  );
}

/** Preview who an invite links to before a parent consents. */
export function previewParentInvite(token: string) {
  return api<{ ok: true; studentName: string | null; organizationName: string | null }>(
    `/parents/invites/${encodeURIComponent(token)}/preview`
  );
}

/** Redeem an invite: creates the parent_links doc and grants the parent role. Requires DPDP consent. */
export function redeemParentInvite(token: string) {
  return api<{ ok: true; organizationId: string; studentId: string }>("/parents/redeem", {
    method: "POST",
    body: { token, consent: true },
  });
}

// Student self-onboarding (Tech Debt #16). Mirrors the parent invite calls
// above: staff mints a token tied to an existing `students` roster row, the
// student previews it, then redeems it to claim that row and join the org.

/** Staff: mint a single-use, 7-day invite token for an unclaimed student row. */
export function createStudentInvite(studentId: string) {
  return api<{ ok: true; token: string; expiresAt: string; studentName: string | null }>(
    "/students/invites",
    { method: "POST", body: { studentId } }
  );
}

/** Preview which student/org an invite links to before redeeming. */
export function previewStudentInvite(token: string) {
  return api<{ ok: true; studentName: string | null; organizationName: string | null }>(
    `/students/invites/${encodeURIComponent(token)}/preview`
  );
}

/** Redeem an invite: claims the students row (student_user_id) and grants the student role. */
export function redeemStudentInvite(token: string) {
  return api<{ ok: true; organizationId: string; studentId: string }>("/students/redeem", {
    method: "POST",
    body: { token },
  });
}

/** Parent-authorized Razorpay UPI payment link for one of their linked children's invoices. */
export function payInvoiceAsParent(invoiceId: string) {
  return api<{ ok: true; shortUrl: string; reused: boolean }>(`/billing/invoices/${invoiceId}/pay`, {
    method: "POST",
  });
}
