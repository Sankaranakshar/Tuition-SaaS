// D-05 (MASTER_PLAN.md §5) / EXECUTION_PLAN.md Step 19: per-student
// payment-permissions read, server-only. The pure merge logic lives in
// shared/paymentPermissions.ts (so the enforcement point here and any
// client rendering the same table's rows agree on the closed-by-default
// fallback); this file adds only the DB-touching read, same split as
// server/utils/cancellationPolicy.ts / creditExpiry.ts.
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { resolvePaymentPermissions, DEFAULT_PAYMENT_PERMISSIONS, type PaymentPermissions } from "../../shared/paymentPermissions.ts";

export { DEFAULT_PAYMENT_PERMISSIONS };
export type { PaymentPermissions };

/** Reads a student's payment permissions, defaulting to closed when no row exists. */
export async function getPaymentPermissions(studentId: string): Promise<PaymentPermissions> {
  const { data, error } = await supabaseAdmin
    .from("student_payment_permissions")
    .select("self_pay_allowed, spending_limit_paise, allowed_payment_methods")
    .eq("student_id", studentId)
    .maybeSingle();
  if (error) throw error;
  return resolvePaymentPermissions(data);
}
