import { useCallback, useEffect } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { useRealtimeList } from "./useRealtimeList";
import type { ScheduleSession, TutorAvailabilityWindow } from "../lib/schedule";

// One hook per Schedule data source (REDESIGN §6.1), same shape as
// usePeople.ts/useMoney.ts: each owns its query, bounding, Realtime
// subscription, and error state on top of the shared useRealtimeList
// helper. class_sessions/class_templates/tutor_availability are already in
// the supabase_realtime publication (HANDOFF §16.2).

export interface ScheduleSessionRow extends ScheduleSession {
  studentIds: string[];
  isOnline: boolean;
  roomNumber?: string | null;
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
    return (data || []).map((row: any) => ({
      id: row.id,
      tutorId: row.tutor_id,
      templateId: row.template_id,
      studentIds: row.student_ids || [],
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      isOnline: row.is_online,
      roomNumber: row.room_number,
    }));
  }, [orgId, user?.role, user?.id, weekStartIso, weekEndIso]);

  // Realtime filter stays org-scoped (postgres_changes filters can't express
  // a date range); the week bound is re-applied by `load` on every refetch.
  const result = useRealtimeList<ScheduleSessionRow>("schedule", "class_sessions", orgId, load);
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
    return (data || []).map((row: any) => ({
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
    }));
  }, [orgId]);
  return useRealtimeList<ScheduleTemplate>("schedule", "class_templates", orgId, load);
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
    return (data || []).map((row: any) => ({
      id: row.id,
      tutorId: row.tutor_id,
      templateId: row.template_id,
      studentIds: row.student_ids || [],
      startTime: row.start_time,
      endTime: row.end_time,
      status: row.status,
      isOnline: row.is_online,
      roomNumber: row.room_number,
    }));
  }, [user?.id, weekStartIso, weekEndIso]);

  // Realtime's postgres_changes filter only supports simple column
  // comparisons, not the array-contains OR this query needs, so this
  // subscribes to every class_sessions change (same refetch-on-any-change
  // tradeoff Timetable.tsx already shipped with, tracked as DEV_PLAN Tech
  // Debt #5) rather than useRealtimeList's org-scoped default, which would
  // be flatly wrong here (there's no orgId in scope, only a user id).
  const result = useRealtimeList<ScheduleSessionRow>(
    "schedule",
    "class_sessions",
    user?.id,
    load,
    "organization_id=neq.00000000-0000-0000-0000-000000000000"
  );
  // Same fix as useScheduleSessions: force a refetch on week navigation,
  // since useRealtimeList's mount effect doesn't rerun when `load` changes.
  useEffect(() => {
    if (user?.id) result.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekStartIso, weekEndIso]);
  return result;
}

export function useTutorAvailability(tutorId: string | undefined | null) {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const load = useCallback(async (): Promise<TutorAvailabilityWindow[]> => {
    if (!orgId || !tutorId) return [];
    const { data, error } = await supabase
      .from("tutor_availability")
      .select("day_of_week, start_time, end_time")
      .eq("organization_id", orgId)
      .eq("tutor_id", tutorId)
      .limit(50);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      dayOfWeek: row.day_of_week,
      startTime: row.start_time,
      endTime: row.end_time,
    }));
  }, [orgId, tutorId]);
  return useRealtimeList<TutorAvailabilityWindow>(
    "schedule",
    "tutor_availability",
    orgId,
    load,
    tutorId ? `tutor_id=eq.${tutorId}` : undefined
  );
}
