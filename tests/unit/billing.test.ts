import { describe, it, expect } from "vitest";
import crypto from "crypto";
import { applyPayment } from "../../server/utils/invoiceStatus.ts";
import { formatInvoiceNumber } from "../../server/utils/invoiceNumber.ts";
import { verifyWebhookSignature } from "../../server/utils/razorpay.ts";

describe("invoice status machine (applyPayment)", () => {
  it("marks paid when the payment covers the total", () => {
    const r = applyPayment({ status: "sent", totalPaise: 300000, paidPaise: 0 }, 300000);
    expect(r.status).toBe("paid");
    expect(r.paidPaise).toBe(300000);
    expect(r.overpaidPaise).toBe(0);
    expect(r.fullyPaid).toBe(true);
  });

  it("accumulates partial payments without losing paise", () => {
    const first = applyPayment({ status: "unpaid", totalPaise: 300000, paidPaise: 0 }, 100000);
    expect(first.status).toBe("partially_paid");
    expect(first.paidPaise).toBe(100000);
    const second = applyPayment({ status: "partially_paid", totalPaise: 300000, paidPaise: first.paidPaise }, 200000);
    expect(second.status).toBe("paid");
    expect(second.paidPaise).toBe(300000);
  });

  it("caps paid at total and reports the overpayment separately", () => {
    const r = applyPayment({ status: "sent", totalPaise: 300000, paidPaise: 0 }, 350000);
    expect(r.paidPaise).toBe(300000);
    expect(r.overpaidPaise).toBe(50000);
    expect(r.status).toBe("paid");
  });

  it("refuses to pay a void invoice", () => {
    expect(() => applyPayment({ status: "void", totalPaise: 300000, paidPaise: 0 }, 100000)).toThrow(/void/i);
  });

  it("refuses to pay an already-paid invoice", () => {
    expect(() => applyPayment({ status: "paid", totalPaise: 300000, paidPaise: 300000 }, 100)).toThrow(/cannot take a payment/i);
  });

  it("rejects non-positive or non-integer amounts", () => {
    expect(() => applyPayment({ status: "sent", totalPaise: 300000, paidPaise: 0 }, 0)).toThrow(/positive integer/i);
    expect(() => applyPayment({ status: "sent", totalPaise: 300000, paidPaise: 0 }, 12.5)).toThrow(/positive integer/i);
  });
});

describe("invoice numbering", () => {
  it("formats INV-{ORG}-{YYYY}-{seq} with zero-padded sequence", () => {
    expect(formatInvoiceNumber("acme", 2026, 7)).toBe("INV-ACME-2026-0007");
    expect(formatInvoiceNumber("acme", 2026, 1234)).toBe("INV-ACME-2026-1234");
  });

  it("sanitizes the slug and falls back to ORG", () => {
    expect(formatInvoiceNumber("A/B c-2!", 2026, 1)).toBe("INV-ABC2-2026-0001");
    expect(formatInvoiceNumber("", 2026, 1)).toBe("INV-ORG-2026-0001");
  });
});

describe("razorpay webhook signature", () => {
  const secret = "whsec_test_123";
  const body = JSON.stringify({ event: "payment_link.paid", payload: {} });
  const sign = (b: string, s: string) => crypto.createHmac("sha256", s).update(b).digest("hex");

  it("accepts a correctly signed body", () => {
    expect(verifyWebhookSignature(body, sign(body, secret), secret)).toBe(true);
  });

  it("rejects a tampered body", () => {
    expect(verifyWebhookSignature(body + " ", sign(body, secret), secret)).toBe(false);
  });

  it("rejects a wrong secret", () => {
    expect(verifyWebhookSignature(body, sign(body, "other"), secret)).toBe(false);
  });

  it("rejects an empty signature or secret", () => {
    expect(verifyWebhookSignature(body, "", secret)).toBe(false);
    expect(verifyWebhookSignature(body, sign(body, secret), "")).toBe(false);
  });
});
