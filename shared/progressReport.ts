// B-12 (MASTER_PLAN.md §4 / EXECUTION_PLAN.md Step 22): monthly progress-report
// PDF. Pure, Zod-free logic (same convention as shared/payoutSettings.ts /
// shared/cancellationPolicy.ts) — parsing the "YYYY-MM" query param into a
// concrete date range, and turning a list of attendance_records rows into a
// summary, are both plain data-in-data-out functions with no IO, so they're
// unit-tested directly rather than only through the route.

export interface MonthRange {
  /** Inclusive start, "YYYY-MM-DD". */
  start: string;
  /** Exclusive end (first day of the following month), "YYYY-MM-DD". */
  end: string;
}

/**
 * Parses a "YYYY-MM" string into a [start, end) date range. Returns null for
 * anything malformed (wrong shape, month out of 1-12) rather than guessing —
 * the route turns a null into a 422, not a best-effort report.
 */
export function resolveMonthRange(month: string): MonthRange | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const monthNum = Number(match[2]); // 1-12
  if (monthNum < 1 || monthNum > 12) return null;
  const start = new Date(Date.UTC(year, monthNum - 1, 1));
  const end = new Date(Date.UTC(year, monthNum, 1)); // rolls over to Jan of next year for December, which is correct
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

export type AttendanceStatus = "present" | "absent" | "late" | "excused";

export interface AttendanceSummary {
  present: number;
  absent: number;
  late: number;
  excused: number;
  /** Sessions attendance was actually judged against (excludes excused, same convention as an unexcused-absence-only rate). */
  countedTotal: number;
  /** 0-100. Late still counts as attended; excused is dropped from the denominator entirely, not held against the student. Defaults to 100 (no data yet, same convention as src/lib/studentStory.ts's computeHeaderStats) rather than 0 or NaN. */
  attendanceRatePct: number;
}

/** Aggregates a period's attendance_records rows (status only) into the report's summary block. */
export function computeAttendanceSummary(records: { status: AttendanceStatus }[]): AttendanceSummary {
  const present = records.filter((r) => r.status === "present").length;
  const absent = records.filter((r) => r.status === "absent").length;
  const late = records.filter((r) => r.status === "late").length;
  const excused = records.filter((r) => r.status === "excused").length;
  const countedTotal = present + absent + late;
  const attendanceRatePct = countedTotal > 0 ? Math.round(((present + late) / countedTotal) * 100) : 100;
  return { present, absent, late, excused, countedTotal, attendanceRatePct };
}
