import React, { useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Plus, ChevronLeft, ChevronRight, Users, User, Calendar as CalendarIcon,
  Clock, MapPin, Video, X, Search,
} from "lucide-react";
import {
  startOfWeek, addDays, addWeeks, subWeeks, format, isSameDay,
  startOfMonth, endOfMonth, endOfWeek, eachDayOfInterval, isSameMonth,
} from "date-fns";
import { useAuth } from "../context/AuthContext";
import { ClassManager } from "../services/ClassManager";
import { cancelSession, rescheduleSession, updateTemplateScope, findScheduleGaps } from "../lib/api";
import {
  useScheduleSessions, useMyScheduleSessions, useClassTemplates, useTutorAvailability,
  type ScheduleSessionRow,
} from "../hooks/useSchedule";
import {
  layoutOverlappingSessions, checkClientSideConflict, isOutsideAvailability,
  buildClassTemplatePayload, minutesSinceMidnight, snapMinutes,
  type ScheduleClassType, type SchedulePricingModel,
} from "../lib/schedule";
import { EmptyState, Modal, Button, Input, Field } from "../components/kit";
import { supabase } from "../supabase";
import { cancellationCutoff, DEFAULT_CANCELLATION_POLICY, type CancellationPolicy } from "../../shared/cancellationPolicy";
import { getOrgCancellationPolicy } from "../lib/cancellationPolicy";
import { formatDate, formatTime } from "../lib/format";

// Schedule workspace (DEV_PLAN Stage 3 Epic 15, REDESIGN §6.1) — replaces
// Calendar.tsx, Bookings.tsx, and Timetable.tsx. Week view is the default; a
// pointer-driven grid supports drag-to-create, drag-to-move, and
// drag-to-resize, all committed through server-authoritative endpoints
// (rescheduleSession/updateTemplateScope) rather than a direct client write —
// closing the RLS gap the old Calendar.tsx's client-side `.update()` left
// open (class_sessions_update has no conflict awareness at all).
//
// One component, two callers: `/app/schedule` (staff) and `/app/my-schedule`
// (a logged-in student/parent). Staff-vs-self is resolved from user.role,
// same convention as Money.tsx/StudentStory.tsx's isStaff check — not a
// route param, since neither route needs one.

// Matches kit Input's skin for the native <select> the wizard uses (same
// recipe as Money.tsx's CreateInvoiceModal / People.tsx's lead form).
const SELECT_CLASS =
  "w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface)] px-3 py-1.5 text-[13px] text-[var(--cs-text)] outline-none transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] focus:border-[var(--cs-focus)] focus:ring-2 focus:ring-[var(--cs-focus)]/30";

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;
const HOUR_PX = 56;
const PX_PER_MINUTE = HOUR_PX / 60;
const GRID_HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i);

function toLocalIso(date: Date) {
  return date.toISOString();
}

// Near-monochrome per REDESIGN §13: only the accent and danger carry hue, so
// scheduled sessions (1:1 or batch alike) read as one calm neutral tone;
// type is a label distinction (see the "Batch"/"1:1" text below), not a
// colour distinction. Cancelled is the danger signal; completed is the one
// positive/accent signal, matching "paid/enrolled" elsewhere in the app.
function sessionColor(session: ScheduleSessionRow) {
  if (session.status === "cancelled") return "bg-[var(--cs-danger-soft)] border-[var(--cs-danger)] text-[var(--cs-danger)] line-through opacity-70";
  if (session.status === "completed") return "bg-[var(--cs-accent-soft)] border-[var(--cs-accent)] text-[var(--cs-accent)]";
  return "bg-[var(--cs-surface-2)] border-[var(--cs-border-strong)] text-[var(--cs-text)]";
}

export default function Schedule() {
  const { user } = useAuth();
  const isStaff = user?.role !== "parent" && user?.role !== "student";
  return isStaff ? <StaffSchedule /> : <MyScheduleView />;
}

// ---- Self-view (student/parent) ------------------------------------------

