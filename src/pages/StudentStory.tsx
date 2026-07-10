import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ArrowLeft, Phone, MessageSquare, Wallet as WalletIcon, Receipt, CalendarCheck,
  BookOpen, FileText, DollarSign, StickyNote, Award, Calendar as CalendarIcon,
  ClipboardList, Plus,
} from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { useStudentStory } from "../hooks/useStudentStory";
import { buildTimeline, filterTimeline, filterForNonStaff, computeHeaderStats, type StoryFilter, type StoryEvent } from "../lib/studentStory";
import { EmptyState, Skeleton, StatChip } from "../components/kit";
import { formatINR, formatPaise, formatDate } from "../lib/format";
import { recordManualPayment } from "../lib/api";

// Student Story (DEV_PLAN §2a Stage 2 item 2, REDESIGN §6.3): one scrollable,
// reverse-chronological timeline replacing StudentProfile.tsx's five tabs and
// the separate AcademicProgress.tsx/StudyMaterial.tsx student-facing pages.
// The pinned header carries the always-true facts; filter chips narrow the
// stream instead of hiding four-fifths of it behind tabs; the composer writes
// straight into the timeline, no modals for the common cases.
//
// One component, two callers: `/app/students/:id` (staff, id from the URL)
// and `/app/my-story` (a logged-in student viewing their own record, id
// resolved from student_user_id). The parent/student view is the same
// component with the composer and private notes hidden (filterForNonStaff) —
// not a separate page, so there's exactly one place this can drift from the
// truth.

const FILTERS: { key: StoryFilter; label: string; icon: typeof CalendarIcon }[] = [
  { key: "all", label: "All", icon: ClipboardList },
  { key: "sessions", label: "Sessions", icon: CalendarIcon },
  { key: "homework", label: "Homework", icon: BookOpen },
  { key: "money", label: "Money", icon: DollarSign },
  { key: "notes", label: "Notes", icon: StickyNote },
];

function EventRow({ event }: { event: StoryEvent }) {
  switch (event.data.kind) {
    case "session": {
      const s = event.data.session;
      const statusTone =
        s.status === "completed" ? "text-[var(--cs-ok)]" : s.status === "no_show" ? "text-[var(--cs-danger)]" : "text-[var(--cs-text-muted)]";
      return (
        <div className="flex items-start gap-3">
          <CalendarIcon className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cs-accent)]" strokeWidth={1.75} />
          <div>
            <p className="text-sm text-[var(--cs-text)]">
              Session on {formatDate(s.startTime)} <span className={`font-medium ${statusTone}`}>· {s.status || "scheduled"}</span>
            </p>
          </div>
        </div>
      );
    }
    case "homework": {
      const a = event.data.assessment;
      const isHomework = a.type === "assignment";
      return (
        <div className="flex items-start gap-3">
          {isHomework ? (
            <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cs-accent)]" strokeWidth={1.75} />
          ) : (
            <Award className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cs-accent)]" strokeWidth={1.75} />
          )}
          <div>
            <p className="text-sm text-[var(--cs-text)]">
              {a.title || (isHomework ? "Homework assigned" : "Assessment recorded")}
              {isHomework && a.status && <span className="ml-2 text-xs text-[var(--cs-text-muted)]">· {a.status}</span>}
              {!isHomework && a.score != null && (
                <span className="ml-2 text-xs text-[var(--cs-text-muted)]">
                  · {a.score}/{a.totalScore ?? 100}
                </span>
              )}
            </p>
            {a.feedback && <p className="mt-0.5 text-xs text-[var(--cs-text-muted)]">{a.feedback}</p>}
          </div>
        </div>
      );
    }
    case "file": {
      const d = event.data.document;
      return (
        <div className="flex items-start gap-3">
          <FileText className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cs-accent)]" strokeWidth={1.75} />
          <p className="text-sm text-[var(--cs-text)]">{d.fileName}</p>
        </div>
      );
    }
    case "money": {
      const p = event.data.payment;
      return (
        <div className="flex items-start gap-3">
          <Receipt className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cs-ok)]" strokeWidth={1.75} />
          <p className="text-sm text-[var(--cs-text)]">
            Payment received · {formatPaise(p.amountPaise)}
            {p.method && <span className="ml-2 text-xs text-[var(--cs-text-muted)]">via {p.method}</span>}
          </p>
        </div>
      );
    }
    case "note": {
      const n = event.data.note;
      return (
        <div className="flex items-start gap-3">
          <StickyNote className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cs-warn)]" strokeWidth={1.75} />
          <p className="text-sm text-[var(--cs-text)]">{n.body}</p>
        </div>
      );
    }
    case "milestone":
      return (
        <div className="flex items-start gap-3">
          <Award className="mt-0.5 h-4 w-4 shrink-0 text-[var(--cs-accent)]" strokeWidth={1.75} />
          <p className="text-sm font-medium text-[var(--cs-text)]">🎉 {event.data.label}</p>
        </div>
      );
  }
}

