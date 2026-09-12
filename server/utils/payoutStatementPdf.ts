// Server-side payout statement PDF composer (B-08, EXECUTION_PLAN.md Step
// 21). Mirrors server/utils/invoicePdf.ts's structure exactly (jsPDF +
// jspdf-autotable, one spare black-on-white page) so the two documents read
// as one family. Pure: plain input in, Buffer out.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { paiseToRupees } from "../../shared/money.ts";

export interface PayoutStatementLine {
  sessionStart: Date | string;
  durationMinutes: number;
  ratePaisePerHour: number;
  amountPaise: number;
}

export interface PayoutStatementPayout {
  periodStart: string;
  periodEnd: string;
  status: string;
  grossPaise: number;
  tdsPercent: number;
  tdsPaise: number;
  netPaise: number;
  paidAt?: Date | string | null;
  createdAt?: Date | string | null;
}

export interface PayoutStatementOrg {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface PayoutStatementTutor {
  name?: string | null;
  email?: string | null;
}

const inrNumber = new Intl.NumberFormat("en-IN", {
  maximumFractionDigits: 2,
  minimumFractionDigits: 0,
});

function paise(v: number | null | undefined): string {
  return `Rs. ${inrNumber.format(paiseToRupees(v || 0))}`;
}

function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const parsed = d instanceof Date ? d : new Date(d);
  return Number.isNaN(parsed.getTime()) ? "—" : parsed.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

export function renderPayoutStatementPdf(input: {
  payout: PayoutStatementPayout;
  org: PayoutStatementOrg;
  tutor: PayoutStatementTutor;
  lines: PayoutStatementLine[];
}): Buffer {
  const { payout, org, tutor, lines } = input;
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;
  let cursorY = 48;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(org.name, marginX, cursorY);

  doc.setFontSize(20);
  doc.setTextColor(60);
  doc.text("PAYOUT STATEMENT", pageWidth - marginX, cursorY, { align: "right" });
  doc.setTextColor(0);

  cursorY += 18;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  const orgLines: string[] = [];
  if (org.address) orgLines.push(org.address);
  const contact = [org.phone, org.email].filter(Boolean).join(" · ");
  if (contact) orgLines.push(contact);
  for (const line of orgLines) {
    doc.text(line, marginX, cursorY);
    cursorY += 13;
  }

  const metaX = pageWidth - marginX;
  let metaY = 66;
  doc.setFont("helvetica", "bold");
  doc.text(`${formatDate(payout.periodStart)} – ${formatDate(payout.periodEnd)}`, metaX, metaY, { align: "right" });
  doc.setFont("helvetica", "normal");
  metaY += 14;
  doc.text(`Issued: ${formatDate(payout.createdAt)}`, metaX, metaY, { align: "right" });
  metaY += 13;
  doc.text(`Status: ${payout.status}`, metaX, metaY, { align: "right" });
  if (payout.paidAt) {
    metaY += 13;
    doc.text(`Paid: ${formatDate(payout.paidAt)}`, metaX, metaY, { align: "right" });
  }

  cursorY = Math.max(cursorY, metaY) + 20;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Paid to", marginX, cursorY);
  cursorY += 14;
  doc.setFont("helvetica", "normal");
  const tutorLines = [tutor.name, tutor.email].filter(Boolean) as string[];
  for (const line of tutorLines.length > 0 ? tutorLines : ["—"]) {
    doc.text(line, marginX, cursorY);
    cursorY += 13;
  }
  cursorY += 12;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    head: [["Session date", "Duration", "Rate", "Amount"]],
    body: lines.map((l) => [
      formatDate(l.sessionStart),
      `${l.durationMinutes} min`,
      `${paise(l.ratePaisePerHour)}/hr`,
      paise(l.amountPaise),
    ]),
    styles: { font: "helvetica", fontSize: 10, cellPadding: 6 },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
    columnStyles: {
      1: { halign: "right", cellWidth: 70 },
      2: { halign: "right", cellWidth: 90 },
      3: { halign: "right", cellWidth: 100 },
    },
  });

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
  row("Gross", paise(payout.grossPaise));
  row(`TDS (${payout.tdsPercent}%)`, `− ${paise(payout.tdsPaise)}`);

  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  row("Net payable", paise(payout.netPaise));
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);

  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    "This is a computer-generated document. For questions about this statement, contact the tuition center.",
    marginX,
    doc.internal.pageSize.getHeight() - 32,
  );

  return Buffer.from(doc.output("arraybuffer"));
}
