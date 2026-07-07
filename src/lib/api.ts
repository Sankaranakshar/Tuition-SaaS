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
