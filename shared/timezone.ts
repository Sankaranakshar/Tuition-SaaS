// C-01 (MASTER_PLAN.md §6.3, EXECUTION_PLAN.md Step 25). Pure, Zod-free
// timezone arithmetic (same rule as shared/money.ts and
// shared/creditExpiry.ts — a shared/ file that builds Zod schemas drags Zod
// into the client bundle; this one builds nothing, just Intl calls) so the
// server's session materialization and any client-side display agree on a
// single definition instead of either reading the ambient process timezone.
//
// Everything here takes the zone as an explicit argument. No function reads
// `process.env.TZ`, the host's `Intl.DateTimeFormat().resolvedOptions().timeZone`,
// or any other ambient source — that ambient dependency is the exact defect
// this module exists to remove (MASTER_PLAN.md §6.3: Vercel runs UTC, a dev
// machine runs IST, and the old code silently agreed with whichever one it
// happened to run on).

export const DEFAULT_ORG_TIMEZONE = "Asia/Kolkata";

/** The UTC offset of `zone` at the instant `atUtc`, in minutes (positive
 *  east of UTC — e.g. +330 for IST). Derived from Intl's own zone database
 *  rather than a hand-rolled table, so half-hour offsets (IST) and DST
 *  transitions (zones this schema doesn't use yet, but the helper doesn't
 *  assume their absence) both fall out correctly. */
function offsetMinutesAt(zone: string, atUtc: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(atUtc);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const asIfUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return Math.round((asIfUtc - atUtc.getTime()) / 60_000);
}

/**
 * Builds the correct UTC instant for the wall-clock time
 * `year-month-day hour:minute` as it would read on a clock in `zone`. This
 * is the direct replacement for `new Date(); d.setHours(hour, minute, 0, 0)`,
 * which builds the instant using the *server process's* local zone instead
 * of the org's.
 *
 * Two-pass: the first pass estimates the instant assuming `zone`'s offset at
 * a naive UTC reading of the wall-clock fields, then re-derives the offset
 * at that estimate and corrects. A fixed-offset, single-pass guess can land
 * on the wrong side of a DST transition; India has no DST so both passes
 * agree immediately here, but the function doesn't assume that of `zone`.
 */
export function zonedTimeToUtc(year: number, month: number, day: number, hour: number, minute: number, zone: string): Date {
  const naiveUtc = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const firstPass = naiveUtc - offsetMinutesAt(zone, new Date(naiveUtc)) * 60_000;
  const secondOffset = offsetMinutesAt(zone, new Date(firstPass));
  return new Date(naiveUtc - secondOffset * 60_000);
}

/** `YYYY-MM-DD` for `instant` as a clock in `zone` would read it — the
 *  zone-correct replacement for `getFullYear()/getMonth()/getDate()`, which
 *  read the instant through the server process's local zone instead. */
export function localDateKeyInZone(instant: Date, zone: string): string {
  // en-CA is the one common locale whose short date format is already
  // YYYY-MM-DD, so no field reassembly is needed.
  return new Intl.DateTimeFormat("en-CA", { timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit" }).format(instant);
}

/** The hour (0-23), in `zone`, that a clock would show for `instant` — the
 *  zone-correct replacement for `getHours()`. */
export function hourInZone(instant: Date, zone: string): number {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: zone, hourCycle: "h23", hour: "2-digit" }).format(instant));
}

/** The day of week (0 = Sunday .. 6 = Saturday), in `zone`, for `instant` —
 *  the zone-correct replacement for `getDay()`. Matches the JS `Date#getDay()`
 *  convention already used by `class_templates.days_of_week`. */
export function dayOfWeekInZone(instant: Date, zone: string): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: zone, weekday: "short" }).format(instant);
  const index: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return index[short];
}

/**
 * "Today" as a civil date (year/month/day) in `zone`, returned as a
 * UTC-midnight `Date` used purely as a calendar-date token — never as a
 * real instant. Calendar-date iteration (walking day by day, reading
 * day-of-week) is then ambient-TZ-safe by construction: a UTC-midnight
 * sentinel's `getUTCFullYear/getUTCMonth/getUTCDate/getUTCDay` describe the
 * civil date itself, not any particular timezone's view of an instant, so
 * `.setUTCDate(d.getUTCDate() + 1)` walks calendar days correctly no matter
 * what zone the calling process happens to run in.
 */
export function civilDateSentinelInZone(zone: string, now: Date = new Date()): Date {
  const key = localDateKeyInZone(now, zone);
  const [y, m, d] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

/** `YYYY-MM-DD` for a civil-date sentinel produced by
 *  `civilDateSentinelInZone` (or arithmetic on one). Reads the sentinel's
 *  own UTC fields directly — it already *is* the calendar date, so no zone
 *  argument or conversion is needed here. */
export function civilDateKey(sentinel: Date): string {
  return `${sentinel.getUTCFullYear()}-${String(sentinel.getUTCMonth() + 1).padStart(2, "0")}-${String(sentinel.getUTCDate()).padStart(2, "0")}`;
}
