import { describe, it, expect } from "vitest";
import { renderInvoicePdf, resolveInvoiceTotals } from "../../server/utils/invoicePdf.ts";

describe("resolveInvoiceTotals", () => {
  it("prefers paise fields when present", () => {
    const t = resolveInvoiceTotals({
      status: "sent",
      totalPaise: 300000,
      subtotalPaise: 280000,
      taxPaise: 20000,
      paidPaise: 100000,
    });
    expect(t.total).toBe(300000);
    expect(t.subtotal).toBe(280000);
    expect(t.tax).toBe(20000);
    expect(t.paid).toBe(100000);
    expect(t.outstanding).toBe(200000);
  });

  it("falls back to legacy rupee mirrors when paise is absent", () => {
    const t = resolveInvoiceTotals({
      status: "unpaid",
      totalAmount: 1500,
      subtotal: 1500,
    });
    expect(t.total).toBe(150000);
    expect(t.subtotal).toBe(150000);
    expect(t.outstanding).toBe(150000);
  });

  it("never returns a negative outstanding", () => {
    const t = resolveInvoiceTotals({
      status: "paid",
      totalPaise: 100000,
      paidPaise: 120000,
    });
    expect(t.outstanding).toBe(0);
  });
});

describe("renderInvoicePdf", () => {
  const baseInvoice = {
    invoiceNumber: "INV-ACME-2026-0007",
    status: "sent",
    createdAt: new Date("2026-07-01T10:00:00Z"),
    dueDate: "2026-07-15",
    subtotalPaise: 300000,
    totalPaise: 300000,
    taxPaise: 0,
    discountPaise: 0,
    paidPaise: 0,
    items: [
      { description: "Physics batch · July", quantity: 8, amountPaise: 37500 },
    ],
  };
  const org = { name: "Acme Tuition", phone: "+91 90000 00000", gstin: "27ABCDE1234F1Z5" };
  const student = { name: "Priya S.", parentName: "R. Sharma", parentPhone: "+91 98765 43210" };

  it("produces a non-empty valid PDF buffer", () => {
    const buf = renderInvoicePdf({ invoice: baseInvoice, org, student });
    expect(buf.byteLength).toBeGreaterThan(1000);
    expect(buf.slice(0, 5).toString()).toBe("%PDF-");
  });

  it("embeds the invoice number and total in the stream", () => {
    const buf = renderInvoicePdf({ invoice: baseInvoice, org, student });
    // jsPDF interns text as literal strings in the content stream, so a byte
    // scan of the buffer is a reliable smoke test that the composer wrote the
    // fields we asked for.
    const asText = buf.toString("latin1");
    expect(asText).toContain("INV-ACME-2026-0007");
    // ₹ escapes; verify the digit-grouped rupee amount is present in some form.
    expect(asText).toMatch(/3,000/);
    expect(asText).toContain("Acme Tuition");
  });

  it("handles legacy rupee-only invoices without a total-mismatch", () => {
    const legacy = {
      invoiceNumber: "INV-OLD-2025-0001",
      status: "unpaid",
      createdAt: new Date("2025-11-01T10:00:00Z"),
      totalAmount: 4500,
      subtotal: 4500,
      items: [{ description: "Legacy line", amountPaise: 450000 }],
    };
    const buf = renderInvoicePdf({ invoice: legacy, org, student });
    const asText = buf.toString("latin1");
    expect(asText).toMatch(/4,500/);
  });

  it("renders outstanding when partially paid", () => {
    const partial = { ...baseInvoice, status: "partially_paid", paidPaise: 100000 };
    const buf = renderInvoicePdf({ invoice: partial, org, student });
    const asText = buf.toString("latin1");
    expect(asText).toContain("Outstanding");
    expect(asText).toContain("Paid");
    expect(asText).toMatch(/2,000/);
  });
});
