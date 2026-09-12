// Pure date-range logic for tutor leave requests (B-13, EXECUTION_PLAN.md
// Step 23). Kept separate from shared/schemas/leave.ts (which only checks
// shape) so the end>=start business rule -- also enforced by the migration's
// check constraint, as defense in depth -- has one place to unit-test
// without a database, same split as shared/progressReport.ts's
// resolveMonthRange vs its zod schema.

export function isValidLeaveRange(startDate: string, endDate: string): boolean {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return end.getTime() >= start.getTime();
}

/** [inclusive, exclusive) timestamp bounds covering every session on
 *  startDate through endDate, both full calendar days -- what
 *  server/routes/leave.ts's affected-sessions query filters class_sessions
 *  against. Caller must validate the range with isValidLeaveRange first. */
export function leaveDateRangeToTimestampBounds(startDate: string, endDate: string): { start: string; end: string } {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  end.setUTCDate(end.getUTCDate() + 1);
  return { start: start.toISOString(), end: end.toISOString() };
}
