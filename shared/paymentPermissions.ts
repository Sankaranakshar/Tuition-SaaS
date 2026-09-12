// D-05 (MASTER_PLAN.md §5) / EXECUTION_PLAN.md Step 19: per-student
// parent-controlled payment permissions. Pure, Zod-free logic (same
// convention as shared/cancellationPolicy.ts) so the server's enforcement
// point (server/utils/paymentPermissions.ts) resolves the same "no row =
// closed" default a client reading student_payment_permissions directly via
// RLS would. No platform-wide default (D-05 explicitly rejected an
// age-threshold default) — every field closes/empties, never inferred.
export interface PaymentPermissions {
  selfPayAllowed: boolean;
  spendingLimitPaise: number | null;
  allowedPaymentMethods: ("wallet" | "razorpay_link")[];
}

export const DEFAULT_PAYMENT_PERMISSIONS: PaymentPermissions = {
  selfPayAllowed: false,
  spendingLimitPaise: null,
  allowedPaymentMethods: [],
};

interface RawPaymentPermissionsRow {
  self_pay_allowed?: boolean | null;
  spending_limit_paise?: number | null;
  allowed_payment_methods?: string[] | null;
}

/** Merge a possibly-missing student_payment_permissions row with the closed-by-default fallback. */
export function resolvePaymentPermissions(row: RawPaymentPermissionsRow | null | undefined): PaymentPermissions {
  if (!row) return DEFAULT_PAYMENT_PERMISSIONS;
  return {
    selfPayAllowed: row.self_pay_allowed ?? DEFAULT_PAYMENT_PERMISSIONS.selfPayAllowed,
    spendingLimitPaise: row.spending_limit_paise ?? null,
    allowedPaymentMethods: (row.allowed_payment_methods as PaymentPermissions["allowedPaymentMethods"] | null) ?? [],
  };
}
