// Pure derivations for the Schedule workspace (REDESIGN §6.1, Stage 3 Epic
// 15). No React, no Supabase reads — every function takes plain data (and an
// explicit `now`/clock where relevant) so the whole grid-math/conflict/
// layout core is unit-testable. src/pages/Schedule.tsx is the only place
// these get wired to live pointer events and Realtime data.

export interface ScheduleSession {
  id: string;
  tutorId: string;
  templateId?: string | null;
  startTime: string; // ISO
  endTime: string; // ISO
  status?: "scheduled" | "completed" | "cancelled" | "no_show";
}

export interface TutorAvailabilityWindow {
  dayOfWeek: number; // 0 (Sun) - 6 (Sat)
  startTime: string; // "HH:MM" or "HH:MM:SS"
  endTime: string;
}

// ---- Week-grid time math ----------------------------------------------

/** Minutes elapsed since local midnight of the same day as `date`. */
export function minutesSinceMidnight(date: Date): number {
  return date.getHours() * 60 + date.getMinutes();
}

/** Snap a minute offset to the nearest `step`-minute increment (default 15). */
export function snapMinutes(minutes: number, step = 15): number {
  return Math.round(minutes / step) * step;
}

/** Convert a pixel offset within a day column into a Date, snapped to `step` minutes. */
export function pixelOffsetToTime(dayStart: Date, offsetPx: number, pxPerMinute: number, step = 15): Date {
  const rawMinutes = offsetPx / pxPerMinute;
  const snapped = snapMinutes(rawMinutes, step);
  const result = new Date(dayStart);
  result.setHours(0, 0, 0, 0);
  result.setMinutes(snapped);
  return result;
}

/** Convert a time-of-day into a pixel offset within its day column. */
export function timeToPixelOffset(date: Date, pxPerMinute: number): number {
  return minutesSinceMidnight(date) * pxPerMinute;
}

// ---- Overlap layout (side-by-side columns for concurrent sessions) ----

export interface SessionLayout {
  id: string;
  column: number; // 0-indexed column within the cluster
  columns: number; // total columns in this cluster (for width = 1/columns)
}

/**
 * Classic interval-partitioning layout: sessions overlapping in time within
 * the same day share a cluster and are laid out side by side. Sessions in
 * different, non-overlapping clusters each get the full column width.
 */
