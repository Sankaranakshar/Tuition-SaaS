import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import { toast } from "sonner";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  Video,
  MapPin,
  Clock,
  CalendarClock,
  Receipt,
  UserMinus,
  Flame,
  AlertTriangle,
  Phone,
  Inbox,
  CheckCircle2,
  Check,
  BellOff,
  X,
  Users,
} from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { StatChip, StatusChip, AgedBadge, EmptyState, SkeletonRow, Skeleton, Popover, BottomSheet, Button } from "../components/kit";
import { formatPaise, formatTime } from "../lib/format";
import { markAttendance, type AttendanceStatus } from "../lib/api";
import { debounce } from "../lib/debounce";
import { useIsMobile } from "../hooks/useIsMobile";
import { useSwipeAction } from "../hooks/useSwipeAction";
import StudentDashboard from "./StudentDashboard";
import ParentPortal from "./ParentPortal";
import {
  sessionPhase,
  minutesUntilStart,
  nowCursorIndex,
  sessionsForDay,
  attendanceDebt,
  buildPulse,
  buildAttentionQueue,
  type TodaySession,
  type TodayInvoice,
  type TodayLead,
  type TodayStudent,
  type TodayAttendance,
  type QueueItem,
  type SessionPhase,
} from "../lib/today";

// The Today workspace (DEV_PLAN Epic 9): the tutor/owner's home. The Line of
// today's sessions with one-tap attendance, the rules-based attention queue,
// the three-number Pulse, and an attendance-debt counter. Money and attendance
// still mutate only through the server API (src/lib/api.ts); this page reads
// live and writes exactly one thing: attendance, optimistically with undo.

type Translate = (key: string, opts?: Record<string, unknown>) => string;

// --- Supabase row -> TodayX shape mappers (rows are snake_case; the rest of
// this page and lib/today.ts speak the camelCase shapes below unchanged). ---

function rowToSession(row: any): TodaySession {
  return {
    id: row.id,
    organizationId: row.organization_id,
    tutorId: row.tutor_id,
    templateId: row.template_id,
    studentIds: row.student_ids || [],
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
    isOnline: row.is_online,
    meetingLink: row.meeting_link,
    roomNumber: row.room_number,
    attendanceMarkedAt: row.attendance_marked_at,
  };
}

function rowToStudent(row: any): TodayStudent {
  return {
    id: row.id,
    name: row.name,
    tutorId: row.tutor_id,
    parentName: row.parent_name,
    parentPhone: row.parent_phone,
    phone: row.phone,
  };
}

function rowToInvoice(row: any): TodayInvoice {
  return {
    id: row.id,
    studentId: row.student_id,
    status: row.status,
    dueDate: row.due_date,
    totalPaise: row.total_paise,
    paidPaise: row.paid_paise,
    totalAmount: row.total_amount,
    createdAt: row.created_at,
    lastPaymentAt: row.last_payment_at,
  };
}

function rowToLead(row: any): TodayLead {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    updatedAt: row.updated_at,
    createdAt: row.created_at,
  };
}

function rowToAttendance(row: any): TodayAttendance {
  return {
    studentId: row.student_id,
    status: row.status,
    sessionStart: row.session_start,
    sessionId: row.session_id,
  };
}

const STATUS_CYCLE: AttendanceStatus[] = ["present", "absent", "late", "excused"];
const STATUS_TONE: Record<AttendanceStatus, "positive" | "danger" | "warn" | "neutral"> = {
  present: "positive",
  absent: "danger",
  late: "warn",
  excused: "neutral",
};
const STATUS_LABEL_KEY: Record<AttendanceStatus, string> = {
  present: "today.statusPresent",
  absent: "today.statusAbsent",
  late: "today.statusLate",
  excused: "today.statusExcused",
};

// Shared section label (direction.html .section > .label): 12/600, tracked, faint.
const SECTION_LABEL = "mb-3 text-xs font-semibold uppercase tracking-[0.06em] text-[var(--cs-text-faint)]";

export default function Today() {
  const { user, currentRole } = useAuth();

  // Students get the study-focused home; parents get their children overview
  // (Epic 10); this workspace is for the business.
  if (currentRole === "student") return <StudentDashboard />;
  if (currentRole === "parent") return <ParentPortal />;

  return <StaffToday user={user} currentRole={currentRole} />;
}

