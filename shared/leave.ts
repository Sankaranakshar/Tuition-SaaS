// Pure date-range logic for tutor leave requests (B-13, EXECUTION_PLAN.md
// Step 23). Kept separate from shared/schemas/leave.ts (which only checks
// shape) so the end>=start business rule -- also enforced by the migration's
// check constraint, as defense in depth -- has one place to unit-test
// without a database, same split as shared/progressReport.ts's
// resolveMonthRange vs its zod schema.

import { zonedTimeToUtc } from "./timezone.ts";

export function isValidLeaveRange(startDate: string, endDate: string): boolean {
  const start = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return false;
  return end.getTime() >= start.getTime();
}

/** [inclusive, exclusive) timestamp bounds covering every session on
 *  startDate through endDate, both full calendar days *in the org's zone*
 *  -- what server/routes/leave.ts's affected-sessions query filters
 *  class_sessions against. Leave dates are the org's local calendar days, so
 *  the bounds are local midnight on startDate to local midnight the day after
 *  endDate (C-01, shared/timezone.ts). Treating them as UTC days instead
 *  shifted an IST leave to 05:30-05:30 IST, missing that day's 00:00-05:30
 *  sessions and catching the next morning's. Caller must validate the range
 *  with isValidLeaveRange first. */
export function leaveDateRangeToTimestampBounds(startDate: string, endDate: string, zone: string): { start: string; end: string } {
  const [sy, sm, sd] = startDate.split("-").map(Number);
  // Step the civil end date forward a day with UTC arithmetic (a pure
  // calendar walk, no zone involved), then read that day's local midnight.
  const dayAfterEnd = new Date(`${endDate}T00:00:00.000Z`);
  dayAfterEnd.setUTCDate(dayAfterEnd.getUTCDate() + 1);
  const start = zonedTimeToUtc(sy, sm, sd, 0, 0, zone);
  const end = zonedTimeToUtc(dayAfterEnd.getUTCFullYear(), dayAfterEnd.getUTCMonth() + 1, dayAfterEnd.getUTCDate(), 0, 0, zone);
  return { start: start.toISOString(), end: end.toISOString() };
}
