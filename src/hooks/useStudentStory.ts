import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import type { TodayInvoice } from "../lib/today";
import type { StorySession, StoryAssessment, StoryDocument, StoryPayment, StoryNote } from "../lib/studentStory";

// Data hook for the Student Story workspace (DEV_PLAN §2a Stage 2 item 2,
// REDESIGN §6.3). Owns the query, bounding, Realtime subscription, and
// permission gating for one student's whole timeline — mirrors the
// per-entity hook pattern from src/hooks/usePeople.ts. All six subscribed
// tables (students, class_sessions, assessments, documents, invoices,
// payments, wallets, student_notes) are already in the supabase_realtime
// publication (HANDOFF §16.2, §20).
//
// Two callers, one hook: the staff route resolves `studentId` from the URL
// (`/app/students/:id`); the self-view route (`/app/my-story`) passes
// `undefined` and this hook resolves the caller's own roster row via
// `student_user_id = auth.uid()` — the correct join AcademicProgress.tsx and
// StudyMaterial.tsx never made (they queried `student_id = user.id`, which
// only ever matched by coincidence, since a student's auth uid and their
// students.id are different values — see HANDOFF §20).

export interface StudentStoryHeader {
  id: string;
  name: string;
  grade?: string | null;
  subject?: string | null;
  parentName?: string | null;
  parentPhone?: string | null;
  status?: string | null;
  studentUserId?: string | null;
}