function StaffToday({ user, currentRole }: { user: any; currentRole: string | null }) {
  const { t } = useTranslation();
  const orgId = user?.organizationId as string | undefined;
  const isTutor = (currentRole || user?.role) === "tutor";
  const isAdminTier = user?.organizationRole === "owner" || user?.organizationRole === "admin";

  const [sessions, setSessions] = useState<TodaySession[] | null>(null);
  const [invoices, setInvoices] = useState<TodayInvoice[]>([]);
  const [leads, setLeads] = useState<TodayLead[]>([]);
  const [students, setStudents] = useState<TodayStudent[]>([]);
  const [attendance, setAttendance] = useState<TodayAttendance[]>([]);
  const [tutorNames, setTutorNames] = useState<Record<string, string>>({});

  // A clock that ticks each minute so the now-cursor and phase actions stay
  // live as sessions cross their boundaries (E9.1 acceptance).
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Client overlay for optimistic marking (E9.2): a session shows as done the
  // instant the roster is confirmed; the real API call is deferred so Undo can
  // cancel it before anything bills.
  const [markedLocally, setMarkedLocally] = useState<Record<string, boolean>>({});
  const pending = useRef<Map<string, { timer: ReturnType<typeof setTimeout>; flush: () => void }>>(new Map());
  const mounted = useRef(true);
  useEffect(() => {
    return () => {
      mounted.current = false;
      // Leaving the page must not silently drop an in-flight mark: flush any
      // pending commits (the API is idempotent) rather than cancelling them.
      Array.from(pending.current.values()).forEach(({ timer, flush }) => {
        clearTimeout(timer);
        flush();
      });
    };
  }, []);

  // Snooze/dismiss state for the queue, persisted per org.
  const hiddenKey = `today.queue.hidden.${orgId || "anon"}`;
  const [hidden, setHidden] = useState<Record<string, number>>({});
  useEffect(() => {
    try {
      const raw = localStorage.getItem(hiddenKey);
      const parsed = raw ? (JSON.parse(raw) as Record<string, number>) : {};
      // Drop expired snoozes on load.
      const live: Record<string, number> = {};
      for (const [k, v] of Object.entries(parsed)) if (v > Date.now()) live[k] = v;
      setHidden(live);
    } catch {
      setHidden({});
    }
  }, [hiddenKey]);
  const hideItem = useCallback(
    (id: string, ms: number) => {
      setHidden((prev) => {
        const next = { ...prev, [id]: Date.now() + ms };
        try {
          localStorage.setItem(hiddenKey, JSON.stringify(next));
        } catch {
          /* storage full / disabled; snooze is best-effort */
        }
        return next;
      });
    },
    [hiddenKey]
  );

  // --- Live, bounded listeners (E4.1 hygiene) ---
  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;

    // Sessions: 8 days back (covers the 7-day debt window) through the future
    // week, so the Line, debt counter, conflicts, and Pulse all have their data.
    const windowStart = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    const loadSessions = async () => {
      let q = supabase
        .from("class_sessions")
        .select("*")
        .eq("organization_id", orgId)
        .gte("start_time", windowStart)
        .order("start_time", { ascending: true })
        .limit(300);
      if (isTutor) q = q.eq("tutor_id", user.id);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        console.error("Today: sessions listener", error);
        setSessions([]);
      } else {
        setSessions((data || []).map(rowToSession));
      }
    };

    const loadStudents = async () => {
      let q = supabase.from("students").select("*").eq("organization_id", orgId).limit(500);
      if (isTutor) q = q.eq("tutor_id", user.id);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) console.error("Today: students listener", error);
      else setStudents((data || []).map(rowToStudent));
    };

    const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const loadInvoices = async () => {
      let q = supabase
        .from("invoices")
        .select("*")
        .eq("organization_id", orgId)
        .gte("created_at", yearAgo)
        .limit(500);
      if (isTutor) q = q.eq("tutor_id", user.id);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) console.error("Today: invoices listener", error);
      else setInvoices((data || []).map(rowToInvoice));
    };

    // Attendance for absence-streak detection: recent window, capped.
    const loadAttendance = async () => {
      const { data, error } = await supabase
        .from("attendance_records")
        .select("*")
        .eq("organization_id", orgId)
        .limit(500);
      if (cancelled) return;
      if (error) console.error("Today: attendance listener", error);
      else setAttendance((data || []).map(rowToAttendance));
    };

    // Leads only matter to the queue and only for admin-tier/frontdesk; tutors
    // don't chase leads, so skip the read for them.
    const loadLeads = async () => {
      if (isTutor) {
        setLeads([]);
        return;
      }
      const { data, error } = await supabase.from("leads").select("*").eq("organization_id", orgId).limit(200);
      if (cancelled) return;
      if (error) console.error("Today: leads listener", error);
      else setLeads((data || []).map(rowToLead));
    };

    // Tutor names for the admin variant's stacked lanes (E9.6). Names live on
    // profiles, not tutor_profiles (which has no name column).
    const loadTutors = async () => {
      if (!isAdminTier) {
        setTutorNames({});
        return;
      }
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name")
        .eq("organization_id", orgId)
        .eq("role_type", "tutor")
        .limit(100);
      if (cancelled) return;
      if (error) {
        console.error("Today: tutors listener", error);
        return;
      }
      const map: Record<string, string> = {};
      (data || []).forEach((r: any) => (map[r.id] = r.name || "Tutor"));
      setTutorNames(map);
    };

    const loadAll = () => {
      loadSessions();
      loadStudents();
      loadInvoices();
      loadAttendance();
      loadLeads();
      loadTutors();
    };
    loadAll();

    // postgres_changes filters only support one simple column=eq condition
    // server-side, so subscribe on organization_id (broadest safe scope) and
    // let each load() reapply its own role/time filters on refetch. Debounced
    // per table so a burst (e.g. the Monday-6pm attendance-mark scenario
    // DEV_PLAN's k6 script targets) collapses into one reload each, not one
    // per event.
    const channel = supabase
      .channel(`today-${orgId}-${isTutor ? user?.id : "all"}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "class_sessions", filter: `organization_id=eq.${orgId}` }, debounce(loadSessions, 200))
      .on("postgres_changes", { event: "*", schema: "public", table: "students", filter: `organization_id=eq.${orgId}` }, debounce(loadStudents, 200))
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices", filter: `organization_id=eq.${orgId}` }, debounce(loadInvoices, 200))
      .on("postgres_changes", { event: "*", schema: "public", table: "attendance_records", filter: `organization_id=eq.${orgId}` }, debounce(loadAttendance, 200))
      .on("postgres_changes", { event: "*", schema: "public", table: "leads", filter: `organization_id=eq.${orgId}` }, debounce(loadLeads, 200))
      .on("postgres_changes", { event: "*", schema: "public", table: "profiles", filter: `organization_id=eq.${orgId}` }, debounce(loadTutors, 200))
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [orgId, isTutor, isAdminTier, user?.id]);

  const nameOf = useMemo(() => new Map(students.map((s) => [s.id, s.name || "Student"])), [students]);
  const phoneOf = useMemo(
    () => new Map(students.map((s) => [s.id, s.parentPhone || s.phone || ""])),
    [students]
  );

  const todaySessions = useMemo(() => (sessions ? sessionsForDay(sessions, now) : []), [sessions, now]);
  const debt = useMemo(() => (sessions ? attendanceDebt(sessions, now) : []), [sessions, now]);
  const pulse = useMemo(() => buildPulse(invoices, sessions || [], now), [invoices, sessions, now]);

  const queue = useMemo(() => {
    if (!sessions) return [];
    return buildAttentionQueue({ invoices, sessions, leads, students, attendance }, now).filter(
      (it) => !hidden[it.id] || hidden[it.id] <= Date.now()
    );
  }, [invoices, sessions, leads, students, attendance, now, hidden]);

  // --- Attendance commit with a 5-second undo window ---
  const commitAttendance = useCallback(
    (session: TodaySession, records: { studentId: string; status: AttendanceStatus }[]) => {
      setMarkedLocally((m) => ({ ...m, [session.id]: true }));
      const presentCount = records.filter((r) => r.status === "present" || r.status === "late").length;

      // The real write is deferred so Undo can cancel it before anything bills.
      // Guarded by presence in the pending map so it fires at most once.
      const flush = async () => {
        if (!pending.current.has(session.id)) return;
        pending.current.delete(session.id);
        try {
          await markAttendance(session.id, records);
          // The live listener flips the session to completed; the overlay holds
          // until then so there's no flicker.
        } catch (err: any) {
          if (mounted.current) {
            setMarkedLocally((m) => {
              const next = { ...m };
              delete next[session.id];
              return next;
            });
            toast.error(err?.message || t("today.markError"));
          }
        }
      };
      const timer = setTimeout(flush, 5000);
      pending.current.set(session.id, { timer, flush });

      toast.success(t("today.markToast", { present: presentCount, total: records.length }), {
        duration: 5000,
        action: {
          label: t("common.undo"),
          onClick: () => {
            const p = pending.current.get(session.id);
            if (p) clearTimeout(p.timer);
            pending.current.delete(session.id);
            setMarkedLocally((m) => {
              const next = { ...m };
              delete next[session.id];
              return next;
            });
          },
        },
      });
    },
    [t]
  );

  if (!orgId) {
    return (
      <div className="mx-auto max-w-md py-16">
        <EmptyState
          icon={Inbox}
          title={t("today.settingUpTitle")}
          description={t("today.settingUpDesc")}
        />
      </div>
    );
  }

  const loading = sessions === null;
  const greeting = greetFor(now, user?.name, t);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      {/* Header + attendance-debt counter (E9.5) */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--cs-text)]">{greeting}</h1>
          <p className="mt-0.5 text-[13px] text-[var(--cs-text-muted)]">
            {todaySessions.length === 0
              ? t("today.noSessionsToday")
              : t("today.sessionsToday", { count: todaySessions.length })}
          </p>
        </div>
        {debt.length > 0 && (
          // Aging never shouts (direction.html .chip.warn): a neutral grey chip
          // with a dot and a plain count, not an amber alert.
          <a
            href="#queue"
            className="inline-flex items-center gap-2 rounded-full bg-[var(--cs-surface-2)] px-3 py-1.5 text-[13px] font-medium text-[var(--cs-text-muted)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:text-[var(--cs-text)]"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />
            {t("today.unmarkedSessions", { count: debt.length })}
          </a>
        )}
      </header>

      {/* The Pulse (E9.4): three numbers, no charts */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatChip label={t("today.collectedThisMonth")} value={formatPaise(pulse.collectedPaise)} icon={Receipt} />
        <StatChip
          label={t("today.outstanding")}
          value={formatPaise(pulse.outstandingPaise)}
          tone={pulse.outstandingPaise > 0 ? "warn" : "default"}
        />
        <StatChip
          label={t("today.sessionsThisWeek")}
          value={pulse.sessionsThisWeek}
          hint={weekDeltaHint(pulse.sessionsThisWeek, pulse.sessionsLastWeek, t)}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        {/* The Line */}
        <section>
          <h2 className={SECTION_LABEL}>{t("today.lineHeading")}</h2>
          {loading ? (
            <div className="divide-y divide-[var(--cs-border)] rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : todaySessions.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title={t("today.lineEmptyTitle")}
              description={t("today.lineEmptyDesc")}
            />
          ) : isAdminTier ? (
            <AdminLanes
              sessions={todaySessions}
              now={now}
              nameOf={nameOf}
              tutorNames={tutorNames}
              markedLocally={markedLocally}
              onCommit={commitAttendance}
            />
          ) : (
            <Line
              sessions={todaySessions}
              now={now}
              nameOf={nameOf}
              markedLocally={markedLocally}
              onCommit={commitAttendance}
            />
          )}
        </section>

        {/* Attention queue */}
        <section id="queue">
          <h2 className={SECTION_LABEL}>
            {t("today.queueHeading")}{" "}
            {queue.length > 0 && <span className="text-[var(--cs-text-muted)]">· {queue.length}</span>}
          </h2>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded-[var(--cs-radius-container)]" />
              <Skeleton className="h-16 w-full rounded-[var(--cs-radius-container)]" />
            </div>
          ) : queue.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title={t("today.queueEmptyTitle")}
              description={t("today.queueEmptyDesc")}
            />
          ) : (
            <ul className="space-y-2">
              {queue.map((item) => (
                <li key={item.id}>
                  <QueueRow item={item} nameOf={nameOf} phoneOf={phoneOf} onHide={hideItem} />
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

// --- The Line: a single tutor's timeline with the now-cursor ---------------

function Line({
  sessions,
  now,
  nameOf,
  markedLocally,
  onCommit,
}: {
  sessions: TodaySession[];
  now: Date;
  nameOf: Map<string, string>;
  markedLocally: Record<string, boolean>;
  onCommit: (s: TodaySession, r: { studentId: string; status: AttendanceStatus }[]) => void;
}) {
  const cursor = nowCursorIndex(sessions, now);
  const showCursor = cursor < sessions.length && sessions.some((s) => new Date(s.startTime).toDateString() === now.toDateString());

  return (
    <div className="divide-y divide-[var(--cs-border)] rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
      {sessions.map((s, i) => (
        <div key={s.id}>
          {showCursor && i === cursor && <NowCursor now={now} />}
          <SessionBlock session={s} now={now} nameOf={nameOf} markedLocally={markedLocally} onCommit={onCommit} />
        </div>
      ))}
      {showCursor && cursor === sessions.length && <NowCursor now={now} />}
    </div>
  );
}

// The now-cursor (E9.1): a live divider between the sessions that have started
// and the ones still to come. Small: a pinging accent dot, the time, a
// hairline. The ping is CSS-only and the global reduced-motion guard collapses
// it (src/index.css).
function NowCursor({ now }: { now: Date }) {
  const { t } = useTranslation();
  return (
    <div className="flex items-center gap-2 px-4 py-1.5" aria-label={t("today.currentTime")}>
      <span className="relative flex h-2 w-2 shrink-0 items-center justify-center">
        <span className="cs-now-ping absolute h-2 w-2 rounded-full bg-[var(--cs-accent)]" />
        <span className="relative h-2 w-2 rounded-full bg-[var(--cs-accent)]" />
      </span>
      <span className="text-[11px] font-semibold tabular-nums text-[var(--cs-accent)]">{formatTime(now)}</span>
      <span className="h-px flex-1 bg-[var(--cs-accent)] opacity-40" />
    </div>
  );
}

// Admin variant (E9.6): the same Line, one lane per tutor.
function AdminLanes({
  sessions,
  now,
  nameOf,
  tutorNames,
  markedLocally,
  onCommit,
}: {
  sessions: TodaySession[];
  now: Date;
  nameOf: Map<string, string>;
  tutorNames: Record<string, string>;
  markedLocally: Record<string, boolean>;
  onCommit: (s: TodaySession, r: { studentId: string; status: AttendanceStatus }[]) => void;
}) {
  const { t } = useTranslation();
  const lanes = useMemo(() => {
    const byTutor = new Map<string, TodaySession[]>();
    for (const s of sessions) {
      const key = s.tutorId || "unassigned";
      if (!byTutor.has(key)) byTutor.set(key, []);
      byTutor.get(key)!.push(s);
    }
    return Array.from(byTutor.entries());
  }, [sessions]);

  // A single tutor's worth of sessions doesn't need lanes.
  if (lanes.length <= 1) {
    return <Line sessions={sessions} now={now} nameOf={nameOf} markedLocally={markedLocally} onCommit={onCommit} />;
  }

  return (
    <div className="space-y-5">
      {lanes.map(([tutorId, laneSessions]) => (
        <div key={tutorId}>
          <div className="mb-1.5 flex items-center gap-2 px-1 text-sm font-medium text-[var(--cs-text)]">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-[var(--cs-accent-soft)] text-[11px] font-semibold text-[var(--cs-accent)]">
              {(tutorNames[tutorId] || "T").charAt(0).toUpperCase()}
            </span>
            {tutorNames[tutorId] || (tutorId === "unassigned" ? t("today.unassigned") : t("today.tutorFallback"))}
            <span className="text-xs font-normal text-[var(--cs-text-muted)]">· {laneSessions.length}</span>
          </div>
          <Line sessions={laneSessions} now={now} nameOf={nameOf} markedLocally={markedLocally} onCommit={onCommit} />
        </div>
      ))}
    </div>
  );
}

function SessionBlock({
  session,
  now,
  nameOf,
  markedLocally,
  onCommit,
}: {
  session: TodaySession;
  now: Date;
  nameOf: Map<string, string>;
  markedLocally: Record<string, boolean>;
  onCommit: (s: TodaySession, r: { studentId: string; status: AttendanceStatus }[]) => void;
}) {
  const { t } = useTranslation();
  const overlaid = markedLocally[session.id];
  const phase: SessionPhase = overlaid ? "done" : sessionPhase(session, now);
  const ids = session.studentIds || [];
  const roster = ids.map((id) => nameOf.get(id) || "Student");
  const title =
    roster.length === 0
      ? t("today.sessionFallback")
      : roster.length <= 2
        ? roster.join(", ")
        : t("today.rosterMore", { name: roster[0], count: roster.length - 1 });
  const cancelled = phase === "cancelled";

  const isMobile = useIsMobile();
  const [mobileRosterOpen, setMobileRosterOpen] = useState(false);
  const swipable = isMobile && ids.length > 0 && (phase === "live" || phase === "unmarked");

  const markAllPresent = useCallback(() => {
    onCommit(session, ids.map((id) => ({ studentId: id, status: "present" as AttendanceStatus })));
  }, [session, ids, onCommit]);

  const swipe = useSwipeAction({
    onSwipeRight: swipable ? markAllPresent : undefined,
    onSwipeLeft: swipable ? () => setMobileRosterOpen(true) : undefined,
  });

  const row = (
    <div className="flex items-center gap-3 px-4 py-3">
      <div className="w-16 shrink-0 text-right">
        <div className={`text-sm font-medium tabular-nums ${cancelled ? "text-[var(--cs-text-muted)] line-through" : "text-[var(--cs-text)]"}`}>
          {formatTime(session.startTime)}
        </div>
        <div className="text-[11px] tabular-nums text-[var(--cs-text-muted)]">{formatTime(session.endTime)}</div>
      </div>

      <div className="min-w-0 flex-1">
        <div className={`truncate text-sm font-medium ${cancelled ? "text-[var(--cs-text-muted)] line-through" : "text-[var(--cs-text)]"}`}>
          {title}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--cs-text-muted)]">
          {session.isOnline ? (
            <>
              <Video className="h-3 w-3" strokeWidth={1.75} /> {t("today.online")}
            </>
          ) : (
            <>
              <MapPin className="h-3 w-3" strokeWidth={1.75} />{" "}
              {session.roomNumber ? t("today.room", { room: session.roomNumber }) : t("today.inPerson")}
            </>
          )}
          {ids.length > 0 && <span>· {t("today.studentCount", { count: ids.length })}</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <SessionAction session={session} phase={phase} now={now} roster={roster} onCommit={onCommit} />
      </div>
    </div>
  );

  if (!swipable) return row;

  return (
    <>
      <div className="relative overflow-hidden">
        <div className="absolute inset-0 flex">
          <div className="flex w-1/2 items-center gap-1.5 pl-4 text-sm font-medium text-[var(--cs-accent-contrast)]" style={{ backgroundColor: "var(--cs-ok)" }}>
            <Check className="h-4 w-4" strokeWidth={2.5} /> {t("today.allPresent")}
          </div>
          <div className="flex w-1/2 items-center justify-end gap-1.5 pr-4 text-sm font-medium text-[var(--cs-text)]" style={{ backgroundColor: "var(--cs-surface-2)" }}>
            <Users className="h-4 w-4" strokeWidth={1.75} /> {t("today.roster")}
          </div>
        </div>
        <div
          ref={swipe.ref}
          {...swipe.bind}
          className="relative touch-pan-y bg-[var(--cs-surface)]"
          style={{
            transform: `translateX(${swipe.offsetX}px)`,
            transition: swipe.dragging ? "none" : "transform var(--cs-motion-structural) var(--cs-ease-out)",
          }}
        >
          {row}
        </div>
      </div>
      {mobileRosterOpen && (
        <BottomSheet onClose={() => setMobileRosterOpen(false)} label={t("today.markAttendance")}>
          <div className="px-4 pb-4">
            <RosterForm
              ids={ids}
              roster={roster}
              onConfirm={(recs) => {
                onCommit(session, recs);
                setMobileRosterOpen(false);
              }}
              onCancel={() => setMobileRosterOpen(false)}
            />
          </div>
        </BottomSheet>
      )}
    </>
  );
}

// The state-aware action per block: Join → Mark attendance → done (E9.1/E9.2).
function SessionAction({
  session,
  phase,
  now,
  roster,
  onCommit,
}: {
  session: TodaySession;
  phase: SessionPhase;
  now: Date;
  roster: string[];
  onCommit: (s: TodaySession, r: { studentId: string; status: AttendanceStatus }[]) => void;
}) {
  const { t } = useTranslation();
  if (phase === "cancelled") return <StatusChip label={t("today.cancelled")} tone="neutral" />;
  if (phase === "done") return <StatusChip label={t("today.marked")} tone="positive" />;

  const joinBtn =
    session.isOnline && session.meetingLink ? (
      <a
        href={session.meetingLink}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-[var(--cs-radius-control)] bg-[var(--cs-accent)] px-3 py-1.5 text-sm font-medium text-[var(--cs-accent-contrast)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-accent-hover)]"
      >
        <Video className="h-3.5 w-3.5" strokeWidth={2} /> {t("today.join")}
      </a>
    ) : session.isOnline ? (
      <span className="text-xs text-[var(--cs-text-muted)]" title={t("today.linkPendingHint")}>
        {t("today.linkPending")}
      </span>
    ) : null;

  if (phase === "upcoming") {
    const mins = minutesUntilStart(session, now);
    // Surface Join only near start; otherwise a calm countdown.
    if (session.isOnline && mins <= 15) return joinBtn;
    return (
      <span className="inline-flex items-center gap-1 text-xs text-[var(--cs-text-muted)]">
        <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
        {mins <= 0 ? t("today.now") : t("today.inMinutes", { count: mins })}
      </span>
    );
  }

  // live or unmarked → attendance is the primary action; keep Join available live.
  return (
    <div className="flex items-center gap-2">
      {phase === "live" && joinBtn}
      <RosterPopover session={session} roster={roster} onCommit={onCommit} unmarkedNudge={phase === "unmarked"} />
    </div>
  );
}

// One-tap attendance (E9.2): roster popover, all-present default, exception taps.
function RosterPopover({
  session,
  roster,
  onCommit,
  unmarkedNudge,
}: {
  session: TodaySession;
  roster: string[];
  onCommit: (s: TodaySession, r: { studentId: string; status: AttendanceStatus }[]) => void;
  unmarkedNudge: boolean;
}) {
  const { t } = useTranslation();
  const ids = session.studentIds || [];

  const triggerContent = (
    <>
      <Check className="h-3.5 w-3.5" strokeWidth={2} />
      {unmarkedNudge ? t("today.markAttendance") : t("today.mark")}
    </>
  );

  if (ids.length === 0) {
    // Nothing to mark; expose a disabled hint instead of an empty popover.
    return <span className="text-xs text-[var(--cs-text-muted)]">{t("today.noRoster")}</span>;
  }

  return (
    <Popover
      trigger={triggerContent}
      triggerClassName={`inline-flex items-center gap-1.5 rounded-[var(--cs-radius-control)] px-3 py-1.5 text-sm font-medium transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] ${
        unmarkedNudge
          ? "bg-[var(--cs-accent)] text-[var(--cs-accent-contrast)] hover:bg-[var(--cs-accent-hover)]"
          : "border border-[var(--cs-border)] text-[var(--cs-text)] hover:bg-[var(--cs-surface-2)]"
      }`}
      align="right"
      className="w-72"
    >
      {(close) => <RosterForm ids={ids} roster={roster} onConfirm={(recs) => { onCommit(session, recs); close(); }} onCancel={close} />}
    </Popover>
  );
}

function RosterForm({
  ids,
  roster,
  onConfirm,
  onCancel,
}: {
  ids: string[];
  roster: string[];
  onConfirm: (records: { studentId: string; status: AttendanceStatus }[]) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  // All-present by default; tapping a row cycles the exception.
  const [statuses, setStatuses] = useState<Record<string, AttendanceStatus>>(() =>
    Object.fromEntries(ids.map((id) => [id, "present" as AttendanceStatus]))
  );

  const cycle = (id: string) =>
    setStatuses((prev) => {
      const cur = prev[id] || "present";
      const next = STATUS_CYCLE[(STATUS_CYCLE.indexOf(cur) + 1) % STATUS_CYCLE.length];
      return { ...prev, [id]: next };
    });

  const setAllPresent = () => setStatuses(Object.fromEntries(ids.map((id) => [id, "present" as AttendanceStatus])));
  const exceptions = ids.filter((id) => statuses[id] !== "present").length;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-[var(--cs-text)]">{t("today.markAttendance")}</span>
        <button onClick={setAllPresent} className="text-[11px] text-[var(--cs-accent)] hover:underline">
          {t("today.allPresent")}
        </button>
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {ids.map((id, i) => {
          const st = statuses[id] || "present";
          return (
            <button
              key={id}
              onClick={() => cycle(id)}
              className="flex w-full items-center justify-between gap-2 rounded-[var(--cs-radius-control)] px-2 py-1.5 text-left transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)]"
            >
              <span className="truncate text-sm text-[var(--cs-text)]">{roster[i] || "Student"}</span>
              <StatusChip label={t(STATUS_LABEL_KEY[st])} tone={STATUS_TONE[st]} />
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--cs-border)] pt-2">
        <span className="text-[11px] text-[var(--cs-text-muted)]">
          {exceptions === 0 ? t("today.allPresent") : t("today.exceptions", { count: exceptions })}
        </span>
        <div className="flex gap-1.5">
          <Button variant="quiet" size="sm" onClick={onCancel}>
            {t("common.cancel")}
          </Button>
          <Button
            variant="primary"
            size="sm"
            onClick={() => onConfirm(ids.map((id) => ({ studentId: id, status: statuses[id] || "present" })))}
          >
            {t("today.confirm")}
          </Button>
        </div>
      </div>
    </div>
  );
}

// --- Attention queue row (E9.3): icon, facts, inline action, snooze/dismiss --

const QUEUE_ICON: Record<QueueItem["kind"], ReactNode> = {
  overdue_invoice: <Receipt className="h-4 w-4" strokeWidth={1.75} />,
  unmarked_session: <CalendarClock className="h-4 w-4" strokeWidth={1.75} />,
  absence_streak: <UserMinus className="h-4 w-4" strokeWidth={1.75} />,
  quiet_lead: <Flame className="h-4 w-4" strokeWidth={1.75} />,
  schedule_conflict: <AlertTriangle className="h-4 w-4" strokeWidth={1.75} />,
};

function QueueRow({
  item,
  phoneOf,
  onHide,
}: {
  item: QueueItem;
  nameOf: Map<string, string>;
  phoneOf: Map<string, string>;
  onHide: (id: string, ms: number) => void;
}) {
  const { t } = useTranslation();
  // The bar carries the only colour on the row (direction.html .qitem .bar):
  // danger red, else a neutral strong hairline. Aging stays grey.
  const bar =
    item.tone === "danger"
      ? "border-l-[var(--cs-danger)]"
      : item.tone === "warn"
        ? "border-l-[var(--cs-border-strong)]"
        : "border-l-[var(--cs-accent)]";

  return (
    <div className={`rounded-[var(--cs-radius-container)] border border-l-2 border-[var(--cs-border)] bg-[var(--cs-surface)] px-3 py-2.5 ${bar}`}>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[var(--cs-radius-control)] bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)]">
          {QUEUE_ICON[item.kind]}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-medium text-[var(--cs-text)]">{item.title}</div>
          <div className="flex items-center gap-2 text-xs text-[var(--cs-text-muted)]">
            {item.kind === "overdue_invoice" && item.daysOverdue ? (
              <AgedBadge daysOverdue={item.daysOverdue} />
            ) : (
              <span>{item.detail}</span>
            )}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <QueueAction item={item} phone={item.phone || phoneOf.get(item.studentId || "") || ""} />
          <button
            title={t("today.snooze")}
            onClick={() => onHide(item.id, 24 * 3600 * 1000)}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--cs-radius-control)] text-[var(--cs-text-muted)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)]"
          >
            <BellOff className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            title={t("today.dismiss")}
            onClick={() => onHide(item.id, 30 * 24 * 3600 * 1000)}
            className="flex h-7 w-7 items-center justify-center rounded-[var(--cs-radius-control)] text-[var(--cs-text-muted)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)]"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}

function QueueAction({ item, phone }: { item: QueueItem; phone: string }) {
  const { t } = useTranslation();
  const base =
    "inline-flex items-center gap-1 rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--cs-text)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)]";

  switch (item.kind) {
    case "overdue_invoice":
      return (
        <Link to="/app/money" className={base}>
          <Receipt className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("today.actionCollect")}
        </Link>
      );
    case "unmarked_session":
      // The session is on the Line/debt window; jump to the calendar to mark.
      return (
        <Link to="/app/schedule" className={base}>
          <Check className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("today.mark")}
        </Link>
      );
    case "absence_streak":
      return phone ? (
        <a href={`tel:${phone}`} className={base}>
          <Phone className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("today.actionCall")}
        </a>
      ) : (
        <Link to={item.studentId ? `/app/students/${item.studentId}` : "/app/people?lens=students"} className={base}>
          {t("today.actionOpen")}
        </Link>
      );
    case "quiet_lead":
      return (
        <Link to="/app/people?lens=leads" className={base}>
          <Flame className="h-3.5 w-3.5" strokeWidth={1.75} /> {t("today.actionFollowUp")}
        </Link>
      );
    case "schedule_conflict":
      return (
        <Link to="/app/schedule" className={base}>
          {t("today.actionResolve")}
        </Link>
      );
    default:
      return null;
  }
}

// --- small helpers ----------------------------------------------------------

function greetFor(now: Date, name: string | undefined, t: Translate): string {
  const h = now.getHours();
  const part = h < 12 ? t("today.greetMorning") : h < 17 ? t("today.greetAfternoon") : t("today.greetEvening");
  const first = name ? name.split(" ")[0] : "";
  return first ? t("today.greetNamed", { part, name: first }) : part;
}

function weekDeltaHint(thisWeek: number, lastWeek: number, t: Translate): string {
  const delta = thisWeek - lastWeek;
  if (lastWeek === 0 && thisWeek === 0) return t("today.deltaNoneLastWeek");
  if (delta === 0) return t("today.deltaSame");
  return delta > 0 ? t("today.deltaUp", { count: delta }) : t("today.deltaDown", { count: delta });
}