function MyScheduleView() {
  const { t } = useTranslation();
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const weekEnd = useMemo(() => addWeeks(weekStart, 1), [weekStart]);
  const { data: sessions, loading } = useMyScheduleSessions(weekStart, weekEnd);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--cs-text)]">{t("schedule.myWeek")}</h1>
        <div className="flex items-center gap-1 rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-1">
          <button
            onClick={() => setWeekStart(subWeeks(weekStart, 1))}
            className="rounded-[var(--cs-radius-control)] p-1 text-[var(--cs-text-muted)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)] hover:text-[var(--cs-text)]"
            aria-label={t("schedule.previousWeek")}
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="w-40 text-center text-sm font-medium text-[var(--cs-text)]">
            {format(weekStart, "MMM d")} – {format(addDays(weekStart, 6), "MMM d, yyyy")}
          </span>
          <button
            onClick={() => setWeekStart(addWeeks(weekStart, 1))}
            className="rounded-[var(--cs-radius-control)] p-1 text-[var(--cs-text-muted)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)] hover:text-[var(--cs-text)]"
            aria-label={t("schedule.nextWeek")}
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      {!loading && sessions.length === 0 && (
        <EmptyState icon={CalendarIcon} title={t("schedule.noSessions")} description={t("schedule.noSessionsHint")} />
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
        {days.map((day) => {
          const daySessions = sessions
            .filter((s) => isSameDay(new Date(s.startTime), day))
            .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
          return (
            <div key={day.toISOString()} className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--cs-text-muted)]">
                {format(day, "EEE d")}
              </p>
              <div className="space-y-2">
                {daySessions.map((s) => (
                  <div key={s.id} className={`rounded-[var(--cs-radius-control)] border p-2 text-xs ${sessionColor(s)}`}>
                    <div className="font-medium">{format(new Date(s.startTime), "h:mm a")}</div>
                    <div className="flex items-center gap-1 opacity-80">
                      {s.isOnline ? <Video className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                      {s.isOnline ? t("schedule.online") : s.roomNumber || t("schedule.tbd")}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Staff editor ----------------------------------------------------------

type ViewMode = "week" | "month";

interface DragState {
  mode: "move" | "resize" | "create";
  sessionId?: string;
  dayIndex: number;
  startOffsetMinutes: number; // grid-relative minutes at pointer-down
  originalStart?: Date;
  originalEnd?: Date;
  currentStart: Date;
  currentEnd: Date;
}

interface ScopePromptState {
  session: ScheduleSessionRow;
  newStart: Date;
  newEnd: Date;
}

function StaffSchedule() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<ViewMode>("week");
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const [monthCursor, setMonthCursor] = useState(new Date());
  const weekEnd = useMemo(() => addWeeks(weekStart, 1), [weekStart]);
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart]);

  const { data: sessions, loading, refetch } = useScheduleSessions(weekStart, weekEnd);
  const { data: templates } = useClassTemplates();
  const { data: availability } = useTutorAvailability(user?.role === "tutor" ? user.id : undefined);
  // Step 3 (EXECUTION_PLAN.md): D-08's per-org policy, read once so the
  // popover can disclose the cutoff/fee before staff clicks cancel — the
  // same policy the parent-facing ParentPortal.tsx overview now surfaces.
  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicy>(DEFAULT_CANCELLATION_POLICY);
  React.useEffect(() => {
    if (!user?.organizationId) return;
    let cancelled = false;
    getOrgCancellationPolicy(user.organizationId)
      .then((policy) => { if (!cancelled) setCancellationPolicy(policy); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [user?.organizationId]);

  const [selectedSession, setSelectedSession] = useState<ScheduleSessionRow | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [scopePrompt, setScopePrompt] = useState<ScopePromptState | null>(null);
  const [outsideHoursConfirm, setOutsideHoursConfirm] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);
  // handlePointerUp needs the drag state as of the exact moment the pointer
  // is released, not as of whenever its listener closure was bound — kept in
  // a ref instead of read from the `drag` closure variable so the
  // listener-binding effect doesn't need `drag` in its dependency array. This
  // effect syncs the ref for drag start/end; handlePointerMove below also
  // writes straight to it for the (far more frequent) in-between frames.
  const dragRef = useRef<DragState | null>(null);
  React.useEffect(() => {
    dragRef.current = drag;
  }, [drag]);
  // Per-frame drag geometry (docs/OPTIMIZATION_AUDIT.md finding H3, step 2):
  // handlePointerMove used to call setDrag on every pointermove, re-rendering
  // the whole component at pointer-event frequency (~60-120/sec). It now
  // mutates dragRef.current directly and writes the live position straight to
  // these DOM nodes, so React only renders twice per drag (start, end).
  // `dayIndex` on DragState is therefore never mutated after drag-start; the
  // dragged block stays in its original day column in the DOM and crosses
  // day boundaries visually via a CSS transform computed against that
  // original dayIndex, rather than being torn down and reinserted elsewhere.
  const movingBlockElRef = useRef<HTMLDivElement | null>(null);
  const movingBlockTimeElRef = useRef<HTMLDivElement | null>(null);
  const createPreviewElRef = useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    if (searchParams.get("new") === "1") {
      setWizardPrefill({});
      setWizardOpen(true);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const templateById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);

  // Bind once per drag (start -> end), not once per pointermove frame. The
  // effect used to depend on [drag], which changes on every single
  // handlePointerMove call, so the previous version tore down and re-added
  // both window listeners at pointer-event frequency (~60-120/sec) for the
  // entire duration of every drag (docs/OPTIMIZATION_AUDIT.md finding H3).
  // Safe because handlePointerMove already reads state via setDrag's
  // functional updater (always current, regardless of when this closure was
  // bound) and handlePointerUp now reads dragRef.current instead of the
  // `drag` closure variable — neither needs a fresh closure per frame.
  const isDragging = drag !== null;
  React.useEffect(() => {
    if (!isDragging) return;
    const onMove = (e: PointerEvent) => handlePointerMove(e);
    const onUp = () => handlePointerUp();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isDragging]);

  function offsetMinutesFromPointer(e: PointerEvent | React.PointerEvent, dayIndex: number) {
    const grid = gridRef.current;
    if (!grid) return { dayIndex, offsetMinutes: 0 };
    const rect = grid.getBoundingClientRect();
    const colWidth = rect.width / 7;
    const x = (e as PointerEvent).clientX - rect.left;
    const y = (e as PointerEvent).clientY - rect.top;
    const col = Math.min(6, Math.max(0, Math.floor(x / colWidth)));
    const rawMinutes = (y / PX_PER_MINUTE) + DAY_START_HOUR * 60;
    return { dayIndex: col, offsetMinutes: snapMinutes(rawMinutes) };
  }

  function startCreateDrag(e: React.PointerEvent, dayIndex: number) {
    // Session blocks and the resize handle call e.stopPropagation() on their
    // own onPointerDown, so a click landing on either never reaches here.
    // An e.target !== e.currentTarget check used to gate this too, but the
    // hour-grid-line filler divs tile the day column edge to edge, so every
    // click's real target was one of those children, never the column div
    // itself, and this returned early unconditionally. Verified live: no
    // drag-to-create fired anywhere in the grid before this fix.
    const { offsetMinutes } = offsetMinutesFromPointer(e, dayIndex);
    const day = days[dayIndex];
    const start = new Date(day);
    start.setHours(0, offsetMinutes, 0, 0);
    const end = new Date(start.getTime() + 60 * 60 * 1000);
    setDrag({ mode: "create", dayIndex, startOffsetMinutes: offsetMinutes, currentStart: start, currentEnd: end });
  }

  function startMoveDrag(e: React.PointerEvent, session: ScheduleSessionRow, dayIndex: number) {
    e.stopPropagation();
    const { offsetMinutes } = offsetMinutesFromPointer(e, dayIndex);
    const start = new Date(session.startTime);
    const end = new Date(session.endTime);
    setDrag({
      mode: "move", sessionId: session.id, dayIndex, startOffsetMinutes: offsetMinutes,
      originalStart: start, originalEnd: end, currentStart: start, currentEnd: end,
    });
  }

  function startResizeDrag(e: React.PointerEvent, session: ScheduleSessionRow, dayIndex: number) {
    e.stopPropagation();
    const { offsetMinutes } = offsetMinutesFromPointer(e, dayIndex);
    const start = new Date(session.startTime);
    const end = new Date(session.endTime);
    setDrag({
      mode: "resize", sessionId: session.id, dayIndex, startOffsetMinutes: offsetMinutes,
      originalStart: start, originalEnd: end, currentStart: start, currentEnd: end,
    });
  }

  function handlePointerMove(e: PointerEvent) {
    const prev = dragRef.current;
    if (!prev) return;
    const { dayIndex: liveDayIndex, offsetMinutes } = offsetMinutesFromPointer(e, prev.dayIndex);

    if (prev.mode === "create") {
      const deltaMinutes = offsetMinutes - prev.startOffsetMinutes;
      const start = prev.currentStart;
      const durationMinutes = Math.max(15, deltaMinutes);
      const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
      const next = { ...prev, currentEnd: end };
      dragRef.current = next;
      const el = createPreviewElRef.current;
      if (el) {
        el.style.top = `${timeOffsetPx(next.currentStart)}px`;
        el.style.height = `${Math.max(18, (next.currentEnd.getTime() - next.currentStart.getTime()) / 60000 * PX_PER_MINUTE)}px`;
      }
      return;
    }
    if (prev.mode === "move" && prev.originalStart && prev.originalEnd) {
      // Use the day column under the pointer right now, not the one the
      // drag started in — otherwise dragging a session to a different day
      // silently only changes its time-of-day and leaves it on the
      // original day (a real bug caught during verification: the server
      // then sees no conflict because the session never actually moved).
      // `prev.dayIndex` stays fixed at the original column (see note above
      // the refs), so it doubles as the transform baseline here.
      const durationMs = prev.originalEnd.getTime() - prev.originalStart.getTime();
      const day = days[liveDayIndex];
      const newStart = new Date(day);
      newStart.setHours(0, 0, 0, 0);
      newStart.setMinutes(offsetMinutes);
      const newEnd = new Date(newStart.getTime() + durationMs);
      const next = { ...prev, currentStart: newStart, currentEnd: newEnd };
      dragRef.current = next;
      const el = movingBlockElRef.current;
      const grid = gridRef.current;
      if (el && grid) {
        const colWidth = grid.getBoundingClientRect().width / 7;
        el.style.top = `${timeOffsetPx(newStart)}px`;
        el.style.transform = `translateX(${(liveDayIndex - prev.dayIndex) * colWidth}px)`;
      }
      if (movingBlockTimeElRef.current) {
        movingBlockTimeElRef.current.textContent = format(newStart, "h:mm a");
      }
      return;
    }
    if (prev.mode === "resize" && prev.originalStart) {
      const newEndMinutes = Math.max(minutesSinceMidnight(prev.originalStart) + 15, offsetMinutes);
      const newEnd = new Date(prev.originalStart);
      newEnd.setHours(0, 0, 0, 0);
      newEnd.setMinutes(newEndMinutes);
      const next = { ...prev, currentEnd: newEnd };
      dragRef.current = next;
      const el = movingBlockElRef.current;
      if (el) {
        el.style.height = `${Math.max(18, (next.currentEnd.getTime() - prev.originalStart.getTime()) / 60000 * PX_PER_MINUTE)}px`;
      }
      return;
    }
  }

  async function handlePointerUp() {
    const current = dragRef.current;
    // React's style reconciliation only clears a CSS property if it was
    // previously set through the JSX `style` object; transform never is
    // (only handlePointerMove writes it), so it has to be cleared by hand or
    // the block stays visually shifted after the state-driven re-render below
    // resets top/height/left back to the real (pre-drag) session data.
    if (movingBlockElRef.current) movingBlockElRef.current.style.transform = "";
    setDrag(null);
    if (!current) return;

    if (current.mode === "create") {
      const durationMinutes = Math.round((current.currentEnd.getTime() - current.currentStart.getTime()) / 60000);
      if (durationMinutes < 15) return; // treat as a stray click, not a real drag
      setWizardOpen(true);
      setWizardPrefill({ startDate: format(current.currentStart, "yyyy-MM-dd"), startTime: format(current.currentStart, "HH:mm"), duration: durationMinutes });
      return;
    }

    if (!current.sessionId) return;
    const session = sessions.find((s) => s.id === current.sessionId);
    if (!session) return;

    // A plain click on a session block also fires this move-mode branch
    // (pointerdown -> immediate pointerup, zero movement), and until this
    // check existed it ran the full reschedule flow every time: for any
    // templated session that opened ScopeDialog on top of the SessionPopover
    // the block's own onClick already opened underneath, silently blocking
    // it (both are full-screen overlays; ScopeDialog's higher z-index just
    // won). Verified live: clicking a session ever opened only ScopeDialog,
    // never the details popover, for every session created through the
    // wizard (all of them carry a templateId). A real drag always changes
    // currentStart from originalStart, so this only short-circuits the
    // no-movement case.
    if (current.mode === "move" && current.originalStart && current.currentStart.getTime() === current.originalStart.getTime()) {
      return;
    }

    // Optimistic client-side conflict pre-check for instant feedback; the
    // server re-checks authoritatively under an advisory lock regardless.
    const wouldConflict = checkClientSideConflict(
      { tutorId: session.tutorId, startTime: toLocalIso(current.currentStart), endTime: toLocalIso(current.currentEnd) },
      sessions,
      session.id
    );
    if (wouldConflict) {
      toast.error(t("schedule.conflict"));
      return;
    }

    if (user?.role === "tutor" && isOutsideAvailability({ startTime: toLocalIso(current.currentStart), endTime: toLocalIso(current.currentEnd) }, availability)) {
      const ok = await new Promise<boolean>((resolve) => setOutsideHoursConfirm({ resolve }));
      if (!ok) return;
    }

    if (session.templateId) {
      setScopePrompt({ session, newStart: current.currentStart, newEnd: current.currentEnd });
      return;
    }

    await commitReschedule(session, current.currentStart, current.currentEnd);
  }

  async function commitReschedule(session: ScheduleSessionRow, start: Date, end: Date) {
    try {
      await rescheduleSession(session.id, toLocalIso(start), toLocalIso(end));
      toast.success(t("schedule.rescheduled"));
      refetch();
    } catch (err: any) {
      toast.error(t("schedule.rescheduleFailed"), { description: err?.message });
    }
  }

  async function commitScopeChange(scope: "future" | "all") {
    if (!scopePrompt) return;
    const { session, newStart, newEnd } = scopePrompt;
    setScopePrompt(null);
    try {
      await updateTemplateScope(session.templateId!, {
        scope,
        startHour: newStart.getHours(),
        startMinute: newStart.getMinutes(),
        durationMinutes: Math.round((newEnd.getTime() - newStart.getTime()) / 60000),
      });
      toast.success(t("schedule.scopeUpdated"));
      refetch();
    } catch (err: any) {
      toast.error(t("schedule.scopeFailed"), { description: err?.message });
    }
  }

  async function handleCancelSession(sessionId: string) {
    try {
      await cancelSession(sessionId);
      toast.success(t("schedule.sessionCancelled"));
      setSelectedSession(null);
      refetch();
    } catch (err: any) {
      toast.error(err?.message || "Could not cancel session");
    }
  }

  const [wizardPrefill, setWizardPrefill] = useState<{ startDate?: string; startTime?: string; duration?: number }>({});

  const layout = useMemo(() => {
    const map = new Map<string, { column: number; columns: number }>();
    for (const day of days) {
      const daySessions = sessions.filter((s) => isSameDay(new Date(s.startTime), day) && s.status !== "cancelled");
      for (const l of layoutOverlappingSessions(daySessions)) map.set(l.id, l);
    }
    return map;
  }, [sessions, days]);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-4">
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--cs-text)]">{t("nav.schedule")}</h1>
          <div className="flex items-center gap-1 rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-1">
            <button
              onClick={() => (view === "week" ? setWeekStart(subWeeks(weekStart, 1)) : setMonthCursor(addDays(startOfMonth(monthCursor), -1)))}
              className="rounded-[var(--cs-radius-control)] p-1 text-[var(--cs-text-muted)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)] hover:text-[var(--cs-text)]"
              aria-label={view === "week" ? t("schedule.previousWeek") : t("schedule.previousMonth")}
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <span className="w-44 text-center text-sm font-medium text-[var(--cs-text)]">
              {view === "week"
                ? `${format(weekStart, "MMM d")} – ${format(addDays(weekStart, 6), "MMM d, yyyy")}`
                : format(monthCursor, "MMMM yyyy")}
            </span>
            <button
              onClick={() => (view === "week" ? setWeekStart(addWeeks(weekStart, 1)) : setMonthCursor(addDays(endOfMonth(monthCursor), 1)))}
              className="rounded-[var(--cs-radius-control)] p-1 text-[var(--cs-text-muted)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)] hover:text-[var(--cs-text)]"
              aria-label={view === "week" ? t("schedule.nextWeek") : t("schedule.nextMonth")}
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-1 rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-1 text-sm">
            <button
              onClick={() => setView("week")}
              className={`rounded-[var(--cs-radius-control)] px-2 py-1 transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] ${
                view === "week" ? "bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]" : "text-[var(--cs-text-muted)] hover:bg-[var(--cs-surface-2)] hover:text-[var(--cs-text)]"
              }`}
            >
              {t("schedule.week")}
            </button>
            <button
              onClick={() => setView("month")}
              className={`rounded-[var(--cs-radius-control)] px-2 py-1 transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] ${
                view === "month" ? "bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]" : "text-[var(--cs-text-muted)] hover:bg-[var(--cs-surface-2)] hover:text-[var(--cs-text)]"
              }`}
            >
              {t("schedule.month")}
            </button>
          </div>
        </div>
        <Button icon={Plus} onClick={() => { setWizardPrefill({}); setWizardOpen(true); }}>
          {t("schedule.addClass")}
        </Button>
      </div>

      {view === "week" ? (
        <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
          <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-[var(--cs-border)] bg-[var(--cs-surface-2)]">
            <div />
            {days.map((day) => (
              <div key={day.toISOString()} className="border-l border-[var(--cs-border)] py-2 text-center text-xs font-semibold uppercase tracking-wide text-[var(--cs-text-muted)]">
                {format(day, "EEE d")}
              </div>
            ))}
          </div>
          <div className="relative grid grid-cols-[56px_repeat(7,1fr)]" style={{ height: GRID_HOURS.length * HOUR_PX }}>
            <div>
              {GRID_HOURS.map((h) => (
                <div key={h} style={{ height: HOUR_PX }} className="border-b border-[var(--cs-border)] pr-2 text-right text-[10px] text-[var(--cs-text-muted)]">
                  {format(new Date(2000, 0, 1, h), "h a")}
                </div>
              ))}
            </div>
            <div ref={gridRef} className="relative col-span-7 grid grid-cols-7">
              {days.map((day, dayIndex) => {
                // The dragged session's block stays put in its own original
                // day column in the DOM throughout the drag — see the note
                // above dragRef — so no per-day pull-out/reinsert is needed;
                // crossing into another day's visual space is handled by the
                // CSS transform handlePointerMove writes onto the block.
                const daySessions = sessions.filter((s) => isSameDay(new Date(s.startTime), day));
                const dayAvailability = user?.role === "tutor" ? availability.filter((a) => a.dayOfWeek === day.getDay()) : [];
                return (
                  <div
                    key={day.toISOString()}
                    className="relative border-l border-[var(--cs-border)]"
                    onPointerDown={(e) => startCreateDrag(e, dayIndex)}
                  >
                    {GRID_HOURS.map((h) => (
                      <div key={h} style={{ height: HOUR_PX }} className="border-b border-[var(--cs-border)]" />
                    ))}

                    {user?.role === "tutor" && availability.length > 0 && (
                      <>
                        {GRID_HOURS.map((h) => {
                          const cellStart = h * 60;
                          const inWindow = dayAvailability.some((w) => {
                            const [wsH, wsM] = w.startTime.split(":").map(Number);
                            const [weH, weM] = w.endTime.split(":").map(Number);
                            return cellStart >= wsH * 60 + wsM && cellStart < weH * 60 + weM;
                          });
                          if (inWindow) return null;
                          return (
                            <div
                              key={`dim-${h}`}
                              className="pointer-events-none absolute inset-x-0 bg-[var(--cs-text)]/[0.04]"
                              style={{ top: (h - DAY_START_HOUR) * HOUR_PX, height: HOUR_PX }}
                            />
                          );
                        })}
                      </>
                    )}

                    {daySessions.map((session) => {
                      const l = layout.get(session.id) || { column: 0, columns: 1 };
                      const start = new Date(session.startTime);
                      const end = new Date(session.endTime);
                      const top = timeOffsetPx(start);
                      const height = Math.max(18, (end.getTime() - start.getTime()) / 60000 * PX_PER_MINUTE);
                      const widthPct = 100 / l.columns;
                      const isDraggingThis = drag?.sessionId === session.id;
                      return (
                        <div
                          key={session.id}
                          ref={(el) => { if (isDraggingThis) movingBlockElRef.current = el; }}
                          onPointerDown={(e) => startMoveDrag(e, session, dayIndex)}
                          onClick={(e) => { e.stopPropagation(); if (!drag) setSelectedSession(session); }}
                          className={`absolute cursor-grab select-none overflow-hidden rounded-[var(--cs-radius-control)] border px-1.5 py-0.5 text-[11px] transition-shadow active:cursor-grabbing ${isDraggingThis ? "shadow-[var(--cs-shadow-pop)]" : ""} ${sessionColor(session)}`}
                          style={{
                            top,
                            height,
                            left: `${l.column * widthPct}%`,
                            width: `calc(${widthPct}% - 2px)`,
                            zIndex: isDraggingThis ? 10 : 1,
                          }}
                        >
                          <div ref={(el) => { if (isDraggingThis) movingBlockTimeElRef.current = el; }} className="font-medium">{format(start, "h:mm a")}</div>
                          <div className="truncate opacity-80">{templateById.get(session.templateId || "")?.name || (session.studentIds.length > 1 ? t("schedule.batchLabel") : t("schedule.oneOnOneLabel"))}</div>
                          <div
                            onPointerDown={(e) => startResizeDrag(e, session, dayIndex)}
                            className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                          />
                        </div>
                      );
                    })}

                    {drag && drag.mode === "create" && drag.dayIndex === dayIndex && (
                      <div
                        ref={createPreviewElRef}
                        className="pointer-events-none absolute inset-x-1 rounded-[var(--cs-radius-control)] border-2 border-dashed border-[var(--cs-accent)] bg-[var(--cs-accent-soft)]"
                        style={{ top: timeOffsetPx(drag.currentStart), height: Math.max(18, (drag.currentEnd.getTime() - drag.currentStart.getTime()) / 60000 * PX_PER_MINUTE) }}
                      />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          {!loading && sessions.length === 0 && (
            <div className="border-t border-[var(--cs-border)] p-6">
              <EmptyState icon={CalendarIcon} title={t("schedule.noSessions")} description={t("schedule.noSessionsHint")} />
            </div>
          )}
        </div>
      ) : (
        <MonthView monthCursor={monthCursor} sessions={sessions} onSelect={setSelectedSession} onJumpToWeek={(d) => { setWeekStart(startOfWeek(d)); setView("week"); }} />
      )}

      {selectedSession && (
        <SessionPopover
          session={selectedSession}
          templateName={templateById.get(selectedSession.templateId || "")?.name}
          cancellationPolicy={cancellationPolicy}
          onClose={() => setSelectedSession(null)}
          onCancel={() => handleCancelSession(selectedSession.id)}
        />
      )}

      {scopePrompt && (
        <ScopeDialog
          onClose={() => setScopePrompt(null)}
          onJustThis={() => { commitReschedule(scopePrompt.session, scopePrompt.newStart, scopePrompt.newEnd); setScopePrompt(null); }}
          onFuture={() => commitScopeChange("future")}
        />
      )}

      {outsideHoursConfirm && (
        <OutsideHoursDialog
          onCancel={() => { outsideHoursConfirm.resolve(false); setOutsideHoursConfirm(null); }}
          onConfirm={() => { outsideHoursConfirm.resolve(true); setOutsideHoursConfirm(null); }}
        />
      )}

      {wizardOpen && (
        <ClassWizard
          prefill={wizardPrefill}
          onClose={() => setWizardOpen(false)}
          onCreated={() => { setWizardOpen(false); refetch(); }}
        />
      )}
    </div>
  );
}

function timeOffsetPx(date: Date) {
  return (minutesSinceMidnight(date) - DAY_START_HOUR * 60) * PX_PER_MINUTE;
}

// ---- Month view (density scanning) ----------------------------------------

function MonthView({
  monthCursor, sessions, onSelect, onJumpToWeek,
}: {
  monthCursor: Date;
  sessions: ScheduleSessionRow[];
  onSelect: (s: ScheduleSessionRow) => void;
  onJumpToWeek: (day: Date) => void;
}) {
  const { t } = useTranslation();
  const monthStart = startOfMonth(monthCursor);
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(monthEnd) });

  return (
    <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
      <div className="grid grid-cols-7 border-b border-[var(--cs-border)] bg-[var(--cs-surface-2)]">
        {DAY_LABELS.map((d) => (
          <div key={d} className="py-2 text-center text-xs font-semibold uppercase tracking-wide text-[var(--cs-text-muted)]">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7 auto-rows-fr">
        {days.map((day) => {
          const daySessions = sessions.filter((s) => isSameDay(new Date(s.startTime), day));
          const inMonth = isSameMonth(day, monthStart);
          return (
            <div
              key={day.toISOString()}
              onClick={() => onJumpToWeek(day)}
              className={`min-h-[110px] cursor-pointer border-b border-r border-[var(--cs-border)] p-2 transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)] ${inMonth ? "bg-[var(--cs-surface)]" : "bg-[var(--cs-surface-2)]/50"}`}
            >
              <span
                className={`text-sm ${
                  isSameDay(day, new Date())
                    ? "font-semibold text-[var(--cs-accent)]"
                    : inMonth
                      ? "text-[var(--cs-text)]"
                      : "text-[var(--cs-text-faint)]"
                }`}
              >
                {format(day, "d")}
              </span>
              <div className="mt-1 space-y-0.5">
                {daySessions.slice(0, 3).map((s) => (
                  <div
                    key={s.id}
                    onClick={(e) => { e.stopPropagation(); onSelect(s); }}
                    className={`truncate rounded-[var(--cs-radius-control)] border px-1 text-[10px] ${sessionColor(s)}`}
                  >
                    {format(new Date(s.startTime), "h:mm a")}
                  </div>
                ))}
                {daySessions.length > 3 && <div className="text-[10px] text-[var(--cs-text-muted)]">{t("schedule.moreCount", { count: daySessions.length - 3 })}</div>}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ---- Session details popover ------------------------------------------------

function SessionPopover({
  session, templateName, cancellationPolicy, onClose, onCancel,
}: {
  session: ScheduleSessionRow;
  templateName?: string;
  cancellationPolicy: CancellationPolicy;
  onClose: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const cutoff = cancellationCutoff(session.startTime, cancellationPolicy.freeHours);
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Modal onClose={onClose} labelledBy="session-popover-title" className="w-80 rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4 shadow-[var(--cs-shadow-pop)]">
        <div className="mb-3 flex items-start justify-between">
          <h3 id="session-popover-title" className="font-semibold text-[var(--cs-text)]">{t("schedule.sessionDetails")}</h3>
          <button onClick={onClose} className="text-[var(--cs-text-faint)] hover:text-[var(--cs-text-muted)]"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2 text-sm text-[var(--cs-text-muted)]">
          <div className="flex items-center gap-2"><Clock className="h-4 w-4" /> {format(new Date(session.startTime), "MMM d, yyyy h:mm a")}</div>
          {templateName && <div className="flex items-center gap-2"><CalendarIcon className="h-4 w-4" /> {templateName}</div>}
          <div className="flex items-center gap-2">
            {session.isOnline ? <Video className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
            {session.isOnline ? t("schedule.online") : t("schedule.room", { room: session.roomNumber || t("schedule.tbd") })}
          </div>
        </div>
        {session.status === "scheduled" && (
          <div className="mt-4 border-t border-[var(--cs-border)] pt-3">
            <p className="mb-2 text-xs text-[var(--cs-text-muted)]">
              {t("schedule.cancellationDisclosure", {
                cutoff: `${formatDate(cutoff)}, ${formatTime(cutoff)}`,
                feePercent: cancellationPolicy.lateFeePercent,
              })}
            </p>
            <button
              onClick={onCancel}
              className="w-full rounded-[var(--cs-radius-control)] bg-[var(--cs-danger-soft)] py-1.5 text-xs font-medium text-[var(--cs-danger)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:opacity-90"
            >
              {t("schedule.cancelSession")}
            </button>
          </div>
        )}
      </Modal>
    </div>
  );
}

function ScopeDialog({ onClose, onJustThis, onFuture }: { onClose: () => void; onJustThis: () => void; onFuture: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Modal onClose={onClose} labelledBy="scope-dialog-title" className="w-full max-w-sm rounded-[var(--cs-radius-container)] bg-[var(--cs-surface)] p-6 shadow-[var(--cs-shadow-pop)]">
        <h3 id="scope-dialog-title" className="mb-2 text-lg font-medium text-[var(--cs-text)]">{t("schedule.sessionDetails")}</h3>
        <p className="mb-4 text-sm text-[var(--cs-text-muted)]">{t("schedule.scopePrompt")}</p>
        <div className="flex flex-col gap-2">
          <Button variant="ghost" className="w-full" onClick={onJustThis}>{t("schedule.justThis")}</Button>
          <Button className="w-full" onClick={onFuture}>{t("schedule.thisAndFuture")}</Button>
        </div>
      </Modal>
    </div>
  );
}

function OutsideHoursDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <Modal onClose={onCancel} labelledBy="outside-hours-title" className="w-full max-w-sm rounded-[var(--cs-radius-container)] bg-[var(--cs-surface)] p-6 shadow-[var(--cs-shadow-pop)]">
        <p id="outside-hours-title" className="mb-4 text-sm text-[var(--cs-text)]">{t("schedule.outsideHours")}</p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>{t("schedule.cancel")}</Button>
          <Button onClick={onConfirm}>{t("schedule.bookAnyway")}</Button>
        </div>
      </Modal>
    </div>
  );
}

// ---- Class creation wizard --------------------------------------------------

function ClassWizard({
  prefill, onClose, onCreated,
}: {
  prefill: { startDate?: string; startTime?: string; duration?: number };
  onClose: () => void;
  onCreated: () => void;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [step, setStep] = useState(1);
  const [classType, setClassType] = useState<ScheduleClassType>("BATCH");
  const [courseId, setCourseId] = useState("");
  const [pricingModel, setPricingModel] = useState<SchedulePricingModel>("PER_SESSION");
  const [feeAmount, setFeeAmount] = useState(0);
  const [capacity, setCapacity] = useState(1);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [startDate, setStartDate] = useState(prefill.startDate || "");
  const [startTime, setStartTime] = useState(prefill.startTime || "");
  const [duration, setDuration] = useState(prefill.duration || 60);
  const [isOnline, setIsOnline] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  const [courses, setCourses] = useState<{ id: string; name: string }[]>([]);
  const [students, setStudents] = useState<{ id: string; name: string }[]>([]);
  const [gaps, setGaps] = useState<{ start: string; end: string }[] | null>(null);
  const [submitting, setSubmitting] = useState(false);

  React.useEffect(() => {
    if (!user?.organizationId) return;
    (async () => {
      const [{ data: courseRows }, { data: studentRows }] = await Promise.all([
        supabase.from("courses").select("id, name").eq("organization_id", user.organizationId).limit(100),
        // is_deleted: false — an archived or DPDP-erased student can't be enrolled in a new class
        supabase.from("students").select("id, name").eq("organization_id", user.organizationId).eq("is_deleted", false).limit(200),
      ]);
      setCourses(courseRows || []);
      setStudents(studentRows || []);
    })();
  }, [user?.organizationId]);

  function toggleDay(day: number) {
    setSelectedDays((prev) => (prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day]));
  }
  function toggleStudent(id: string) {
    setSelectedStudentIds((prev) => (prev.includes(id) ? prev.filter((s) => s !== id) : [...prev, id]));
  }

  async function handleFindGap() {
    if (!user?.id) return;
    try {
      const result = await findScheduleGaps(user.id, duration);
      setGaps(result.slots);
      if (result.slots.length === 0) toast.info(t("schedule.noGapsFound"));
      else toast.success(t("schedule.gapsFound", { count: result.slots.length }));
    } catch (err: any) {
      toast.error(err?.message || "Could not find a gap");
    }
  }

  function applyGap(slot: { start: string; end: string }) {
    const s = new Date(slot.start);
    const e = new Date(slot.end);
    setStartDate(format(s, "yyyy-MM-dd"));
    setStartTime(format(s, "HH:mm"));
    setDuration(Math.round((e.getTime() - s.getTime()) / 60000));
    setGaps(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!user?.organizationId) return;
    setSubmitting(true);
    try {
      const [hours, minutes] = startTime.split(":").map(Number);
      const courseName = courses.find((c) => c.id === courseId)?.name;

      const payload = buildClassTemplatePayload({
        organizationId: user.organizationId,
        tutorId: user.id,
        courseId,
        courseName,
        classType,
        pricingModel,
        feeAmount: Number(feeAmount),
        capacity: Number(capacity),
        daysOfWeek: classType === "BATCH" ? selectedDays : [],
        startHour: hours,
        startMinute: minutes,
        durationMinutes: duration,
        isOnline,
        roomNumber,
        studentIds: selectedStudentIds,
      });

      const { data: template, error: templateError } = await supabase.from("class_templates").insert(payload).select().single();
      if (templateError) throw templateError;

      if (classType === "ONE_ON_ONE" || classType === "CRASH_COURSE") {
        const start = new Date(startDate);
        start.setHours(hours, minutes, 0, 0);
        const end = new Date(start.getTime() + duration * 60 * 1000);
        await ClassManager.createSession({
          organizationId: user.organizationId,
          templateId: template.id,
          tutorId: user.id,
          studentIds: selectedStudentIds,
          startTime: start.toISOString(),
          endTime: end.toISOString(),
          status: "scheduled",
          isOnline,
          roomNumber,
        });
      } else {
        const result = await import("../lib/api").then((m) => m.api<{ conflicts: { date: string }[] }>("/scheduling/materialize", { method: "POST" }));
        if (result.conflicts.length > 0) {
          toast.warning(`${result.conflicts.length} session(s) skipped due to conflicts`);
        }
        for (const studentId of selectedStudentIds) {
          await ClassManager.enrollStudent(user.organizationId, studentId, template.id);
        }
      }

      toast.success(t("schedule.classCreated"));
      onCreated();
    } catch (err: any) {
      toast.error(t("schedule.classFailed"), { description: err?.message });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Modal onClose={onClose} labelledBy="class-wizard-title" className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-[var(--cs-radius-container)] bg-[var(--cs-surface)] shadow-[var(--cs-shadow-pop)]">
        <div className="flex items-center justify-between border-b border-[var(--cs-border)] bg-[var(--cs-surface-2)] px-6 py-4">
          <h3 id="class-wizard-title" className="text-lg font-semibold text-[var(--cs-text)]">{step === 1 ? t("schedule.selectClassType") : t("schedule.classDetails")}</h3>
          <button onClick={onClose} className="text-[var(--cs-text-faint)] hover:text-[var(--cs-text-muted)]"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={step === 1 ? (e) => { e.preventDefault(); setStep(2); } : handleSubmit}>
          <div className="space-y-6 px-6 py-6">
            {step === 1 ? (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {([
                  { type: "BATCH" as const, icon: Users, label: t("schedule.batch"), hint: t("schedule.batchHint") },
                  { type: "ONE_ON_ONE" as const, icon: User, label: t("schedule.oneOnOne"), hint: t("schedule.oneOnOneHint") },
                  { type: "CRASH_COURSE" as const, icon: CalendarIcon, label: t("schedule.crashCourse"), hint: t("schedule.crashCourseHint") },
                ]).map(({ type, icon: Icon, label, hint }) => (
                  <div
                    key={type}
                    onClick={() => setClassType(type)}
                    className={`cursor-pointer rounded-[var(--cs-radius-container)] border-2 p-4 transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] ${classType === type ? "border-[var(--cs-accent)] bg-[var(--cs-accent-soft)]" : "border-[var(--cs-border)] hover:border-[var(--cs-border-strong)]"}`}
                  >
                    <Icon className={`mb-3 h-7 w-7 ${classType === type ? "text-[var(--cs-accent)]" : "text-[var(--cs-text-faint)]"}`} />
                    <h4 className="font-semibold text-[var(--cs-text)]">{label}</h4>
                    <p className="mt-1 text-xs text-[var(--cs-text-muted)]">{hint}</p>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-6">
                  <Field label={t("schedule.course")} required>
                    <select required value={courseId} onChange={(e) => setCourseId(e.target.value)} className={SELECT_CLASS}>
                      <option value="" disabled>{t("schedule.selectCourse")}</option>
                      {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </Field>
                  {classType === "BATCH" && (
                    <Field label={t("schedule.capacity")} required>
                      <Input type="number" min={1} required value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} />
                    </Field>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <Field label={t("schedule.pricingModel")}>
                    <select value={pricingModel} onChange={(e) => setPricingModel(e.target.value as SchedulePricingModel)} className={SELECT_CLASS}>
                      <option value="PER_SESSION">{t("schedule.perSession")}</option>
                      <option value="MONTHLY">{t("schedule.monthly")}</option>
                    </select>
                  </Field>
                  <Field label={t("schedule.feeAmount")} required>
                    <Input type="number" min={0} step="0.01" required value={feeAmount} onChange={(e) => setFeeAmount(Number(e.target.value))} />
                  </Field>
                </div>

                {classType === "BATCH" && (
                  <div>
                    <label className="mb-2 block text-xs font-medium text-[var(--cs-text-muted)]">{t("schedule.recurringPattern")}</label>
                    <div className="flex gap-2">
                      {DAY_LABELS.map((d, idx) => (
                        <button
                          key={d}
                          type="button"
                          onClick={() => toggleDay(idx)}
                          className={`h-10 w-10 rounded-full text-sm font-medium transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] ${selectedDays.includes(idx) ? "bg-[var(--cs-accent)] text-[var(--cs-accent-contrast)]" : "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)] hover:bg-[var(--cs-border)]"}`}
                        >
                          {d[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4">
                  <Field label={t("schedule.startDate")} required>
                    <Input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />
                  </Field>
                  <Field label={t("schedule.startTime")} required>
                    <Input type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} />
                  </Field>
                  <Field label={t("schedule.duration")}>
                    <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className={SELECT_CLASS}>
                      {[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{t("schedule.durationMins", { count: m })}</option>)}
                    </select>
                  </Field>
                </div>

                {classType === "ONE_ON_ONE" && (
                  <div>
                    <Button type="button" variant="quiet" size="sm" icon={Search} className="px-0 hover:bg-transparent" onClick={handleFindGap}>
                      {t("schedule.findGap")}
                    </Button>
                    {gaps && gaps.length > 0 && (
                      <div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] p-2">
                        {gaps.map((g) => (
                          <button
                            key={g.start}
                            type="button"
                            onClick={() => applyGap(g)}
                            className="block w-full rounded-[var(--cs-radius-control)] px-2 py-1 text-left text-xs text-[var(--cs-text)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)]"
                          >
                            {format(new Date(g.start), "EEE MMM d, h:mm a")}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="mb-2 block text-xs font-medium text-[var(--cs-text-muted)]">{t("schedule.students")}</label>
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] p-2">
                    {students.map((s) => (
                      <label key={s.id} className="flex cursor-pointer items-center rounded-[var(--cs-radius-control)] p-2 transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)]">
                        <input type="checkbox" checked={selectedStudentIds.includes(s.id)} onChange={() => toggleStudent(s.id)} className="h-4 w-4 rounded border-[var(--cs-border-strong)] text-[var(--cs-accent)] focus:ring-[var(--cs-focus)]" />
                        <span className="ml-3 text-sm text-[var(--cs-text)]">{s.name}</span>
                      </label>
                    ))}
                    {students.length === 0 && <p className="p-2 text-sm text-[var(--cs-text-muted)]">{t("schedule.noStudents")}</p>}
                  </div>
                  {classType === "BATCH" && capacity > 0 && (
                    <div className="mt-2 text-xs text-[var(--cs-text-muted)]">{selectedStudentIds.length} / {capacity}</div>
                  )}
                </div>

                <div className="border-t border-[var(--cs-border)] pt-4">
                  <h4 className="mb-3 text-xs font-medium text-[var(--cs-text-muted)]">{t("schedule.location")}</h4>
                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2 text-sm text-[var(--cs-text)]">
                      <input type="radio" checked={!isOnline} onChange={() => setIsOnline(false)} className="text-[var(--cs-accent)] focus:ring-[var(--cs-focus)]" /> {t("schedule.inPerson")}
                    </label>
                    <label className="flex items-center gap-2 text-sm text-[var(--cs-text)]">
                      <input type="radio" checked={isOnline} onChange={() => setIsOnline(true)} className="text-[var(--cs-accent)] focus:ring-[var(--cs-focus)]" /> {t("schedule.online")}
                    </label>
                  </div>
                  {!isOnline && (
                    <Input type="text" placeholder={t("schedule.roomNumber")} value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} className="mt-3" />
                  )}
                </div>
              </>
            )}
          </div>

          <div className="flex justify-between border-t border-[var(--cs-border)] bg-[var(--cs-surface-2)] px-6 py-4">
            {step === 2 ? (
              <Button type="button" variant="ghost" onClick={() => setStep(1)}>{t("schedule.back")}</Button>
            ) : (
              <Button type="button" variant="ghost" onClick={onClose}>{t("schedule.cancel")}</Button>
            )}
            <Button type="submit" disabled={submitting}>
              {step === 1 ? t("schedule.continue") : t("schedule.createClass")}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
