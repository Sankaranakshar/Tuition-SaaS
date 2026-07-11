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
import { ClassManager, ClassType, PricingModel } from "../services/ClassManager";
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
import { EmptyState } from "../components/kit";
import { supabase } from "../supabase";

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

const DAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAY_START_HOUR = 7;
const DAY_END_HOUR = 21;
const HOUR_PX = 56;
const PX_PER_MINUTE = HOUR_PX / 60;
const GRID_HOURS = Array.from({ length: DAY_END_HOUR - DAY_START_HOUR }, (_, i) => DAY_START_HOUR + i);

function toLocalIso(date: Date) {
  return date.toISOString();
}

function sessionColor(session: ScheduleSessionRow) {
  if (session.status === "cancelled") return "bg-[var(--cs-danger-bg,#fee2e2)] border-[var(--cs-danger)] text-[var(--cs-danger)] line-through opacity-70";
  if (session.status === "completed") return "bg-[var(--cs-ok-bg,#dcfce7)] border-[var(--cs-ok)] text-[var(--cs-ok)]";
  return session.studentIds.length <= 1
    ? "bg-[var(--cs-accent-bg,#ede9fe)] border-[var(--cs-accent)] text-[var(--cs-accent)]"
    : "bg-[var(--cs-info-bg,#dbeafe)] border-[var(--cs-info,#2563eb)] text-[var(--cs-info,#2563eb)]";
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
        <h1 className="text-2xl font-bold text-[var(--cs-text)]">{t("schedule.myWeek")}</h1>
        <div className="flex items-center gap-1 rounded-md border border-[var(--cs-border)] bg-white p-1">
          <button onClick={() => setWeekStart(subWeeks(weekStart, 1))} className="rounded p-1 hover:bg-gray-100">
            <ChevronLeft className="h-4 w-4" />
          </button>
          <span className="w-40 text-center text-sm font-medium text-[var(--cs-text)]">
            {format(weekStart, "MMM d")} – {format(addDays(weekStart, 6), "MMM d, yyyy")}
          </span>
          <button onClick={() => setWeekStart(addWeeks(weekStart, 1))} className="rounded p-1 hover:bg-gray-100">
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
            <div key={day.toISOString()} className="rounded-xl border border-[var(--cs-border)] bg-white p-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[var(--cs-text-muted)]">
                {format(day, "EEE d")}
              </p>
              <div className="space-y-2">
                {daySessions.map((s) => (
                  <div key={s.id} className={`rounded border p-2 text-xs ${sessionColor(s)}`}>
                    <div className="font-medium">{format(new Date(s.startTime), "h:mm a")}</div>
                    <div className="flex items-center gap-1 opacity-80">
                      {s.isOnline ? <Video className="h-3 w-3" /> : <MapPin className="h-3 w-3" />}
                      {s.isOnline ? "Online" : s.roomNumber || "TBD"}
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

  const [selectedSession, setSelectedSession] = useState<ScheduleSessionRow | null>(null);
  const [drag, setDrag] = useState<DragState | null>(null);
  const [scopePrompt, setScopePrompt] = useState<ScopePromptState | null>(null);
  const [outsideHoursConfirm, setOutsideHoursConfirm] = useState<{ resolve: (ok: boolean) => void } | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const gridRef = useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (searchParams.get("new") === "1") {
      setWizardPrefill({});
      setWizardOpen(true);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const templateById = useMemo(() => new Map(templates.map((t) => [t.id, t])), [templates]);

  React.useEffect(() => {
    if (!drag) return;
    const onMove = (e: PointerEvent) => handlePointerMove(e);
    const onUp = () => handlePointerUp();
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

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
    if (e.target !== e.currentTarget) return; // ignore clicks landing on a session block
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
    setDrag((prev) => {
      if (!prev) return prev;
      const { dayIndex: liveDayIndex, offsetMinutes } = offsetMinutesFromPointer(e, prev.dayIndex);

      if (prev.mode === "create") {
        const deltaMinutes = offsetMinutes - prev.startOffsetMinutes;
        const start = prev.currentStart;
        const durationMinutes = Math.max(15, deltaMinutes);
        const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
        return { ...prev, currentEnd: end };
      }
      if (prev.mode === "move" && prev.originalStart && prev.originalEnd) {
        // Use the day column under the pointer right now, not the one the
        // drag started in — otherwise dragging a session to a different day
        // silently only changes its time-of-day and leaves it on the
        // original day (a real bug caught during verification: the server
        // then sees no conflict because the session never actually moved).
        const durationMs = prev.originalEnd.getTime() - prev.originalStart.getTime();
        const day = days[liveDayIndex];
        const newStart = new Date(day);
        newStart.setHours(0, 0, 0, 0);
        newStart.setMinutes(offsetMinutes);
        const newEnd = new Date(newStart.getTime() + durationMs);
        return { ...prev, dayIndex: liveDayIndex, currentStart: newStart, currentEnd: newEnd };
      }
      if (prev.mode === "resize" && prev.originalStart) {
        const newEndMinutes = Math.max(minutesSinceMidnight(prev.originalStart) + 15, offsetMinutes);
        const newEnd = new Date(prev.originalStart);
        newEnd.setHours(0, 0, 0, 0);
        newEnd.setMinutes(newEndMinutes);
        return { ...prev, currentEnd: newEnd };
      }
      return prev;
    });
  }

  async function handlePointerUp() {
    const current = drag;
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
          <h1 className="text-2xl font-bold text-[var(--cs-text)]">{t("nav.schedule")}</h1>
          <div className="flex items-center gap-1 rounded-md border border-[var(--cs-border)] bg-white p-1">
            <button
              onClick={() => (view === "week" ? setWeekStart(subWeeks(weekStart, 1)) : setMonthCursor(addDays(startOfMonth(monthCursor), -1)))}
              className="rounded p-1 hover:bg-gray-100"
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
              className="rounded p-1 hover:bg-gray-100"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="flex items-center gap-1 rounded-md border border-[var(--cs-border)] bg-white p-1 text-sm">
            <button
              onClick={() => setView("week")}
              className={`rounded px-2 py-1 ${view === "week" ? "bg-[var(--cs-accent)] text-white" : "text-[var(--cs-text-muted)]"}`}
            >
              {t("schedule.week")}
            </button>
            <button
              onClick={() => setView("month")}
              className={`rounded px-2 py-1 ${view === "month" ? "bg-[var(--cs-accent)] text-white" : "text-[var(--cs-text-muted)]"}`}
            >
              {t("schedule.month")}
            </button>
          </div>
        </div>
        <button
          onClick={() => { setWizardPrefill({}); setWizardOpen(true); }}
          className="flex items-center gap-2 rounded-md bg-[var(--cs-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> {t("schedule.addClass")}
        </button>
      </div>

      {view === "week" ? (
        <div className="overflow-hidden rounded-xl border border-[var(--cs-border)] bg-white">
          <div className="grid grid-cols-[56px_repeat(7,1fr)] border-b border-[var(--cs-border)] bg-gray-50">
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
                // While a session is mid-drag, always pull it out of its
                // natural (pre-drag) day grouping and instead render it only
                // in whichever column the pointer is over right now, so the
                // preview actually follows the drag across day columns.
                const isDraggingMove = drag?.mode === "move";
                let daySessions = sessions.filter((s) => isSameDay(new Date(s.startTime), day) && !(isDraggingMove && drag!.sessionId === s.id));
                if (isDraggingMove && drag!.dayIndex === dayIndex) {
                  const draggedSession = sessions.find((s) => s.id === drag!.sessionId);
                  if (draggedSession) daySessions = [...daySessions, draggedSession];
                }
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
                              className="pointer-events-none absolute inset-x-0 bg-black/[0.03]"
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
                      const displayStart = isDraggingThis ? drag!.currentStart : start;
                      const displayEnd = isDraggingThis ? drag!.currentEnd : end;
                      return (
                        <div
                          key={session.id}
                          onPointerDown={(e) => startMoveDrag(e, session, dayIndex)}
                          onClick={(e) => { e.stopPropagation(); if (!drag) setSelectedSession(session); }}
                          className={`absolute cursor-grab select-none overflow-hidden rounded border px-1.5 py-0.5 text-[11px] shadow-sm active:cursor-grabbing ${sessionColor(session)}`}
                          style={{
                            top: isDraggingThis ? timeOffsetPx(displayStart) : top,
                            height: isDraggingThis ? Math.max(18, (displayEnd.getTime() - displayStart.getTime()) / 60000 * PX_PER_MINUTE) : height,
                            left: `${l.column * widthPct}%`,
                            width: `calc(${widthPct}% - 2px)`,
                            zIndex: isDraggingThis ? 10 : 1,
                          }}
                        >
                          <div className="font-medium">{format(displayStart, "h:mm a")}</div>
                          <div className="truncate opacity-80">{templateById.get(session.templateId || "")?.name || (session.studentIds.length > 1 ? "Batch" : "1:1")}</div>
                          <div
                            onPointerDown={(e) => startResizeDrag(e, session, dayIndex)}
                            className="absolute inset-x-0 bottom-0 h-1.5 cursor-ns-resize"
                          />
                        </div>
                      );
                    })}

                    {drag && drag.mode === "create" && drag.dayIndex === dayIndex && (
                      <div
                        className="pointer-events-none absolute inset-x-1 rounded border-2 border-dashed border-[var(--cs-accent)] bg-[var(--cs-accent)]/10"
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
          tutorAvailability={availability}
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
  const monthStart = startOfMonth(monthCursor);
  const monthEnd = endOfMonth(monthStart);
  const days = eachDayOfInterval({ start: startOfWeek(monthStart), end: endOfWeek(monthEnd) });

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--cs-border)] bg-white">
      <div className="grid grid-cols-7 border-b border-[var(--cs-border)] bg-gray-50">
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
              className={`min-h-[110px] cursor-pointer border-b border-r border-[var(--cs-border)] p-2 hover:bg-gray-50 ${inMonth ? "bg-white" : "bg-gray-50/50"}`}
            >
              <span className={`text-sm ${inMonth ? "text-[var(--cs-text)]" : "text-gray-400"} ${isSameDay(day, new Date()) ? "font-bold text-[var(--cs-accent)]" : ""}`}>
                {format(day, "d")}
              </span>
              <div className="mt-1 space-y-0.5">
                {daySessions.slice(0, 3).map((s) => (
                  <div
                    key={s.id}
                    onClick={(e) => { e.stopPropagation(); onSelect(s); }}
                    className={`truncate rounded border px-1 text-[10px] ${sessionColor(s)}`}
                  >
                    {format(new Date(s.startTime), "h:mm a")}
                  </div>
                ))}
                {daySessions.length > 3 && <div className="text-[10px] text-[var(--cs-text-muted)]">+{daySessions.length - 3} more</div>}
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
  session, templateName, onClose, onCancel,
}: {
  session: ScheduleSessionRow;
  templateName?: string;
  onClose: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-80 rounded-lg border border-[var(--cs-border)] bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <h3 className="font-semibold text-[var(--cs-text)]">{t("schedule.sessionDetails")}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-4 w-4" /></button>
        </div>
        <div className="space-y-2 text-sm text-[var(--cs-text-muted)]">
          <div className="flex items-center gap-2"><Clock className="h-4 w-4" /> {format(new Date(session.startTime), "MMM d, yyyy h:mm a")}</div>
          {templateName && <div className="flex items-center gap-2"><CalendarIcon className="h-4 w-4" /> {templateName}</div>}
          <div className="flex items-center gap-2">
            {session.isOnline ? <Video className="h-4 w-4" /> : <MapPin className="h-4 w-4" />}
            {session.isOnline ? "Online" : `Room: ${session.roomNumber || "TBD"}`}
          </div>
        </div>
        {session.status === "scheduled" && (
          <div className="mt-4 border-t border-[var(--cs-border)] pt-3">
            <button onClick={onCancel} className="w-full rounded bg-[var(--cs-danger)]/10 py-1.5 text-xs font-medium text-[var(--cs-danger)] hover:bg-[var(--cs-danger)]/20">
              {t("schedule.cancelSession")}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function ScopeDialog({ onClose, onJustThis, onFuture }: { onClose: () => void; onJustThis: () => void; onFuture: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <h3 className="mb-2 text-lg font-medium text-[var(--cs-text)]">{t("schedule.sessionDetails")}</h3>
        <p className="mb-4 text-sm text-[var(--cs-text-muted)]">{t("schedule.scopePrompt")}</p>
        <div className="flex flex-col gap-2">
          <button onClick={onJustThis} className="w-full rounded-md border border-[var(--cs-border)] py-2 text-sm font-medium text-[var(--cs-text)] hover:bg-gray-50">
            {t("schedule.justThis")}
          </button>
          <button onClick={onFuture} className="w-full rounded-md bg-[var(--cs-accent)] py-2 text-sm font-medium text-white hover:opacity-90">
            {t("schedule.thisAndFuture")}
          </button>
        </div>
      </div>
    </div>
  );
}

function OutsideHoursDialog({ onCancel, onConfirm }: { onCancel: () => void; onConfirm: () => void }) {
  const { t } = useTranslation();
  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/50 p-4" onClick={onCancel}>
      <div className="w-full max-w-sm rounded-xl bg-white p-6 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="mb-4 text-sm text-[var(--cs-text)]">{t("schedule.outsideHours")}</p>
        <div className="flex justify-end gap-2">
          <button onClick={onCancel} className="rounded-md border border-[var(--cs-border)] px-4 py-2 text-sm font-medium text-[var(--cs-text)] hover:bg-gray-50">
            {t("schedule.cancel")}
          </button>
          <button onClick={onConfirm} className="rounded-md bg-[var(--cs-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90">
            {t("schedule.bookAnyway")}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---- Class creation wizard --------------------------------------------------

function ClassWizard({
  prefill, tutorAvailability, onClose, onCreated,
}: {
  prefill: { startDate?: string; startTime?: string; duration?: number };
  tutorAvailability: { dayOfWeek: number; startTime: string; endTime: string }[];
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
        supabase.from("students").select("id, name").eq("organization_id", user.organizationId).limit(200),
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
      <div className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-[var(--cs-border)] bg-gray-50 px-6 py-4">
          <h3 className="text-lg font-semibold text-[var(--cs-text)]">{step === 1 ? t("schedule.selectClassType") : t("schedule.classDetails")}</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
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
                    className={`cursor-pointer rounded-xl border-2 p-4 transition-all ${classType === type ? "border-[var(--cs-accent)] bg-[var(--cs-accent)]/10" : "border-[var(--cs-border)] hover:border-[var(--cs-accent)]/50"}`}
                  >
                    <Icon className={`mb-3 h-7 w-7 ${classType === type ? "text-[var(--cs-accent)]" : "text-gray-400"}`} />
                    <h4 className="font-semibold text-[var(--cs-text)]">{label}</h4>
                    <p className="mt-1 text-xs text-[var(--cs-text-muted)]">{hint}</p>
                  </div>
                ))}
              </div>
            ) : (
              <>
                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[var(--cs-text)]">{t("schedule.course")}</label>
                    <select required value={courseId} onChange={(e) => setCourseId(e.target.value)} className="w-full rounded-md border border-[var(--cs-border)] px-3 py-2 text-sm">
                      <option value="" disabled>{t("schedule.selectCourse")}</option>
                      {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                  {classType === "BATCH" && (
                    <div>
                      <label className="mb-1 block text-sm font-medium text-[var(--cs-text)]">{t("schedule.capacity")}</label>
                      <input type="number" min={1} required value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} className="w-full rounded-md border border-[var(--cs-border)] px-3 py-2 text-sm" />
                    </div>
                  )}
                </div>

                <div className="grid grid-cols-2 gap-6">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[var(--cs-text)]">{t("schedule.pricingModel")}</label>
                    <select value={pricingModel} onChange={(e) => setPricingModel(e.target.value as SchedulePricingModel)} className="w-full rounded-md border border-[var(--cs-border)] px-3 py-2 text-sm">
                      <option value="PER_SESSION">{t("schedule.perSession")}</option>
                      <option value="MONTHLY">{t("schedule.monthly")}</option>
                    </select>
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[var(--cs-text)]">{t("schedule.feeAmount")}</label>
                    <input type="number" min={0} step="0.01" required value={feeAmount} onChange={(e) => setFeeAmount(Number(e.target.value))} className="w-full rounded-md border border-[var(--cs-border)] px-3 py-2 text-sm" />
                  </div>
                </div>

                {classType === "BATCH" && (
                  <div>
                    <label className="mb-2 block text-sm font-medium text-[var(--cs-text)]">{t("schedule.recurringPattern")}</label>
                    <div className="flex gap-2">
                      {DAY_LABELS.map((d, idx) => (
                        <button key={d} type="button" onClick={() => toggleDay(idx)} className={`h-10 w-10 rounded-full text-sm font-medium ${selectedDays.includes(idx) ? "bg-[var(--cs-accent)] text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
                          {d[0]}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[var(--cs-text)]">{t("schedule.startDate")}</label>
                    <input type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} className="w-full rounded-md border border-[var(--cs-border)] px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[var(--cs-text)]">{t("schedule.startTime")}</label>
                    <input type="time" required value={startTime} onChange={(e) => setStartTime(e.target.value)} className="w-full rounded-md border border-[var(--cs-border)] px-3 py-2 text-sm" />
                  </div>
                  <div>
                    <label className="mb-1 block text-sm font-medium text-[var(--cs-text)]">{t("schedule.duration")}</label>
                    <select value={duration} onChange={(e) => setDuration(Number(e.target.value))} className="w-full rounded-md border border-[var(--cs-border)] px-3 py-2 text-sm">
                      {[30, 45, 60, 90, 120].map((m) => <option key={m} value={m}>{m} mins</option>)}
                    </select>
                  </div>
                </div>

                {classType === "ONE_ON_ONE" && (
                  <div>
                    <button type="button" onClick={handleFindGap} className="flex items-center gap-1 text-sm font-medium text-[var(--cs-accent)] hover:opacity-80">
                      <Search className="h-4 w-4" /> {t("schedule.findGap")}
                    </button>
                    {gaps && gaps.length > 0 && (
                      <div className="mt-2 max-h-32 space-y-1 overflow-y-auto rounded-md border border-[var(--cs-border)] p-2">
                        {gaps.map((g) => (
                          <button
                            key={g.start}
                            type="button"
                            onClick={() => applyGap(g)}
                            className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-gray-50"
                          >
                            {format(new Date(g.start), "EEE MMM d, h:mm a")}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                )}

                <div>
                  <label className="mb-2 block text-sm font-medium text-[var(--cs-text)]">{t("schedule.students")}</label>
                  <div className="max-h-32 space-y-1 overflow-y-auto rounded-md border border-[var(--cs-border)] p-2">
                    {students.map((s) => (
                      <label key={s.id} className="flex cursor-pointer items-center rounded p-2 hover:bg-gray-50">
                        <input type="checkbox" checked={selectedStudentIds.includes(s.id)} onChange={() => toggleStudent(s.id)} className="h-4 w-4 rounded border-gray-300" />
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
                  <h4 className="mb-3 text-sm font-medium text-[var(--cs-text)]">{t("schedule.location")}</h4>
                  <div className="flex items-center gap-6">
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={!isOnline} onChange={() => setIsOnline(false)} /> {t("schedule.inPerson")}
                    </label>
                    <label className="flex items-center gap-2">
                      <input type="radio" checked={isOnline} onChange={() => setIsOnline(true)} /> {t("schedule.online")}
                    </label>
                  </div>
                  {!isOnline && (
                    <input type="text" placeholder={t("schedule.roomNumber")} value={roomNumber} onChange={(e) => setRoomNumber(e.target.value)} className="mt-3 w-full rounded-md border border-[var(--cs-border)] px-3 py-2 text-sm" />
                  )}
                </div>
              </>
            )}
          </div>

          <div className="flex justify-between border-t border-[var(--cs-border)] bg-gray-50 px-6 py-4">
            {step === 2 ? (
              <button type="button" onClick={() => setStep(1)} className="rounded-md border border-[var(--cs-border)] px-4 py-2 text-sm font-medium text-[var(--cs-text)] hover:bg-gray-50">
                {t("schedule.back")}
              </button>
            ) : (
              <button type="button" onClick={onClose} className="rounded-md border border-[var(--cs-border)] px-4 py-2 text-sm font-medium text-[var(--cs-text)] hover:bg-gray-50">
                {t("schedule.cancel")}
              </button>
            )}
            <button type="submit" disabled={submitting} className="rounded-md bg-[var(--cs-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50">
              {step === 1 ? t("schedule.continue") : t("schedule.createClass")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
