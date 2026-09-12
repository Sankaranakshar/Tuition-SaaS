import { supabase } from "../supabase";
import type {
  AttendanceStatus as SharedAttendanceStatus,
  MarkAttendanceResponse,
  CancelSessionResponse,
  RecordManualPaymentRequest,
  RecordManualPaymentResponse,
  CreateInvoiceRequest,
  CreateInvoiceResponse,
  TopupRequest,
  TopupResponse,
  VoidInvoiceResponse,
  FinalizeInvoiceResponse,
  PaymentLinkResponse,
  RefundRequest,
  RefundResponse,
  WalletTopupLinkResponse,
} from "../../shared/schemas/billing";
import type { EnsureClassChannelResponse } from "../../shared/schemas/inbox";
import type {
  RescheduleSessionResponse,
  UpdateTemplateScopeRequest,
  UpdateTemplateScopeResponse,
  FindGapsResponse,
} from "../../shared/schemas/scheduling";
import type { SubscriptionResponse, CheckoutResponse } from "../../shared/schemas/subscription";
import type { PlanId } from "../../shared/plans";
import type { ListOrgsResponse, ImpersonateResponse } from "../../shared/schemas/admin";
import type { OffboardResponse } from "../../shared/schemas/orgExport";
import type { EraseStudentResponse } from "../../shared/schemas/students";
import type { ListAuditEventsResponse } from "../../shared/schemas/auditLog";
import type { BulkImportInspectResponse, BulkImportPreviewResponse, BulkImportCommitResponse, ImportField, BulkImportResolutions } from "../../shared/schemas/students";
import type { PaymentPermissions } from "../../shared/paymentPermissions";

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

  // B-06c (EXECUTION_PLAN.md Step 17): tells the server which org this
  // request acts in when the caller holds more than one membership (Step
  // 16) — AuthContext.tsx persists this under the same key it resolves on
  // load. No entry (never signed in with a multi-org account, or storage
  // cleared) omits the header entirely, which the server treats identically
  // to today: falls back to the earliest-joined membership.
  const activeOrganizationId = localStorage.getItem("activeOrganizationId");

  const resp = await fetch(`/api/v1${path}`, {
    method: options.method || "GET",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(activeOrganizationId ? { "X-Organization-Id": activeOrganizationId } : {}),
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

export type AttendanceStatus = SharedAttendanceStatus;

export function markAttendance(sessionId: string, records: { studentId: string; status: AttendanceStatus }[]) {
  return api<MarkAttendanceResponse>("/billing/attendance", {
    method: "POST",
    body: { sessionId, records },
  });
}

export function cancelSession(sessionId: string) {
  return api<CancelSessionResponse>("/billing/sessions/cancel", { method: "POST", body: { sessionId } });
}

/** Drag-move/resize a single session; server re-checks the tutor conflict under an advisory lock — never a direct client write. */
export function rescheduleSession(sessionId: string, startTime: string, endTime: string) {
  return api<RescheduleSessionResponse>(`/scheduling/sessions/${sessionId}`, {
    method: "PATCH",
    body: { startTime, endTime },
  });
}

/** Recurring-edit scope ("this and future" / "all"): updates the template, then rematerializes its future sessions. */
export function updateTemplateScope(templateId: string, input: UpdateTemplateScopeRequest) {
  return api<UpdateTemplateScopeResponse>(`/scheduling/templates/${templateId}`, {
    method: "PATCH",
    body: input,
  });
}

/** "Find a gap": next open slots for a tutor of the requested duration, scanning declared availability minus existing sessions. */
export function findScheduleGaps(tutorId: string, durationMinutes: number, templateId?: string) {
  const params = new URLSearchParams({ tutorId, durationMinutes: String(durationMinutes) });
  if (templateId) params.set("templateId", templateId);
  return api<FindGapsResponse>(`/scheduling/gaps?${params.toString()}`);
}

export function recordManualPayment(input: Omit<RecordManualPaymentRequest, "idempotencyKey">) {
  return api<RecordManualPaymentResponse>("/billing/payments/manual", {
    method: "POST",
    body: { ...input, idempotencyKey: crypto.randomUUID() },
  });
}

/** Create a free-form invoice with custom line items (rupee amounts). */
export function createInvoice(input: CreateInvoiceRequest) {
  return api<CreateInvoiceResponse>("/billing/invoices", { method: "POST", body: input });
}

/** Staff-recorded wallet top-up (offline/in-person payment credited to the student's prepaid balance). */
export function topUpWallet(input: Omit<TopupRequest, "idempotencyKey">) {
  return api<TopupResponse>("/billing/wallets/topup", {
    method: "POST",
    body: { ...input, idempotencyKey: crypto.randomUUID() },
  });
}

export function voidInvoice(invoiceId: string) {
  return api<VoidInvoiceResponse>(`/billing/invoices/${invoiceId}/void`, { method: "POST" });
}

/** Assign a gap-free invoice number and snapshot tax details (draft → sent). */
export function finalizeInvoice(invoiceId: string) {
  return api<FinalizeInvoiceResponse>(`/billing/invoices/${invoiceId}/finalize`, { method: "POST" });
}

/** Create (or reuse) a Razorpay UPI payment link for the outstanding amount. */
export function createInvoicePaymentLink(invoiceId: string) {
  return api<PaymentLinkResponse>(
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

export function refundPayment(input: Omit<RefundRequest, "idempotencyKey">) {
  return api<RefundResponse>("/billing/refunds", {
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

/** Owner/admin: erase a student's personal data (DPDP right to erasure,
 *  B-11 / EXECUTION_PLAN.md Step 10). Type the student's exact current name
 *  to confirm — re-checked server-side. Irreversible: personal + academic
 *  data is deleted, the financial trail is kept as anonymized rows. */
export function eraseStudent(studentId: string, confirmName: string) {
  return api<EraseStudentResponse>(`/students/${studentId}/erase`, {
    method: "POST",
    body: { confirmName },
  });
}

// Staff invites (Tech Debt #1). Mirrors the parent/student invite calls
// above: owner/admin mints a token carrying a role, the invitee previews it,
// then redeems it to join the org via organization_members (setMembership()
// server-side) instead of a parent_links row or claiming a students row.
export type InvitableStaffRole = "admin" | "tutor" | "frontdesk" | "accountant";

/** Owner/admin: mint a single-use, 7-day invite token for a given staff role. Only the owner can invite 'admin'. */
export function createStaffInvite(role: InvitableStaffRole) {
  return api<{ ok: true; token: string; expiresAt: string; role: InvitableStaffRole }>(
    "/members/invites",
    { method: "POST", body: { role } }
  );
}

/** Preview which org/role an invite grants before redeeming. */
export function previewStaffInvite(token: string) {
  return api<{ ok: true; organizationName: string | null; role: InvitableStaffRole }>(
    `/members/invites/${encodeURIComponent(token)}/preview`
  );
}

/** Redeem an invite: grants the invited role via organization_members. */
export function redeemStaffInvite(token: string) {
  return api<{ ok: true; organizationId: string; role: InvitableStaffRole }>("/members/invites/redeem", {
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

/** Parent-authorized Razorpay payment link to top up a linked child's own wallet (B-05, EXECUTION_PLAN.md Step 7). No manual/self-reported variant exists — see shared/schemas/billing.ts's comment on why. 422s `gateway_not_connected` until the org's Razorpay is live. */
export function topUpWalletAsParent(studentId: string, amountPaise: number) {
  return api<WalletTopupLinkResponse>("/billing/wallets/topup-link", {
    method: "POST",
    body: { studentId, amountPaise },
  });
}

/** Ensures a class channel conversation exists for this batch and refreshes it to the current enrolled roster (server-side — needs the student/parent-link lookup RLS doesn't grant clients). */
export function ensureClassChannel(templateId: string) {
  return api<EnsureClassChannelResponse>(`/inbox/class-channels/${templateId}/ensure`, { method: "POST" });
}

// D-05 (EXECUTION_PLAN.md Step 19): a parent's per-student payment
// permissions (self-pay toggle, spending limit, allowed methods). Staff
// (owner/admin) or the linked parent may read/write; the underlying table
// is select-only via RLS, so these two routes are the only write path.
export function getStudentPaymentPermissions(studentId: string) {
  return api<{ ok: true } & PaymentPermissions>(`/students/${studentId}/payment-permissions`);
}

export function setStudentPaymentPermissions(studentId: string, input: PaymentPermissions) {
  return api<{ ok: true } & PaymentPermissions>(`/students/${studentId}/payment-permissions`, {
    method: "PUT",
    body: input,
  });
}

// Booking-request approval (EXECUTION_PLAN.md Step 5). Not under
// /scheduling — session_requests is its own resource, distinct from the
// enrollments/sessions it eventually creates on acceptance.
export interface BookingRequestRow {
  id: string;
  status: "pending" | "countered" | "accepted" | "declined";
  notes: string | null;
  response_note: string | null;
  created_at: string;
  responded_at: string | null;
  student_id: string;
  template_id: string | null;
  tutor_id: string | null;
  requested_start_time: string | null;
  requested_end_time: string | null;
  proposed_template_id: string | null;
  proposed_start_time: string | null;
  proposed_end_time: string | null;
  requested_by_user_id: string;
  student_name: string | null;
  template_name: string | null;
  tutor_name: string | null;
  proposed_template_name: string | null;
  requested_by_name: string | null;
}

export function listBookingRequests(status?: string) {
  return api<{ ok: true; requests: BookingRequestRow[] }>(`/session-requests${status ? `?status=${status}` : ""}`);
}

export function acceptBookingRequest(requestId: string) {
  return api<{ ok: true }>(`/session-requests/${requestId}/accept`, { method: "POST" });
}

export function declineBookingRequest(requestId: string, responseNote?: string) {
  return api<{ ok: true }>(`/session-requests/${requestId}/decline`, { method: "POST", body: { responseNote } });
}

export function proposeBookingAlternative(
  requestId: string,
  input: { proposedTemplateId: string; responseNote?: string } | { proposedStartTime: string; proposedEndTime: string; responseNote?: string }
) {
  return api<{ ok: true }>(`/session-requests/${requestId}/propose`, { method: "POST", body: input });
}

/**
 * Creates the caller's organization with a real, user-chosen name (Epic
 * 14.5's onboarding rebuild — previously only auto-called by
 * AuthContext.loadUser() with a hardcoded "<name>'s Tutoring" default). A 409
 * `already_member` is a benign race (e.g. AuthContext's own auto-bootstrap
 * effect winning first) rather than a real failure — the caller should just
 * re-resolve organizationId via checkAuth() either way, so this resolves
 * `{ conflict: true }` instead of throwing.
 */
export async function bootstrapOrganization(
  organizationName: string
): Promise<{ organizationId: string | null; conflict: boolean }> {
  try {
    const result = await api<{ organizationId: string }>("/members/bootstrap", {
      method: "POST",
      body: { organizationName },
    });
    return { organizationId: result.organizationId, conflict: false };
  } catch (err: any) {
    if (err?.code === "already_member") return { organizationId: null, conflict: true };
    throw err;
  }
}

export function getSubscription() {
  return api<SubscriptionResponse>("/subscription");
}

export function checkoutSubscription(plan: PlanId) {
  return api<CheckoutResponse>("/subscription/checkout", { method: "POST", body: { plan } });
}

export function listOrgsForAdmin() {
  return api<ListOrgsResponse>("/admin/orgs");
}

export function setOrgFeatureFlag(orgId: string, key: string, enabled: boolean) {
  return api<{ ok: true }>(`/admin/orgs/${orgId}/feature-flags`, { method: "PUT", body: { key, enabled } });
}

export interface OrgMember {
  user_id: string;
  role: string;
  profiles: { name: string | null; email: string | null } | null;
}

export function listOrgMembersForAdmin(orgId: string) {
  return api<{ members: OrgMember[] }>(`/admin/orgs/${orgId}/members`);
}

export function impersonateUser(userId: string) {
  return api<ImpersonateResponse>("/admin/impersonate", { method: "POST", body: { userId } });
}

export interface AuditLogFilters {
  orgId?: string;
  actorId?: string;
  entityType?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

export function listAuditEvents(filters: AuditLogFilters = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(filters)) {
    if (value !== undefined && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return api<ListAuditEventsResponse>(`/audit-log${qs ? `?${qs}` : ""}`);
}

/** Downloads a blob from a GET /api/v1 route and triggers a file save via a
 *  synthetic anchor click — same pattern as downloadInvoicePdf above. */
async function downloadBlob(path: string, fallbackFilename: string): Promise<void> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not signed in");
  const resp = await fetch(`/api/v1${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!resp.ok) {
    const data = await resp.json().catch(() => ({}));
    throw Object.assign(
      new Error((data as any)?.error?.message || `Couldn't download export (${resp.status})`),
      { status: resp.status }
    );
  }
  const blob = await resp.blob();
  const cd = resp.headers.get("content-disposition") || "";
  const match = cd.match(/filename="([^"]+)"/);
  const filename = match?.[1] || fallbackFilename;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function downloadOrgExportJson() {
  return downloadBlob("/org-export/json", "org-export.json");
}

export function downloadOrgExportXlsx() {
  return downloadBlob("/org-export/xlsx", "org-export.xlsx");
}

export function offboardOrganization(confirmOrgName: string) {
  return api<OffboardResponse>("/org-export/offboard", { method: "POST", body: { confirmOrgName } });
}

// Bulk import (EXECUTION_PLAN.md Step 6, B-09). Both calls are multipart
// (a real file, not JSON), same reason uploadDocument() can't use api().
async function multipartRequest<T>(path: string, form: FormData): Promise<T> {
  const { data: { session } } = await supabase.auth.getSession();
  const token = session?.access_token;
  if (!token) throw new Error("Not signed in");
  const resp = await fetch(`/api/v1${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  });
  const data = await resp.json().catch(() => ({}));
  if (!resp.ok) {
    throw Object.assign(new Error((data as any)?.error?.message || `Request failed (${resp.status})`), { status: resp.status, code: (data as any)?.error?.code });
  }
  return data as T;
}

/** Uploads a file and gets back its detected headers, a small sample, and a best-guess column mapping — no rows are parsed against student fields yet. */
export function inspectStudentImport(file: File) {
  const form = new FormData();
  form.append("file", file);
  return multipartRequest<BulkImportInspectResponse>("/students/import/inspect", form);
}

/** Dry-run (commit=false) or actually create students (commit=true). The same file is resent both times — the server keeps no state between calls. `resolutions` is only meaningful on commit: keyed by rowIndex, "import" to create a flagged duplicate anyway. */
export function runStudentImport(input: {
  file: File;
  mapping: (ImportField | null)[];
  commit: boolean;
  resolutions?: BulkImportResolutions;
}) {
  const form = new FormData();
  form.append("file", input.file);
  form.append("mapping", JSON.stringify(input.mapping));
  form.append("commit", String(input.commit));
  if (input.resolutions) form.append("resolutions", JSON.stringify(input.resolutions));
  return multipartRequest<BulkImportPreviewResponse | BulkImportCommitResponse>("/students/import", form);
}
