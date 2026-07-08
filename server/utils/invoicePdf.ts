// Server-side invoice PDF composer (E6.5). Pure: takes plain input, returns a
// Buffer. No Firestore, no request/response — so it is fully unit-testable and
// the route stays a thin authorization + fetch shell.
//
// Money is integer paise everywhere; rupee floats are legacy tolerated for
// legacy invoices that predate the paise fields.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export interface InvoicePdfLine {
  description: string;
  quantity?: number;
  amountPaise: number;
}

export interface InvoicePdfInvoice {
  invoiceNumber?: string | null;
  status: string;
  createdAt?: Date | string | null;
  dueDate?: string | null;
  subtotalPaise?: number | null;
  taxPaise?: number | null;
  discountPaise?: number | null;
  totalPaise?: number | null;
  paidPaise?: number | null;
  items?: InvoicePdfLine[] | null;
  gstSnapshot?: {
    legalName?: string | null;
    gstin?: string | null;
    placeOfSupply?: string | null;
  } | null;
  /** Legacy rupee mirrors, used when the paise fields are absent. */
  totalAmount?: number | null;
  subtotal?: number | null;
}

export interface InvoicePdfOrg {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
  gstin?: string | null;
}

export interface InvoicePdfStudent {
  name?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  parentEmail?: string | null;
  address?: string | null;
}

// jsPDF's built-in Helvetica has no glyph for ₹ (U+20B9); rendering it would
// produce a broken character in the output. Standard Indian invoice practice
// is to prefix "Rs." when a rupee-capable font isn't embedded.
const inrNumber = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

function paise(v: number | null | undefined): string {
  return `Rs. ${inrNumber.format((v || 0) / 100)}`;
}

function readDate(d: Date | string | null | undefined): Date | null {
  if (!d) return null;
  if (d instanceof Date) return d;
  const parsed = new Date(d);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatDate(d: Date | string | null | undefined): string {
  const parsed = readDate(d);
  if (!parsed) return "—";
  return parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Resolve invoice money to paise, tolerating the legacy rupee mirror fields
 * present on invoices created before Epic 3. Never trust just one shape.
 */
export function resolveInvoiceTotals(inv: InvoicePdfInvoice) {
  const total = inv.totalPaise ?? Math.round((inv.totalAmount || 0) * 100);
  const subtotal = inv.subtotalPaise ?? Math.round((inv.subtotal ?? inv.totalAmount ?? 0) * 100);
  const tax = inv.taxPaise ?? 0;
  const discount = inv.discountPaise ?? 0;
  const paid = inv.paidPaise ?? 0;
  const outstanding = Math.max(0, total - paid);
  return { subtotal, tax, discount, total, paid, outstanding };
}

/**
 * Compose the invoice PDF. Returns a Node Buffer of the encoded PDF.
 * Layout is deliberately spare — one page, black-on-white, clear totals,
 * GST line only when the org has a GSTIN.
 */
export function renderInvoicePdf(input: {
  invoice: InvoicePdfInvoice;
  org: InvoicePdfOrg;
  student: InvoicePdfStudent;
}): Buffer {
  const { invoice, org, student } = input;
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;
  let cursorY = 48;

  // Header — org name left, "INVOICE" label right.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(org.name, marginX, cursorY);

  doc.setFontSize(20);
  doc.setTextColor(60);
  doc.text("INVOICE", pageWidth - marginX, cursorY, { align: "right" });
  doc.setTextColor(0);

  cursorY += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const orgLines: string[] = [];
  if (org.address) orgLines.push(org.address);
  const contact = [org.phone, org.email].filter(Boolean).join(" · ");
  if (contact) orgLines.push(contact);
  if (org.gstin) orgLines.push(`GSTIN: ${org.gstin}`);
  for (const line of orgLines) {
    doc.text(line, marginX, cursorY);
    cursorY += 13;
  }

  // Invoice meta (right column).
  const metaX = pageWidth - marginX;
  let metaY = 66;
  doc.setFont("helvetica", "bold");
  doc.text(invoice.invoiceNumber || "DRAFT", metaX, metaY, { align: "right" });
  doc.setFont("helvetica", "normal");
  metaY += 14;
  doc.text(`Issued: ${formatDate(invoice.createdAt)}`, metaX, metaY, { align: "right" });
  if (invoice.dueDate) {
    metaY += 13;
    doc.text(`Due: ${formatDate(invoice.dueDate)}`, metaX, metaY, { align: "right" });
  }
  metaY += 13;
  doc.text(`Status: ${invoice.status.replace("_", " ")}`, metaX, metaY, { align: "right" });

  cursorY = Math.max(cursorY, metaY) + 20;

  // Bill-to block.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Bill to", marginX, cursorY);
  cursorY += 14;
  doc.setFont("helvetica", "normal");
  const billLines: string[] = [];
  if (student.parentName) billLines.push(student.parentName);
  if (student.name) billLines.push(`Student: ${student.name}`);
  if (student.address) billLines.push(student.address);
  const parentContact = [student.parentPhone, student.parentEmail].filter(Boolean).join(" · ");
  if (parentContact) billLines.push(parentContact);
  if (billLines.length === 0) billLines.push("—");
  for (const line of billLines) {
    doc.text(line, marginX, cursorY);
    cursorY += 13;
  }

  if (invoice.gstSnapshot?.placeOfSupply) {
    cursorY += 4;
    doc.text(`Place of supply: ${invoice.gstSnapshot.placeOfSupply}`, marginX, cursorY);
    cursorY += 13;
  }

  cursorY += 12;

  // Line items.
  const items = invoice.items && invoice.items.length > 0
    ? invoice.items
    : [{ description: "Tuition fees", quantity: 1, amountPaise: invoice.totalPaise || Math.round((invoice.totalAmount || 0) * 100) }];

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    head: [["Description", "Qty", "Amount"]],
    body: items.map((i) => [
      i.description,
      String(i.quantity ?? 1),
      paise(i.amountPaise * (i.quantity ?? 1)),
    ]),
    styles: { font: "helvetica", fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: {
      1: { halign: "right", cellWidth: 50 },
      2: { halign: "right", cellWidth: 100 },
    },
  });

  const totals = resolveInvoiceTotals(invoice);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const afterTable = (doc as any).lastAutoTable?.finalY ?? cursorY + 40;
  let totalsY = afterTable + 20;
  const totalsX = pageWidth - marginX;
  const labelX = totalsX - 130;

  doc.setFontSize(10);
  doc.setFont("helvetica", "normal");
  const row = (label: string, value: string) => {
    doc.text(label, labelX, totalsY);
    doc.text(value, totalsX, totalsY, { align: "right" });
    totalsY += 14;
  };
  row("Subtotal", paise(totals.subtotal));
  if (totals.discount > 0) row("Discount", `− ${paise(totals.discount)}`);
  if (totals.tax > 0) row("Tax", paise(totals.tax));

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  row("Total", paise(totals.total));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  if (totals.paid > 0) row("Paid", paise(totals.paid));
  if (totals.outstanding > 0 || totals.paid > 0) {
    doc.setFont("helvetica", "bold");
    row("Outstanding", paise(totals.outstanding));
    doc.setFont("helvetica", "normal");
  }

  // Footer.
  totalsY += 30;
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    "This is a computer-generated document. For questions about this invoice, contact the tuition center.",
    marginX,
    doc.internal.pageSize.getHeight() - 32,
  );

  return Buffer.from(doc.output("arraybuffer"));
}
