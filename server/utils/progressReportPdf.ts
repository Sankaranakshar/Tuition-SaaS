// Server-side monthly progress-report PDF composer (B-12, EXECUTION_PLAN.md
// Step 22). Pure: takes plain input, returns a Buffer — same discipline as
// invoicePdf.ts/payoutStatementPdf.ts, so the route stays a thin
// authorization + fetch shell.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import type { AttendanceSummary } from "../../shared/progressReport.ts";

export interface ProgressReportOrg {
  name: string;
  address?: string | null;
  phone?: string | null;
  email?: string | null;
}

export interface ProgressReportStudent {
  name: string;
  parentName?: string | null;
}

export interface ProgressReportAssessment {
  title?: string | null;
  type?: string | null;
  date?: string | Date | null;
  score?: number | null;
  totalScore?: number | null;
  feedback?: string | null;
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

/** "2026-09" plus the range from resolveMonthRange -> "September 2026", using
 *  the range's own start date rather than re-parsing the raw query string. */
export function formatMonthLabel(monthStart: string): string {
  const parsed = readDate(monthStart);
  if (!parsed) return monthStart;
  return parsed.toLocaleDateString("en-IN", { month: "long", year: "numeric", timeZone: "UTC" });
}

/**
 * Compose the progress-report PDF. Returns a Node Buffer of the encoded PDF.
 * One page, black-on-white, matching invoicePdf.ts's spare layout: an
 * attendance summary block always renders (attendance is always tracked),
 * the assessments table renders an empty-state line when there is nothing
 * graded yet for the period — expected today, since no UI exists yet to
 * grade an assessment (only homework assignment, which carries no score;
 * see EXECUTION_PLAN.md Step 22's scoping note).
 */
export function renderProgressReportPdf(input: {
  org: ProgressReportOrg;
  student: ProgressReportStudent;
  monthLabel: string;
  attendance: AttendanceSummary;
  assessments: ProgressReportAssessment[];
}): Buffer {
  const { org, student, monthLabel, attendance, assessments } = input;
  const doc = new jsPDF({ unit: "pt", format: "a4" });

  const pageWidth = doc.internal.pageSize.getWidth();
  const marginX = 40;
  let cursorY = 48;

  // Header — org name left, "PROGRESS REPORT" label right.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(org.name, marginX, cursorY);

  doc.setFontSize(16);
  doc.setTextColor(60);
  doc.text("PROGRESS REPORT", pageWidth - marginX, cursorY, { align: "right" });
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

  cursorY += 8;

  // Student block (left) / period (right).
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(student.name, marginX, cursorY);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  if (student.parentName) {
    doc.text(`Parent/guardian: ${student.parentName}`, marginX, cursorY + 14);
  }

  doc.setFont("helvetica", "bold");
  doc.text(`Period: ${monthLabel}`, pageWidth - marginX, cursorY, { align: "right" });
  doc.setFont("helvetica", "normal");

  cursorY += 36;

  // Attendance summary.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Attendance", marginX, cursorY);
  cursorY += 16;

  autoTable(doc, {
    startY: cursorY,
    margin: { left: marginX, right: marginX },
    head: [["Present", "Late", "Absent", "Excused", "Attendance rate"]],
    body: [[
      String(attendance.present),
      String(attendance.late),
      String(attendance.absent),
      String(attendance.excused),
      `${attendance.attendanceRatePct}%`,
    ]],
    styles: { font: "helvetica", fontSize: 10, cellPadding: 6, halign: "center" },
    headStyles: { fillColor: [30, 41, 59], textColor: 255 },
  });

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cursorY = ((doc as any).lastAutoTable?.finalY ?? cursorY + 40) + 24;

  // Academic performance.
  doc.setFont("helvetica", "bold");
  doc.setFontSize(11);
  doc.text("Academic performance", marginX, cursorY);
  cursorY += 16;

  if (assessments.length === 0) {
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(120);
    doc.text("No graded assessments recorded for this period.", marginX, cursorY);
    doc.setTextColor(0);
  } else {
    autoTable(doc, {
      startY: cursorY,
      margin: { left: marginX, right: marginX },
      head: [["Date", "Assessment", "Score", "Feedback"]],
      body: assessments.map((a) => [
        formatDate(a.date),
        a.title || a.type || "—",
        a.score != null ? `${a.score} / ${a.totalScore ?? 100}` : "—",
        a.feedback || "—",
      ]),
      styles: { font: "helvetica", fontSize: 9, cellPadding: 6 },
      headStyles: { fillColor: [30, 41, 59], textColor: 255 },
      columnStyles: {
        0: { cellWidth: 70 },
        2: { cellWidth: 60, halign: "center" },
      },
    });
  }

  // Footer.
  doc.setFontSize(9);
  doc.setTextColor(120);
  doc.text(
    "This is a computer-generated document. For questions about this report, contact the tuition center.",
    marginX,
    doc.internal.pageSize.getHeight() - 32,
  );

  return Buffer.from(doc.output("arraybuffer"));
}
