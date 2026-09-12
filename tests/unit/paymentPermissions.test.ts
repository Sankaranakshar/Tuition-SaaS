import { describe, it, expect } from "vitest";
import { resolvePaymentPermissions, DEFAULT_PAYMENT_PERMISSIONS } from "../../shared/paymentPermissions.ts";

describe("resolvePaymentPermissions (D-05, EXECUTION_PLAN.md Step 19)", () => {
  it("resolves to the closed-by-default fallback when no row exists", () => {
    expect(resolvePaymentPermissions(null)).toEqual(DEFAULT_PAYMENT_PERMISSIONS);
    expect(resolvePaymentPermissions(undefined)).toEqual(DEFAULT_PAYMENT_PERMISSIONS);
  });

  it("carries through a real row's values", () => {
    expect(
      resolvePaymentPermissions({
        self_pay_allowed: true,
        spending_limit_paise: 50000,
        allowed_payment_methods: ["wallet"],
      })
    ).toEqual({ selfPayAllowed: true, spendingLimitPaise: 50000, allowedPaymentMethods: ["wallet"] });
  });

  it("treats a null spending limit as no limit, not zero", () => {
    expect(
      resolvePaymentPermissions({ self_pay_allowed: true, spending_limit_paise: null, allowed_payment_methods: [] })
    ).toEqual({ selfPayAllowed: true, spendingLimitPaise: null, allowedPaymentMethods: [] });
  });

  it("treats a null allowed_payment_methods as empty, not a crash", () => {
    expect(
      resolvePaymentPermissions({ self_pay_allowed: false, spending_limit_paise: null, allowed_payment_methods: null })
    ).toEqual(DEFAULT_PAYMENT_PERMISSIONS);
  });
});