export function layoutOverlappingSessions(sessions: ScheduleSession[]): SessionLayout[] {
  const sorted = [...sessions].sort(
    (a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime()
  );

  const result: SessionLayout[] = [];

  const flushCluster = (cluster: ScheduleSession[]) => {
    if (cluster.length === 0) return;
    // Greedy column assignment: each session takes the first column whose
    // last-assigned session has already ended.
    const columnEnds: number[] = [];
    const assignment = new Map<string, number>();
    for (const s of cluster) {
      const start = new Date(s.startTime).getTime();
      let col = columnEnds.findIndex((end) => end <= start);
      if (col === -1) {
        col = columnEnds.length;
        columnEnds.push(0);
      }
      columnEnds[col] = new Date(s.endTime).getTime();
      assignment.set(s.id, col);
    }
    const totalColumns = columnEnds.length;
    for (const s of cluster) {
      result.push({ id: s.id, column: assignment.get(s.id)!, columns: totalColumns });
    }
  };

  let cluster: ScheduleSession[] = [];
  let clusterMaxEnd = -Infinity;
  for (let i = 0; i < sorted.length; i++) {
    const s = sorted[i];
    const start = new Date(s.startTime).getTime();
    if (cluster.length === 0 || start < clusterMaxEnd) {
      cluster.push(s);
      clusterMaxEnd = Math.max(clusterMaxEnd, new Date(s.endTime).getTime());
    } else {
      flushCluster(cluster);
      cluster = [s];
      clusterMaxEnd = new Date(s.endTime).getTime();
    }
  }
  flushCluster(cluster);
  return result;
}

// ---- Client-side conflict pre-check (optimistic UI only) --------------

/**
 * Same range-overlap rule as the server's checkTutorConflictAndInsert
 * (server/routes/scheduling.ts) — used only for instant UI feedback before
 * the round trip. Never authoritative: the server re-checks under an
 * advisory lock and is the only thing allowed to actually write.
 */
export function checkClientSideConflict(
  candidate: { tutorId: string; startTime: string; endTime: string },
  existingSessions: ScheduleSession[],
  excludeSessionId?: string
): boolean {
  const start = new Date(candidate.startTime).getTime();
  const end = new Date(candidate.endTime).getTime();
  return existingSessions.some((s) => {
    if (s.id === excludeSessionId) return false;
    if (s.tutorId !== candidate.tutorId) return false;
    if (s.status !== "scheduled") return false;
    const exStart = new Date(s.startTime).getTime();
    const exEnd = new Date(s.endTime).getTime();
    return start < exEnd && end > exStart;
  });
}

// ---- Availability overlay -----------------------------------------------

/**
 * True when `slot` falls at least partly outside every availability window
 * declared for its day of week — used to trigger the one-time "Outside your
 * hours. Book anyway?" prompt (REDESIGN §6.1). No availability rows at all
 * for a tutor means "no stated hours", which is treated as always available
 * (nothing to dim against) rather than always outside.
 */
export function isOutsideAvailability(
  slot: { startTime: string; endTime: string },
  availability: TutorAvailabilityWindow[]
): boolean {
  if (availability.length === 0) return false;

  const start = new Date(slot.startTime);
  const end = new Date(slot.endTime);
  const dayWindows = availability.filter((a) => a.dayOfWeek === start.getDay());
  if (dayWindows.length === 0) return true;

  const startMinutes = minutesSinceMidnight(start);
  const endMinutes = minutesSinceMidnight(end);

  return !dayWindows.some((w) => {
    const [wStartH, wStartM] = w.startTime.split(":").map(Number);
    const [wEndH, wEndM] = w.endTime.split(":").map(Number);
    const windowStart = wStartH * 60 + wStartM;
    const windowEnd = wEndH * 60 + wEndM;
    return startMinutes >= windowStart && endMinutes <= windowEnd;
  });
}

// ---- Class template creation (wizard) ------------------------------------

export type ScheduleClassType = "BATCH" | "ONE_ON_ONE" | "CRASH_COURSE";
export type SchedulePricingModel = "PER_SESSION" | "MONTHLY";

export interface ClassTemplateWizardInput {
  organizationId: string;
  tutorId: string;
  courseId: string;
  courseName?: string | null;
  classType: ScheduleClassType;
  pricingModel: SchedulePricingModel;
  feeAmount: number;
  capacity: number;
  daysOfWeek: number[];
  startHour: number;
  startMinute: number;
  durationMinutes: number;
  isOnline: boolean;
  roomNumber?: string | null;
  studentIds: string[];
}

export interface ClassTemplatePayload {
  organization_id: string;
  course_id: string;
  tutor_id: string;
  name: string;
  type: ScheduleClassType;
  pricing_model: SchedulePricingModel;
  fee_amount: number;
  capacity: number;
  days_of_week: number[];
  start_hour: number;
  start_minute: number;
  duration_minutes: number;
  is_online: boolean;
  room_number: string | null;
  student_ids: string[];
}

/**
 * Builds the class_templates insert row from wizard state (extracted from
 * the inline construction Calendar.tsx used to do). class_templates.name is
 * not-null in the schema with no dedicated name field in the original
 * design, so it's derived from the selected course, falling back to the
 * class type label if the course lookup comes back empty.
 */
export function buildClassTemplatePayload(input: ClassTemplateWizardInput): ClassTemplatePayload {
  return {
    organization_id: input.organizationId,
    course_id: input.courseId,
    tutor_id: input.tutorId,
    name: input.courseName || input.classType,
    type: input.classType,
    pricing_model: input.pricingModel,
    fee_amount: input.feeAmount,
    capacity: input.classType === "ONE_ON_ONE" ? 1 : input.capacity,
    days_of_week: input.daysOfWeek,
    start_hour: input.startHour,
    start_minute: input.startMinute,
    duration_minutes: input.durationMinutes,
    is_online: input.isOnline,
    room_number: input.roomNumber || null,
    student_ids: input.studentIds,
  };
}
