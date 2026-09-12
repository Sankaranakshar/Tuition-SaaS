import { useMemo, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  ArrowLeft, Phone, MessageSquare, Wallet as WalletIcon, Receipt, CalendarCheck,
  BookOpen, FileText, DollarSign, StickyNote, Award, Calendar as CalendarIcon,
  ClipboardList, Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { useStudentStory } from "../hooks/useStudentStory";
import { buildTimeline, filterTimeline, filterForNonStaff, computeHeaderStats, type StoryFilter, type StoryEvent } from "../lib/studentStory";
import { EmptyState, Skeleton, StatChip, Button, Input } from "../components/kit";
import { formatINR, formatPaise, formatDate } from "../lib/format";
import { recordManualPayment } from "../lib/api";
import ProgressReportDownload from "../components/ProgressReportDownload";

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

// Matches kit Input's skin for the native <select>/<textarea> elements it
// doesn't provide a wrapper for (same recipe as Money.tsx / People.tsx).
const SELECT_CLASS =
  "w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface)] px-3 py-1.5 text-[13px] text-[var(--cs-text)] outline-none transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] focus:border-[var(--cs-focus)] focus:ring-2 focus:ring-[var(--cs-focus)]/30";

const FILTERS: { key: StoryFilter; labelKey: string; icon: typeof CalendarIcon }[] = [
  { key: "all", labelKey: "studentStory.filterAll", icon: ClipboardList },
  { key: "sessions", labelKey: "studentStory.filterSessions", icon: CalendarIcon },
  { key: "homework", labelKey: "studentStory.filterHomework", icon: BookOpen },
  { key: "money", labelKey: "studentStory.filterMoney", icon: DollarSign },
  { key: "notes", labelKey: "studentStory.filterNotes", icon: StickyNote },
];

// Icon-medallion tone per event kind (REDESIGN §13, near-monochrome): most
// events are routine (neutral grey), a positive money/attendance event gets
// the soft accent, and a milestone — rare by construction, see
// lib/studentStory.ts's round-number marker — is the one filled-accent call
// out. A problem (no-show) is the only place danger appears.
function eventTone(event: StoryEvent): { bg: string; fg: string } {
  if (event.data.kind === "session" && event.data.session.status === "no_show") {
    return { bg: "bg-[var(--cs-danger-soft)]", fg: "text-[var(--cs-danger)]" };
  }
  if (event.data.kind === "milestone") {
    return { bg: "bg-[var(--cs-accent)]", fg: "text-[var(--cs-accent-contrast)]" };
  }
  if (event.data.kind === "money" || (event.data.kind === "session" && event.data.session.status === "completed")) {
    return { bg: "bg-[var(--cs-accent-soft)]", fg: "text-[var(--cs-accent)]" };
  }
  return { bg: "bg-[var(--cs-surface-2)]", fg: "text-[var(--cs-text-muted)]" };
}

// One medallion (icon + tone background, per eventTone) so each timeline
// entry reads by type at a glance without a rainbow of chip colours (audit
// finding: "timeline items visually flat/undifferentiated by type").
function EventMedallion({ icon: Icon, tone }: { icon: typeof CalendarIcon; tone: { bg: string; fg: string } }) {
  return (
    <div className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[var(--cs-radius-control)]", tone.bg)}>
      <Icon className={cn("h-4 w-4", tone.fg)} strokeWidth={1.75} />
    </div>
  );
}

function EventRow({ event }: { event: StoryEvent }) {
  const { t } = useTranslation();
  const tone = eventTone(event);

  switch (event.data.kind) {
    case "session": {
      const s = event.data.session;
      return (
        <div className="flex items-start gap-3">
          <EventMedallion icon={CalendarIcon} tone={tone} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-[var(--cs-text)]">
              {t("studentStory.sessionOn", { date: formatDate(s.startTime) })}{" "}
              <span className="font-medium text-[var(--cs-text-muted)]">· {s.status || "scheduled"}</span>
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
          <EventMedallion icon={isHomework ? BookOpen : Award} tone={tone} />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-[var(--cs-text)]">
              {a.title || (isHomework ? t("studentStory.homeworkAssignedEvent") : t("studentStory.assessmentRecorded"))}
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
          <EventMedallion icon={FileText} tone={tone} />
          <p className="min-w-0 flex-1 text-sm text-[var(--cs-text)]">{d.fileName}</p>
        </div>
      );
    }
    case "money": {
      const p = event.data.payment;
      return (
        <div className="flex items-start gap-3">
          <EventMedallion icon={Receipt} tone={tone} />
          <p className="min-w-0 flex-1 text-sm text-[var(--cs-text)]">
            {t("studentStory.paymentReceived", { amount: formatPaise(p.amountPaise) })}
            {p.method && <span className="ml-2 text-xs text-[var(--cs-text-muted)]">{t("studentStory.viaMethod", { method: p.method })}</span>}
          </p>
        </div>
      );
    }
    case "note": {
      const n = event.data.note;
      return (
        <div className="flex items-start gap-3">
          <EventMedallion icon={StickyNote} tone={tone} />
          <p className="min-w-0 flex-1 text-sm text-[var(--cs-text)]">{n.body}</p>
        </div>
      );
    }
    case "milestone":
      return (
        <div className="flex items-start gap-3">
          <EventMedallion icon={Award} tone={tone} />
          <p className="min-w-0 flex-1 text-sm font-medium text-[var(--cs-text)]">🎉 {event.data.label}</p>
        </div>
      );
  }
}

export default function StudentStory() {
  const { t } = useTranslation();
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
      toast.success(t("studentStory.noteAdded"));
      refetch();
    } catch (err: any) {
      toast.error(err?.message || t("studentStory.noteAddFailed"));
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
      toast.success(t("studentStory.homeworkAssignedToast"));
      refetch();
    } catch (err: any) {
      toast.error(err?.message || t("studentStory.homeworkAssignFailed"));
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
      toast.success(t("studentStory.paymentRecorded"));
      refetch();
    } catch (err: any) {
      toast.error(err?.message || t("studentStory.paymentRecordFailed"));
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
    return <EmptyState icon={FileText} title={t("studentStory.loadFailedTitle")} description={error} />;
  }

  if (!student) {
    return (
      <div className="max-w-4xl mx-auto">
        <EmptyState icon={FileText} title={t("studentStory.notFoundTitle")} action={{ label: t("studentStory.backToStudents"), onClick: () => navigate(backTo) }} />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto space-y-6 pb-12">
      {/* Pinned header: always-true facts (REDESIGN §6.3) */}
      <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <button onClick={() => navigate(backTo)} className="rounded-full p-2 hover:bg-[var(--cs-bg)]">
              <ArrowLeft className="h-5 w-5 text-[var(--cs-text-muted)]" />
            </button>
            <div>
              <h1 className="text-xl font-bold text-[var(--cs-text)]">{student.name}</h1>
              <p className="text-sm text-[var(--cs-text-muted)]">
                {[student.grade, student.subject].filter(Boolean).join(" · ") || t("studentStory.noBatchDetails")}
              </p>
            </div>
          </div>
          {student.parentPhone && (
            <div className="flex gap-2">
              <a href={`tel:${student.parentPhone}`} className="rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] p-2 transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)]" title={t("studentStory.callParent")}>
                <Phone className="h-4 w-4 text-[var(--cs-text-muted)]" />
              </a>
              <a
                href={`https://wa.me/${student.parentPhone.replace(/\D/g, "")}`}
                target="_blank" rel="noopener noreferrer"
                className="rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] p-2 transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)]"
                title={t("studentStory.messageParent")}
              >
                <MessageSquare className="h-4 w-4 text-[var(--cs-text-muted)]" />
              </a>
            </div>
          )}
        </div>
        <div className="mt-4 grid grid-cols-3 gap-3">
          <StatChip label={t("studentStory.attendance")} value={`${headerStats.attendanceRatePct}%`} icon={CalendarCheck} tone={headerStats.attendanceRatePct < 70 ? "warn" : "default"} />
          <StatChip label={t("studentStory.outstanding")} value={formatPaise(headerStats.outstandingPaise)} icon={Receipt} tone={headerStats.outstandingPaise > 0 ? "warn" : "positive"} />
          <StatChip label={t("studentStory.wallet")} value={formatINR(headerStats.walletBalance)} icon={WalletIcon} />
        </div>
      </div>

      {/* Filter chips (replace tabs — REDESIGN §6.3) */}
      <div className="flex flex-wrap gap-2">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={cn(
              "flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)]",
              filter === f.key
                ? "border-[var(--cs-accent)] bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]"
                : "border-[var(--cs-border)] text-[var(--cs-text-muted)] hover:bg-[var(--cs-surface-2)]"
            )}
          >
            <f.icon className="h-3.5 w-3.5" strokeWidth={1.75} />
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      {/* B-12 (EXECUTION_PLAN.md Step 22): visible to staff and to the
          student themselves on /app/my-story — not gated on isStaff, unlike
          the composer below, since a student may download their own report. */}
      <ProgressReportDownload studentId={student.id} />

      {/* Inline composer: staff only, no modals for the common cases */}
      {isStaff && (
        <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4">
          {!composer ? (
            <div className="flex flex-wrap gap-2">
              <Button variant="ghost" size="sm" icon={Plus} onClick={() => setComposer("note")}>{t("studentStory.addNote")}</Button>
              <Button variant="ghost" size="sm" icon={Plus} onClick={() => setComposer("homework")}>{t("studentStory.assignHomework")}</Button>
              {outstandingInvoices.length > 0 && (
                <Button variant="ghost" size="sm" icon={Plus} onClick={() => setComposer("payment")}>{t("studentStory.recordPayment")}</Button>
              )}
            </div>
          ) : composer === "note" ? (
            <div className="space-y-2">
              <textarea
                autoFocus
                value={noteBody}
                onChange={(e) => setNoteBody(e.target.value)}
                placeholder={t("studentStory.notePlaceholder")}
                rows={2}
                className={SELECT_CLASS}
              />
              <div className="flex gap-2">
                <Button disabled={submitting || !noteBody.trim()} onClick={handleAddNote}>{t("studentStory.saveNote")}</Button>
                <Button variant="ghost" onClick={() => setComposer(null)}>{t("studentStory.cancel")}</Button>
              </div>
            </div>
          ) : composer === "homework" ? (
            <div className="space-y-2">
              <Input
                autoFocus
                value={homeworkTitle}
                onChange={(e) => setHomeworkTitle(e.target.value)}
                placeholder={t("studentStory.homeworkTitlePlaceholder")}
              />
              <Input
                type="date"
                value={homeworkDueDate}
                onChange={(e) => setHomeworkDueDate(e.target.value)}
                className="w-auto"
              />
              <div className="flex gap-2">
                <Button disabled={submitting || !homeworkTitle.trim()} onClick={handleAssignHomework}>{t("studentStory.assign")}</Button>
                <Button variant="ghost" onClick={() => setComposer(null)}>{t("studentStory.cancel")}</Button>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <select
                value={paymentInvoiceId}
                onChange={(e) => setPaymentInvoiceId(e.target.value)}
                className={SELECT_CLASS}
              >
                <option value="">{t("studentStory.selectInvoice")}</option>
                {outstandingInvoices.map((inv) => (
                  <option key={inv.id} value={inv.id}>
                    {t("studentStory.invoiceOption", { date: inv.dueDate, amount: formatPaise((inv.totalPaise ?? 0) - (inv.paidPaise ?? 0)) })}
                  </option>
                ))}
              </select>
              <Input
                type="number"
                value={paymentAmount}
                onChange={(e) => setPaymentAmount(e.target.value)}
                placeholder={t("studentStory.amountPlaceholder")}
              />
              <div className="flex gap-2">
                <Button disabled={submitting || !paymentInvoiceId || !paymentAmount} onClick={handleRecordPayment}>{t("studentStory.record")}</Button>
                <Button variant="ghost" onClick={() => setComposer(null)}>{t("studentStory.cancel")}</Button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* The timeline itself */}
      {timeline.length === 0 ? (
        <EmptyState icon={ClipboardList} title={t("studentStory.emptyTitle")} description={t("studentStory.emptyDesc")} />
      ) : (
        <div className="space-y-4">
          {timeline.map((event) => (
            <div key={`${event.kind}-${event.id}`} className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4">
              <EventRow event={event} />
              <p className="mt-1 pl-11 text-xs text-[var(--cs-text-muted)]">{formatDate(event.at)}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
