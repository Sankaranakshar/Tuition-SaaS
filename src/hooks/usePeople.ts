import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import type { TodayInvoice, TodayAttendance } from "../lib/today";
import type { PeopleStudent, PeopleLead } from "../lib/people";

// One hook per People lens (REDESIGN §6.2): each owns its query, bounding,
// Realtime subscription, and error state, mirroring the pattern the old
// Students.tsx/Leads.tsx pages had inline (DEV_PLAN Architecture
// Improvements — "extract per-entity query hooks"). Every subscribed table
// must already be in the supabase_realtime publication (HANDOFF §16.2); all
// four here (students, invoices, attendance_records, leads, parent_links,
// profiles, tutor_profiles) already are.

export interface StudentRow extends PeopleStudent {
  grade?: string | null;
  subject?: string | null;
  tutorId?: string | null;
}

function useRealtimeList<T>(
  table: string,
  orgId: string | undefined | null,
  load: () => Promise<T[]>,
  filter?: string
) {
  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    try {
      const rows = await load();
      setData(rows);
      setError(null);
    } catch (err: any) {
      setError(err?.message || `Could not load ${table}`);
    } finally {
      setLoading(false);
    }
  }, [load]);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await refetch();
    })();

    const channel = supabase
      .channel(`people-${table}-${orgId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table, filter: filter ?? `organization_id=eq.${orgId}` },
        () => refetch()
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [orgId, table]);

  return { data, loading, error, refetch };
}

export function useStudentsList() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const load = useCallback(async (): Promise<StudentRow[]> => {
    if (!orgId) return [];
    let q = supabase.from("students").select("*").eq("organization_id", orgId).eq("is_deleted", false).limit(200);
    if (user!.role === "tutor") q = q.eq("tutor_id", user!.id);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      phone: row.phone,
      parentName: row.parent_name,
      parentPhone: row.parent_phone,
      grade: row.grade,
      subject: row.subject,
      tutorId: row.tutor_id,
      createdAt: row.created_at,
    }));
  }, [orgId, user?.role, user?.id]);
  return useRealtimeList<StudentRow>("students", orgId, load);
}

export function useStudentInvoices() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const load = useCallback(async (): Promise<TodayInvoice[]> => {
    if (!orgId) return [];
    const { data, error } = await supabase
      .from("invoices")
      .select("id, student_id, status, due_date, total_paise, paid_paise")
      .eq("organization_id", orgId)
      .limit(500);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      studentId: row.student_id,
      status: row.status,
      dueDate: row.due_date,
      totalPaise: row.total_paise,
      paidPaise: row.paid_paise,
    }));
  }, [orgId]);
  return useRealtimeList<TodayInvoice>("invoices", orgId, load);
}

export function useStudentAttendance() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const load = useCallback(async (): Promise<TodayAttendance[]> => {
    if (!orgId) return [];
    const { data, error } = await supabase
      .from("attendance_records")
      .select("student_id, status, session_start")
      .eq("organization_id", orgId)
      .order("session_start", { ascending: false })
      .limit(1000);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      studentId: row.student_id,
      status: row.status,
      sessionStart: row.session_start,
    }));
  }, [orgId]);
  return useRealtimeList<TodayAttendance>("attendance_records", orgId, load);
}

export function useLeadsList() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const load = useCallback(async (): Promise<PeopleLead[]> => {
    if (!orgId) return [];
    const { data, error } = await supabase
      .from("leads")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      name: row.name,
      status: row.status,
      source: row.source,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    }));
  }, [orgId]);
  return useRealtimeList<PeopleLead>("leads", orgId, load);
}

export interface ParentRow {
  parentUserId: string;
  name: string;
  phone?: string | null;
  studentNames: string[];
}

export function useParentsList() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const load = useCallback(async (): Promise<ParentRow[]> => {
    if (!orgId) return [];
    const { data: links, error } = await supabase
      .from("parent_links")
      .select("parent_user_id, student_id")
      .eq("organization_id", orgId)
      .limit(500);
    if (error) throw error;
    if (!links || links.length === 0) return [];

    const parentIds = Array.from(new Set(links.map((l: any) => l.parent_user_id)));
    const studentIds = Array.from(new Set(links.map((l: any) => l.student_id)));
    const [{ data: profiles, error: pErr }, { data: students, error: sErr }] = await Promise.all([
      supabase.from("profiles").select("id, name, phone").in("id", parentIds),
      supabase.from("students").select("id, name").in("id", studentIds),
    ]);
    if (pErr) throw pErr;
    if (sErr) throw sErr;

    const profileById = new Map((profiles || []).map((p: any) => [p.id, p]));
    const studentNameById = new Map((students || []).map((s: any) => [s.id, s.name]));
    const studentsByParent = new Map<string, string[]>();
    for (const link of links as any[]) {
      const name = studentNameById.get(link.student_id) || "Unknown student";
      if (!studentsByParent.has(link.parent_user_id)) studentsByParent.set(link.parent_user_id, []);
      studentsByParent.get(link.parent_user_id)!.push(name);
    }

    return parentIds.map((id) => {
      const profile = profileById.get(id) as any;
      return {
        parentUserId: id,
        name: profile?.name || "Unnamed parent",
        phone: profile?.phone,
        studentNames: studentsByParent.get(id) || [],
      };
    });
  }, [orgId]);
  return useRealtimeList<ParentRow>("parent_links", orgId, load);
}

export interface TutorRow {
  userId: string;
  fullName: string;
  location?: string | null;
  subjects: string[];
  grades: string[];
  isVerified: boolean;
}

export function useTutorsList() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const load = useCallback(async (): Promise<TutorRow[]> => {
    if (!orgId) return [];
    const { data, error } = await supabase.from("tutor_profiles").select("*").eq("organization_id", orgId).limit(200);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      userId: row.user_id,
      fullName: row.full_name || "Unnamed tutor",
      location: row.location,
      subjects: row.subjects || [],
      grades: row.grades || [],
      isVerified: !!row.is_verified,
    }));
  }, [orgId]);
  return useRealtimeList<TutorRow>("tutor_profiles", orgId, load);
}
