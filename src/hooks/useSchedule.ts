import { useCallback, useEffect, useMemo } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { useRealtimeList } from "./useRealtimeList";
import type { RealtimeMergeConfig } from "./realtimeMerge";
import type { ScheduleSession, TutorAvailabilityWindow } from "../lib/schedule";

// One hook per Schedule data source (REDESIGN §6.1), same shape as
// usePeople.ts/useMoney.ts: each owns its query, bounding, Realtime
// subscription, and error state on top of the shared useRealtimeList
// helper. class_sessions/class_templates/tutor_availability are all in
// the supabase_realtime publication (HANDOFF §16.2, §25.2 for
// tutor_availability specifically — see 20260719100000_realtime_tutor_availability.sql).

export interface ScheduleSessionRow extends ScheduleSession {
  studentIds: string[];
  isOnline: boolean;
  roomNumber?: string | null;
}

export function mapScheduleSessionRow(row: any): ScheduleSessionRow {
  return {
    id: row.id,
    tutorId: row.tutor_id,
    templateId: row.template_id,
    studentIds: row.student_ids || [],
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    isOnline: row.is_online,
    roomNumber: row.room_number,
  };
}

/** Sessions visible in the current week view, bounded to [weekStart, weekEnd). */
export function useScheduleSessions(weekStart: Date, weekEnd: Date) {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const weekStartIso = weekStart.toISOString();
  const weekEndIso = weekEnd.toISOString();

  const load = useCallback(async (): Promise<ScheduleSessionRow[]> => {
    if (!orgId) return [];
    let q = supabase
      .from("class_sessions")
      .select("id, tutor_id, template_id, student_ids, start_time, end_time, status, is_online, room_number")
      .eq("organization_id", orgId)
      .gte("start_time", weekStartIso)
      .lt("start_time", weekEndIso)
      .order("start_time", { ascending: true })
      .limit(500);
    if (user!.role === "tutor") q = q.eq("tutor_id", user!.id);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map(mapScheduleSessionRow);
  }, [orgId, user?.role, user?.id, weekStartIso, weekEndIso]);

  // Realtime filter stays org-scoped (postgres_changes filters can't express
  // a date range or the tutor_id.eq load() applies); belongsToView mirrors
  // both. A session dragged outside [weekStart, weekEnd) — the exact
  // reschedule-out-of-view case this optimization has to get right — drops
  // out of `data` immediately and triggers a refetch rather than guessing
  // whether some other session should now page into view.
  const merge: RealtimeMergeConfig<ScheduleSessionRow> = useMemo(
    () => ({
      mapRow: mapScheduleSessionRow,
      getId: (row) => row.id,
      belongsToView: (raw: any) =>
        raw.start_time >= weekStartIso &&
        raw.start_time < weekEndIso &&
        (user?.role !== "tutor" || raw.tutor_id === user?.id),
      compare: (a, b) => a.startTime.localeCompare(b.startTime),
    }),
    [user?.role, user?.id, weekStartIso, weekEndIso]
  );
  const result = useRealtimeList<ScheduleSessionRow>("schedule", "class_sessions", orgId, load, undefined, merge);
  // useRealtimeList's own mount effect only reruns on [orgId, table], not on
  // `load` — so paging weekStart/weekEnd would otherwise leave the page
  // showing stale (or the initial, possibly empty) week forever. Re-fetch
  // explicitly whenever the visible week actually changes.
  useEffect(() => {
    if (orgId) result.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartIso, weekEndIso]);
  return result;
}

export interface ScheduleTemplate {
  id: string;
  courseId: string | null;
  tutorId: string | null;
  name: string;
  type: "BATCH" | "ONE_ON_ONE" | "CRASH_COURSE";
  capacity: number;
  daysOfWeek: number[];
  startHour: number | null;
  startMinute: number;
  durationMinutes: number;
  studentIds: string[];
}

export function mapClassTemplateRow(row: any): ScheduleTemplate {
  return {
    id: row.id,
    courseId: row.course_id,
    tutorId: row.tutor_id,
    name: row.name,
    type: row.type,
    capacity: row.capacity,
    daysOfWeek: row.days_of_week || [],
    startHour: row.start_hour,
    startMinute: row.start_minute,
    durationMinutes: row.duration_minutes,
    studentIds: row.student_ids || [],
  };
}

const classTemplateMerge: RealtimeMergeConfig<ScheduleTemplate> = {
  mapRow: mapClassTemplateRow,
  getId: (row) => row.id,
};

export function useClassTemplates() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const load = useCallback(async (): Promise<ScheduleTemplate[]> => {
    if (!orgId) return [];
    const { data, error } = await supabase
      .from("class_templates")
      .select("id, course_id, tutor_id, name, type, capacity, days_of_week, start_hour, start_minute, duration_minutes, student_ids")
      .eq("organization_id", orgId)
      .limit(200);
    if (error) throw error;
    return (data || []).map(mapClassTemplateRow);
  }, [orgId]);
  return useRealtimeList<ScheduleTemplate>("schedule", "class_templates", orgId, load, undefined, classTemplateMerge);
}

