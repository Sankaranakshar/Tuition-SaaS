// The invoice status machine (blueprint 5.2, 8.2). One pure function so the
// manual-payment route and the gateway webhook apply payments identically and
// the logic is unit-testable without Firestore. All money is integer paise.

export type InvoiceStatus =
  | "draft"
  | "sent"
  | "unpaid"
  | "partially_paid"
  | "paid"
  | "void";

/** Statuses that still owe money and can receive a payment. */
const PAYABLE = new Set<InvoiceStatus>(["draft", "sent", "unpaid", "partially_paid"]);

export interface InvoiceMoney {
  status: InvoiceStatus;
  totalPaise: number;
  paidPaise: number;
}

export interface PaymentApplication {
  paidPaise: number;
  status: InvoiceStatus;
  /** Amount that exceeded the invoice total, to be returned as wallet credit. */
  overpaidPaise: number;
  fullyPaid: boolean;
}

/**
 * Apply a payment of `amountPaise` to an invoice. Returns the new paid total
 * and status. Overpayment is reported separately (caller credits the wallet);
 * the invoice never records more than its total as paid.
 */
export function applyPayment(inv: InvoiceMoney, amountPaise: number): PaymentApplication {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw Object.assign(new Error("Payment amount must be a positive integer (paise)"), {
      status: 422,
      code: "invalid_amount",
    });
  }
  if (inv.status === "void") {
    throw Object.assign(new Error("Invoice is void"), { status: 422, code: "invoice_void" });
  }
  if (!PAYABLE.has(inv.status)) {
    throw Object.assign(new Error(`Invoice in status "${inv.status}" cannot take a payment`), {
      status: 422,
      code: "not_payable",
    });
  }

  const prospective = inv.paidPaise + amountPaise;
  const overpaidPaise = Math.max(0, prospective - inv.totalPaise);
  const paidPaise = Math.min(prospective, inv.totalPaise);
  const fullyPaid = paidPaise >= inv.totalPaise;
  const status: InvoiceStatus = fullyPaid ? "paid" : "partially_paid";

  return { paidPaise, status, overpaidPaise, fullyPaid };
}