export default function StudentStory() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const {
    student, sessions, assessments, documents, invoices, payments, notes,
    walletBalance, loading, error, isStaff, refetch,
  } = useStudentStory(id);

  const [filter, setFilter] = useState<StoryFilter>("all");
  const [composer, setComposer] = useState<"note" | "homework" | "payment" | null>(null);
  const [noteBody, setNoteBody] = useState("");
  const [homeworkTitle, setHomeworkTitle] = useState("");
  const [homeworkDueDate, setHomeworkDueDate] = useState("");
  const [paymentInvoiceId, setPaymentInvoiceId] = useState("");
  const [paymentAmount, setPaymentAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const timeline = useMemo(() => {
    const built = buildTimeline({ sessions, assessments, documents, payments, notes });
    const visible = isStaff ? built : filterForNonStaff(built);
    return filterTimeline(visible, filter);
  }, [sessions, assessments, documents, payments, notes, isStaff, filter]);

  const headerStats = useMemo(() => computeHeaderStats(sessions, invoices, walletBalance), [sessions, invoices, walletBalance]);
  const outstandingInvoices = useMemo(() => invoices.filter((inv) => (inv.status ?? "") !== "paid" && (inv.status ?? "") !== "void"), [invoices]);

  const backTo = id ? "/app/people?lens=students" : "/app";

  async function handleAddNote() {
    if (!student || !user?.id || !noteBody.trim()) return;
    setSubmitting(true);
    try {
      const { error: err } = await supabase.from("student_notes").insert({
        organization_id: user.organizationId,
        student_id: student.id,
        author_user_id: user.id,
        body: noteBody.trim(),
      });
      if (err) throw err;
      setNoteBody("");
      setComposer(null);
      toast.success("Note added");
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't add the note");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAssignHomework() {
    if (!student || !user?.id || !homeworkTitle.trim()) return;
    setSubmitting(true);
    try {
      const { error: err } = await supabase.from("assessments").insert({
        organization_id: user.organizationId,
        student_id: student.id,
        tutor_id: user.id,
        type: "assignment",
        status: "pending",
        title: homeworkTitle.trim(),
        due_date: homeworkDueDate || null,
      });
      if (err) throw err;
      setHomeworkTitle("");
      setHomeworkDueDate("");
      setComposer(null);
      toast.success("Homework assigned");
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't assign homework");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRecordPayment() {
    const amountPaise = Math.round(Number(paymentAmount) * 100);
    if (!paymentInvoiceId || !amountPaise || amountPaise <= 0) return;
    setSubmitting(true);
    try {
      await recordManualPayment({ invoiceId: paymentInvoiceId, amountPaise, method: "cash" });
      setPaymentAmount("");
      setPaymentInvoiceId("");
      setComposer(null);
      toast.success("Payment recorded");
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Couldn't record the payment");
    } finally {
      setSubmitting(false);
    }
  }

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-4">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return <EmptyState icon={FileText} title="Couldn't load this story" description={error} />;
  }

  if (!student) {
    return (
      <div className="max-w-4xl mx-auto">
        <EmptyState icon={FileText} title="Student not found" action={{ label: "Back to Students", onClick: () => navigate(backTo) }} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Pinned header: always-true facts (REDESIGN §6.3) */}
      <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(backTo)} className="rounded-full p-2 hover:bg-[var(--cs-bg)]">
              <ArrowLeft className="h-5 w-5 text-[var(--cs-text-muted)]" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-[var(--cs-text)]">{student.name}</h1>
              <p className="text-sm text-[var(--cs-text-muted)]">
                {[student.grade, student.subject].filter(Boolean).join(" · ") || "No batch details yet"}
              </p>
            </div>
          </div>
          {student.parentPhone && (
            <div className="flex gap-2">
              <a href={`tel:${student.parentPhone}`} className="rounded-[6px] border border-[var(--cs-border)] p-2 hover:bg-[var(--cs-bg)]" title="Call parent">
                <Phone className="h-4 w-4 text-[var(--cs-text-muted)]" />
              </a>
              <a
                href={`https://wa.me/${student.parentPhone.replace(/\D/g, "")}`}
                target="_blank" rel="noopener noreferrer"
                className="rounded-[6px] border border-[var(--cs-border)] p-2 hover:bg-[var(--cs-bg)]"
                title="Message parent"
              >
                <MessageSquare className="h-4 w-4 text-[var(--cs-text-muted)]" />
              </a>
            </div>
          )}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatChip label="Attendance" value={`${headerStats.attendanceRatePct}%`} icon={CalendarCheck} tone={headerStats.attendanceRatePct < 70 ? "warn" : "default"} />
          <StatChip label="Outstanding" value={formatPaise(headerStats.outstandingPaise)} icon={Receipt} tone={headerStats.outstandingPaise > 0 ? "warn" : "positive"} />
          <StatChip label="Wallet" value={formatINR(headerStats.walletBalance)} icon={WalletIcon} />
        </div>
      </div>

      {/* Filter chips (replace tabs — REDESIGN §6.3) */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors ${
              filter === f.key
                ? "border-[var(--cs-accent)] bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]"
                : "border-[var(--cs-border)] text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)]"
            }`}
          >
            <f.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            {f.label}
          </button>
        ))}
      </div>

      {/* Inline composer: staff only, no modals for the common cases */}
      {isStaff && (
        <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4">
          {!composer ? (
            <div className="flex flex-wrap gap-2">
              <button onClick={() => setComposer("note")} className="flex items-center gap-1.5 rounded-[6px] border border-[var(--cs-border)] px-3 py-1.5 text-sm hover:bg-[var(--cs-bg)]">
                <Plus className="h-3.5 w-3.5" /> Add note
              </button>
              <button onClick={() => setComposer("homework")} className="flex items-center gap-1.5 rounded-[6px] border border-[var(--cs-border)] px-3 py-1.5 text-sm hover:bg-[var(--cs-bg)]">
                <Plus className="h-3.5 w-3.5" /> Assign homework
              </button>
              {outstandingInvoices.length > 0 && (
                <button onClick={() => setComposer("payment")} className="flex items-center gap-1.5 rounded-[6px] border border-[var(--cs-border)] px-3 py-1.5 text-sm hover:bg-[var(--cs-bg)]">
                  <Plus className="h-3.5 w-3.5" /> Record payment
                </button>
              )}
            </div>
          ) : composer === "note" ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder="What's going on with this student?"
                rows={2}
                className="w-full rounded-[6px] border border-[var(--cs-border)] p-2 text-sm"
              />
              <div className="flex gap-2">
                <button disabled={submitting || !noteBody.trim()} onClick={handleAddNote} className="rounded-[6px] bg-[var(--cs-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                  Save note
                </button>
                <button onClick={() => setComposer(null)} className="rounded-[6px] border border-[var(--cs-border)] px-3 py-1.5 text-sm">Cancel</button>
              </div>
            </div>
          ) : composer === "homework" ? (
            <div className="space-y-2">
              <input
                autoFocus
                value={homeworkTitle}
                onChange={(e) => setHomeworkTitle(e.target.value)}
                placeholder="Homework title"
                className="w-full rounded-[6px] border border-[var(--cs-border)] p-2 text-sm"
              />
              <input
                type="date"
                value={homeworkDueDate}
                onChange={(e) => setHomeworkDueDate(e.target.value)}
                className="rounded-[6px] border border-[var(--cs-border)] p-2 text-sm"
              />
              <div className="flex gap-2">
                <button disabled={submitting || !homeworkTitle.trim()} onClick={handleAssignHomework} className="rounded-[6px] bg-[var(--cs-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                  Assign
                </button>
                <button onClick={() => setComposer(null)} className="rounded-[6px] border border-[var(--cs-border)] px-3 py-1.5 text-sm">Cancel</button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <select
                value={paymentInvoiceId}
                onChange={(e) => setPaymentInvoiceId(e.target.value)}
                className="w-full rounded-[6px] border border-[var(--cs-border)] p-2 text-sm"
              >
                <option value="">Select invoice…</option>
                {outstandingInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {inv.dueDate} · {formatPaise((inv.totalPaise ?? 0) - (inv.paidPaise ?? 0))} due
                  </option>
                ))}
              </select>
              <input
                type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder="Amount (₹)"
                className="w-full rounded-[6px] border border-[var(--cs-border)] p-2 text-sm"
              />
              <div className="flex gap-2">
                <button disabled={submitting || !paymentInvoiceId || !paymentAmount} onClick={handleRecordPayment} className="rounded-[6px] bg-[var(--cs-accent)] px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50">
                  Record
                </button>
                <button onClick={() => setComposer(null)} className="rounded-[6px] border border-[var(--cs-border)] px-3 py-1.5 text-sm">Cancel</button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* The timeline itself */}
      {timeline.length === 0 ? (
        <EmptyState icon={ClipboardList} title="Nothing here yet" description="Sessions, homework, files, and payments will show up here as they happen." />
      ) : (
        <div className="space-y-4">
          {timeline.map((event) => (
            <div key={`${event.kind}-${event.id}`} className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4">
              <EventRow event={event} />
              <p className="mt-1 pl-7 text-xs text-[var(--cs-text-muted)]">{formatDate(event.at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