/**
 * Self-view for a logged-in student/parent (replaces Timetable.tsx). RLS's
 * class_sessions_select policy already scopes rows to
 * `student_user_ids`/`parent_user_ids` containing auth.uid(), so this reads
 * without an organization_id filter — the useRealtimeList `filter` override
 * matches that (mirrors useInbox.ts's per-user notifications hook).
 */
export function useMyScheduleSessions(weekStart: Date, weekEnd: Date) {
  const { user } = useAuth();
  const weekStartIso = weekStart.toISOString();
  const weekEndIso = weekEnd.toISOString();

  const load = useCallback(async (): Promise<ScheduleSessionRow[]> => {
    if (!user?.id) return [];
    const { data, error } = await supabase
      .from("class_sessions")
      .select("id, tutor_id, template_id, student_ids, start_time, end_time, status, is_online, room_number")
      .or(`student_user_ids.cs.{${user.id}},parent_user_ids.cs.{${user.id}}`)
      .gte("start_time", weekStartIso)
      .lt("start_time", weekEndIso)
      .order("start_time", { ascending: true })
      .limit(200);
    if (error) throw error;
    return (data || []).map(mapScheduleSessionRow);
  }, [user?.id, weekStartIso, weekEndIso]);

  // Realtime's postgres_changes filter only supports simple column
  // comparisons, not the array-contains OR this query needs, so this
  // subscribes to every class_sessions change (same refetch-on-any-change
  // tradeoff Timetable.tsx already shipped with, tracked as DEV_PLAN Tech
  // Debt #5) rather than useRealtimeList's org-scoped default, which would
  // be flatly wrong here (there's no orgId in scope, only a user id). RLS is
  // what actually keeps this feed to rows this user is authorized to see;
  // belongsToView re-checks the same array-contains + week bound as `load`
  // as defense in depth and to catch the reschedule-out-of-week case.
  const userId = user?.id;
  const merge: RealtimeMergeConfig<ScheduleSessionRow> = useMemo(
    () => ({
      mapRow: mapScheduleSessionRow,
      getId: (row) => row.id,
      belongsToView: (raw: any) =>
        raw.start_time >= weekStartIso &&
        raw.start_time < weekEndIso &&
        !!userId &&
        ((raw.student_user_ids ?? []).includes(userId) || (raw.parent_user_ids ?? []).includes(userId)),
      compare: (a, b) => a.startTime.localeCompare(b.startTime),
    }),
    [userId, weekStartIso, weekEndIso]
  );
  const result = useRealtimeList<ScheduleSessionRow>(
    "schedule",
    "class_sessions",
    user?.id,
    load,
    "organization_id=neq.00000000-0000-0000-0000-000000000000",
    merge
  );
  // Same fix as useScheduleSessions: force a refetch on week navigation,
  // since useRealtimeList's mount effect doesn't rerun when `load` changes.
  useEffect(() => {
    if (user?.id) result.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartIso, weekEndIso]);
  return result;
}

export function mapTutorAvailabilityRow(row: any): TutorAvailabilityWindow {
  return {
    id: row.id,
    dayOfWeek: row.day_of_week,
    startTime: row.start_time,
    endTime: row.end_time,
  };
}

export function useTutorAvailability(tutorId: string | undefined | null) {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const load = useCallback(async (): Promise<TutorAvailabilityWindow[]> => {
    if (!orgId || !tutorId) return [];
    const { data, error } = await supabase
      .from("tutor_availability")
      .select("id, day_of_week, start_time, end_time")
      .eq("organization_id", orgId)
      .eq("tutor_id", tutorId)
      .limit(50);
    if (error) throw error;
    return (data || []).map(mapTutorAvailabilityRow);
  }, [orgId, tutorId]);
  // The Realtime filter below (tutor_id=eq...) REPLACES the default org
  // filter rather than adding to it (useRealtimeList only applies its
  // org-scoped default when no filter is passed), so belongsToView re-checks
  // organization_id itself — otherwise a same-tutor_id row from a different
  // org (tutor_id is a bare user id, not organization-scoped) could get
  // merged into a view load() would never have returned it in.
  const merge: RealtimeMergeConfig<TutorAvailabilityWindow> = useMemo(
    () => ({
      mapRow: mapTutorAvailabilityRow,
      getId: (row) => row.id!,
      belongsToView: (raw: any) => !!tutorId && !!orgId && raw.tutor_id === tutorId && raw.organization_id === orgId,
    }),
    [orgId, tutorId]
  );
  return useRealtimeList<TutorAvailabilityWindow>(
    "schedule",
    "tutor_availability",
    orgId,
    load,
    tutorId ? `tutor_id=eq.${tutorId}` : undefined,
    merge
  );
}