export function useStudentStory(studentId: string | undefined) {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const isStaff = user?.role !== "parent" && user?.role !== "student";

  const [resolvedId, setResolvedId] = useState<string | undefined>(studentId);
  const [student, setStudent] = useState<StudentStoryHeader | null>(null);
  const [sessions, setSessions] = useState<StorySession[]>([]);
  const [assessments, setAssessments] = useState<StoryAssessment[]>([]);
  const [documents, setDocuments] = useState<StoryDocument[]>([]);
  const [invoices, setInvoices] = useState<TodayInvoice[]>([]);
  const [payments, setPayments] = useState<StoryPayment[]>([]);
  const [notes, setNotes] = useState<StoryNote[]>([]);
  const [walletBalance, setWalletBalance] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Self-view: resolve the caller's own roster row id once per user.
  useEffect(() => {
    if (studentId) {
      setResolvedId(studentId);
      return;
    }
    if (!user?.id) return;
    let cancelled = false;
    (async () => {
      const { data, error: err } = await supabase
        .from("students")
        .select("id")
        .eq("student_user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (err) {
        setError(err.message);
        setLoading(false);
        return;
      }
      setResolvedId(data?.id);
      if (!data?.id) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [studentId, user?.id]);

  const load = useCallback(async () => {
    if (!resolvedId || !orgId) return;
    try {
      const [studentRes, sessionsRes, assessmentsRes, documentsRes, invoicesRes, walletRes] = await Promise.all([
        supabase
          .from("students")
          .select("id, name, grade, subject, parent_name, parent_phone, status, student_user_id")
          .eq("id", resolvedId)
          .maybeSingle(),
        supabase
          .from("class_sessions")
          .select("id, start_time, end_time, status")
          .eq("organization_id", orgId)
          .contains("student_ids", [resolvedId])
          .order("start_time", { ascending: false })
          .limit(200),
        supabase
          .from("assessments")
          .select("id, type, title, status, date, due_date, score, total_score, feedback, created_at")
          .eq("organization_id", orgId)
          .eq("student_id", resolvedId)
          .limit(200),
        supabase
          .from("documents")
          .select("id, file_name, category, created_at")
          .eq("organization_id", orgId)
          .eq("student_id", resolvedId)
          .limit(100),
        supabase
          .from("invoices")
          .select("id, student_id, status, due_date, total_paise, paid_paise")
          .eq("organization_id", orgId)
          .eq("student_id", resolvedId)
          .limit(200),
        supabase
          .from("wallets")
          .select("balance_credits")
          .eq("organization_id", orgId)
          .eq("student_id", resolvedId)
          .maybeSingle(),
      ]);
      // Staff-only: payments and student_notes are invisible to a
      // parent/student's own read (payments_select is staff-only; notes are
      // deliberately staff-only too — see 20260711100000_student_notes.sql).
      // Skip the queries entirely rather than let them 403 in the console.
      const [paymentsRes, notesRes] = isStaff
        ? await Promise.all([
            supabase
              .from("payments")
              .select("id, amount_paise, method, at")
              .eq("organization_id", orgId)
              .eq("student_id", resolvedId)
              .limit(200),
            supabase
              .from("student_notes")
              .select("id, body, author_user_id, created_at")
              .eq("organization_id", orgId)
              .eq("student_id", resolvedId)
              .order("created_at", { ascending: false })
              .limit(200),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];

      for (const res of [studentRes, sessionsRes, assessmentsRes, documentsRes, invoicesRes, walletRes, paymentsRes, notesRes]) {
        if (res.error) throw res.error;
      }

      setStudent(
        studentRes.data
          ? {
              id: studentRes.data.id,
              name: studentRes.data.name,
              grade: studentRes.data.grade,
              subject: studentRes.data.subject,
              parentName: studentRes.data.parent_name,
              parentPhone: studentRes.data.parent_phone,
              status: studentRes.data.status,
              studentUserId: studentRes.data.student_user_id,
            }
          : null
      );
      setSessions(
        (sessionsRes.data || []).map((r: any) => ({ id: r.id, startTime: r.start_time, endTime: r.end_time, status: r.status }))
      );
      setAssessments(
        (assessmentsRes.data || []).map((r: any) => ({
          id: r.id,
          type: r.type,
          title: r.title,
          status: r.status,
          date: r.date,
          dueDate: r.due_date,
          score: r.score,
          totalScore: r.total_score,
          feedback: r.feedback,
          createdAt: r.created_at,
        }))
      );
      setDocuments((documentsRes.data || []).map((r: any) => ({ id: r.id, fileName: r.file_name, category: r.category, createdAt: r.created_at })));
      setInvoices(
        (invoicesRes.data || []).map((r: any) => ({
          id: r.id,
          studentId: r.student_id,
          status: r.status,
          dueDate: r.due_date,
          totalPaise: r.total_paise,
          paidPaise: r.paid_paise,
        }))
      );
      setWalletBalance(walletRes.data?.balance_credits ?? 0);
      setPayments((paymentsRes.data || []).map((r: any) => ({ id: r.id, amountPaise: r.amount_paise, method: r.method, at: r.at })));
      setNotes((notesRes.data || []).map((r: any) => ({ id: r.id, body: r.body, authorUserId: r.author_user_id, createdAt: r.created_at })));
      setError(null);
    } catch (err: any) {
      setError(err?.message || "Could not load this student's story");
    } finally {
      setLoading(false);
    }
  }, [resolvedId, orgId, isStaff]);

  useEffect(() => {
    if (!resolvedId || !orgId) return;
    let cancelled = false;
    (async () => {
      if (cancelled) return;
      await load();
    })();

    // postgres_changes filters only support one simple column=eq condition
    // server-side (same constraint noted in the deleted StudentProfile.tsx);
    // scope each subscription to organization_id and let load() reapply the
    // student-id filter.
    const channel = supabase
      .channel(`student-story-${resolvedId}-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "students", filter: `id=eq.${resolvedId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "class_sessions", filter: `organization_id=eq.${orgId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "assessments", filter: `organization_id=eq.${orgId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "documents", filter: `organization_id=eq.${orgId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices", filter: `organization_id=eq.${orgId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `organization_id=eq.${orgId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `organization_id=eq.${orgId}` }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "student_notes", filter: `organization_id=eq.${orgId}` }, load)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedId, orgId]);

  return { student, sessions, assessments, documents, invoices, payments, notes, walletBalance, loading, error, isStaff, refetch: load };
}
