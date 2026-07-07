import { useState, useEffect, useMemo, useRef, useCallback, type ReactNode } from "react";
import { collection, query, where, orderBy, limit, onSnapshot } from "firebase/firestore";
import { toast } from "sonner";
import { Link } from "react-router-dom";
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
} from "lucide-react";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { StatChip, StatusChip, AgedBadge, EmptyState, SkeletonRow, Skeleton, Popover } from "../components/kit";
import { formatPaise, formatTime } from "../lib/format";
import { markAttendance, type AttendanceStatus } from "../lib/api";
import StudentDashboard from "./StudentDashboard";
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
// still mutate only through the server API (src/lib/api.ts) — this page reads
// live and writes exactly one thing: attendance, optimistically with undo.

const STATUS_CYCLE: AttendanceStatus[] = ["present", "absent", "late", "excused"];
const STATUS_META: Record<AttendanceStatus, { label: string; tone: "positive" | "danger" | "warn" | "neutral" }> = {
  present: { label: "Present", tone: "positive" },
  absent: { label: "Absent", tone: "danger" },
  late: { label: "Late", tone: "warn" },
  excused: { label: "Excused", tone: "neutral" },
};

export default function Today() {
  const { user, currentRole } = useAuth();

  // Students get the study-focused home; this workspace is for the business.
  if (currentRole === "student") return <StudentDashboard />;

  return <StaffToday user={user} currentRole={currentRole} />;
}

function StaffToday({ user, currentRole }: { user: any; currentRole: string | null }) {
  const orgId = user?.organizationId as string | undefined;
  const isTutor = (currentRole || user?.role) === "tutor";
  const isAdminTier = currentRole === "admin" || user?.role === "admin" || currentRole === "owner";

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
          /* storage full / disabled — snooze is best-effort */
        }
        return next;
      });
    },
    [hiddenKey]
  );

  // --- Live, bounded listeners (E4.1 hygiene) ---
  useEffect(() => {
    if (!orgId) return;

    // Sessions: 8 days back (covers the 7-day debt window) through the future
    // week, so the Line, debt counter, conflicts, and Pulse all have their data.
    const windowStart = new Date(Date.now() - 8 * 24 * 3600 * 1000).toISOString();
    const sConstraints: any[] = [
      where("organizationId", "==", orgId),
      where("startTime", ">=", windowStart),
      orderBy("startTime"),
      limit(300),
    ];
    if (isTutor) sConstraints.unshift(where("tutorId", "==", user.id));
    const unsubSessions = onSnapshot(
      query(collection(db, "class_sessions"), ...sConstraints),
      (snap) => setSessions(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      (err) => {
        console.error("Today: sessions listener", err);
        setSessions([]);
      }
    );

    const stConstraints: any[] = [where("organizationId", "==", orgId), limit(500)];
    if (isTutor) stConstraints.unshift(where("tutorId", "==", user.id));
    const unsubStudents = onSnapshot(
      query(collection(db, "students"), ...stConstraints),
      (snap) => setStudents(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      (err) => console.error("Today: students listener", err)
    );

    const yearAgo = new Date(Date.now() - 365 * 24 * 3600 * 1000).toISOString();
    const iConstraints: any[] = [where("organizationId", "==", orgId), where("createdAt", ">=", yearAgo), limit(500)];
    if (isTutor) iConstraints.unshift(where("tutorId", "==", user.id));
    const unsubInvoices = onSnapshot(
      query(collection(db, "invoices"), ...iConstraints),
      (snap) => setInvoices(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
      (err) => console.error("Today: invoices listener", err)
    );

    // Attendance for absence-streak detection: recent window, capped.
    const aConstraints: any[] = [where("organizationId", "==", orgId), limit(500)];
    const unsubAttendance = onSnapshot(
      query(collection(db, "attendance_records"), ...aConstraints),
      (snap) => setAttendance(snap.docs.map((d) => d.data() as TodayAttendance)),
      (err) => console.error("Today: attendance listener", err)
    );

    // Leads only matter to the queue and only for admin-tier/frontdesk; tutors
    // don't chase leads, so skip the read for them.
    let unsubLeads = () => {};
    if (!isTutor) {
      unsubLeads = onSnapshot(
        query(collection(db, "leads"), where("organizationId", "==", orgId), limit(200)),
        (snap) => setLeads(snap.docs.map((d) => ({ id: d.id, ...(d.data() as any) }))),
        (err) => console.error("Today: leads listener", err)
      );
    }

    // Tutor names for the admin variant's stacked lanes (E9.6).
    let unsubTutors = () => {};
    if (isAdminTier) {
      unsubTutors = onSnapshot(
        query(collection(db, "tutor_profiles"), where("organizationId", "==", orgId), limit(100)),
        (snap) => {
          const map: Record<string, string> = {};
          snap.docs.forEach((d) => (map[d.id] = (d.data() as any).name || "Tutor"));
          setTutorNames(map);
        },
        (err) => console.error("Today: tutors listener", err)
      );
    }

    return () => {
      unsubSessions();
      unsubStudents();
      unsubInvoices();
      unsubAttendance();
      unsubLeads();
      unsubTutors();
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
            toast.error(err?.message || "Could not save attendance");
          }
        }
      };
      const timer = setTimeout(flush, 5000);
      pending.current.set(session.id, { timer, flush });

      toast.success(`Marked · ${presentCount}/${records.length} present`, {
        duration: 5000,
        action: {
          label: "Undo",
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
    []
  );

  if (!orgId) {
    return (
      <div className="mx-auto max-w-md py-16">
        <EmptyState
          icon={Inbox}
          title="Setting up your workspace"
          description="We're finishing your organization setup. Refresh in a moment if this doesn't clear."
        />
      </div>
    );
  }

  const loading = sessions === null;
  const greeting = greetFor(now, user?.name);

  return (
    <div className="mx-auto max-w-6xl space-y-6 pb-16">
      {/* Header + attendance-debt counter (E9.5) */}
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-[var(--cs-text)]">{greeting}</h1>
          <p className="mt-0.5 text-sm text-[var(--cs-text-muted)]">
            {todaySessions.length === 0
              ? "No sessions on the calendar today."
              : `${todaySessions.length} session${todaySessions.length === 1 ? "" : "s"} today.`}
          </p>
        </div>
        {debt.length > 0 && (
          <a
            href="#queue"
            className="inline-flex items-center gap-2 rounded-[8px] border border-[var(--cs-warn)]/40 bg-[var(--cs-warn)]/10 px-3 py-2 text-sm font-medium text-[var(--cs-warn)]"
          >
            <CalendarClock className="h-4 w-4" strokeWidth={1.75} />
            {debt.length} unmarked session{debt.length === 1 ? "" : "s"}
          </a>
        )}
      </header>

      {/* The Pulse (E9.4): three numbers, no charts */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatChip label="Collected this month" value={formatPaise(pulse.collectedPaise)} icon={Receipt} tone="positive" />
        <StatChip
          label="Outstanding"
          value={formatPaise(pulse.outstandingPaise)}
          tone={pulse.outstandingPaise > 0 ? "warn" : "default"}
        />
        <StatChip
          label="Sessions this week"
          value={pulse.sessionsThisWeek}
          hint={weekDeltaHint(pulse.sessionsThisWeek, pulse.sessionsLastWeek)}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_360px]">
        {/* The Line */}
        <section>
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--cs-text-muted)]">Today's line</h2>
          {loading ? (
            <div className="divide-y divide-[var(--cs-border)] rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
              <SkeletonRow />
              <SkeletonRow />
              <SkeletonRow />
            </div>
          ) : todaySessions.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Nothing scheduled today"
              description="Enjoy the quiet, or schedule a class from the calendar."
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
          <h2 className="mb-3 text-xs font-semibold uppercase tracking-wide text-[var(--cs-text-muted)]">
            Needs you {queue.length > 0 && <span className="text-[var(--cs-danger)]">· {queue.length}</span>}
          </h2>
          {loading ? (
            <div className="space-y-2">
              <Skeleton className="h-16 w-full rounded-[10px]" />
              <Skeleton className="h-16 w-full rounded-[10px]" />
            </div>
          ) : queue.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="All clear"
              description="Nothing needs you right now. Nicely done."
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
    <div className="divide-y divide-[var(--cs-border)] rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
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

function NowCursor({ now }: { now: Date }) {
  return (
    <div className="flex items-center gap-2 px-4 py-1" aria-label="Current time">
      <span className="text-[11px] font-semibold tabular-nums text-[var(--cs-accent)]">{formatTime(now)}</span>
      <span className="h-px flex-1 bg-[var(--cs-accent)]" />
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
            {tutorNames[tutorId] || (tutorId === "unassigned" ? "Unassigned" : "Tutor")}
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
  const overlaid = markedLocally[session.id];
  const phase: SessionPhase = overlaid ? "done" : sessionPhase(session, now);
  const ids = session.studentIds || [];
  const roster = ids.map((id) => nameOf.get(id) || "Student");
  const title = roster.length === 0 ? "Session" : roster.length <= 2 ? roster.join(", ") : `${roster[0]} +${roster.length - 1} more`;
  const cancelled = phase === "cancelled";

  return (
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
              <Video className="h-3 w-3" strokeWidth={1.75} /> Online
            </>
          ) : (
            <>
              <MapPin className="h-3 w-3" strokeWidth={1.75} /> {session.roomNumber ? `Room ${session.roomNumber}` : "In person"}
            </>
          )}
          {ids.length > 0 && <span>· {ids.length} student{ids.length === 1 ? "" : "s"}</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2">
        <SessionAction session={session} phase={phase} now={now} roster={roster} onCommit={onCommit} />
      </div>
    </div>
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
  if (phase === "cancelled") return <StatusChip label="Cancelled" tone="neutral" />;
  if (phase === "done") return <StatusChip label="Marked" tone="positive" />;

  const joinBtn =
    session.isOnline && session.meetingLink ? (
      <a
        href={session.meetingLink}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 rounded-[6px] bg-[var(--cs-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
      >
        <Video className="h-3.5 w-3.5" strokeWidth={2} /> Join
      </a>
    ) : session.isOnline ? (
      <span className="text-xs text-[var(--cs-text-muted)]" title="A real Meet link is attached when Google Calendar sync is connected (Epic 8).">
        Link pending
      </span>
    ) : null;

  if (phase === "upcoming") {
    const mins = minutesUntilStart(session, now);
    // Surface Join only near start; otherwise a calm countdown.
    if (session.isOnline && mins <= 15) return joinBtn;
    return (
      <span className="inline-flex items-center gap-1 text-xs text-[var(--cs-text-muted)]">
        <Clock className="h-3.5 w-3.5" strokeWidth={1.75} />
        {mins <= 0 ? "now" : `in ${mins} min`}
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
  const ids = session.studentIds || [];

  const trigger = (
    <button
      className={`inline-flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-sm font-medium ${
        unmarkedNudge
          ? "bg-[var(--cs-accent)] text-white hover:opacity-90"
          : "border border-[var(--cs-border)] text-[var(--cs-text)] hover:bg-[var(--cs-bg)]"
      }`}
    >
      <Check className="h-3.5 w-3.5" strokeWidth={2} />
      {unmarkedNudge ? "Mark attendance" : "Mark"}
    </button>
  );

  if (ids.length === 0) {
    // Nothing to mark; expose a disabled hint instead of an empty popover.
    return <span className="text-xs text-[var(--cs-text-muted)]">No roster</span>;
  }

  return (
    <Popover trigger={trigger} align="right" className="w-72">
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
        <span className="text-xs font-semibold text-[var(--cs-text)]">Mark attendance</span>
        <button onClick={setAllPresent} className="text-[11px] text-[var(--cs-accent)] hover:underline">
          All present
        </button>
      </div>
      <div className="max-h-56 space-y-1 overflow-y-auto">
        {ids.map((id, i) => {
          const st = statuses[id] || "present";
          const meta = STATUS_META[st];
          return (
            <button
              key={id}
              onClick={() => cycle(id)}
              className="flex w-full items-center justify-between gap-2 rounded-[6px] px-2 py-1.5 text-left hover:bg-[var(--cs-bg)]"
            >
              <span className="truncate text-sm text-[var(--cs-text)]">{roster[i] || "Student"}</span>
              <StatusChip label={meta.label} tone={meta.tone} />
            </button>
          );
        })}
      </div>
      <div className="flex items-center justify-between border-t border-[var(--cs-border)] pt-2">
        <span className="text-[11px] text-[var(--cs-text-muted)]">
          {exceptions === 0 ? "All present" : `${exceptions} exception${exceptions === 1 ? "" : "s"}`}
        </span>
        <div className="flex gap-1.5">
          <button onClick={onCancel} className="rounded-[6px] px-2.5 py-1.5 text-sm text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)]">
            Cancel
          </button>
          <button
            onClick={() => onConfirm(ids.map((id) => ({ studentId: id, status: statuses[id] || "present" })))}
            className="rounded-[6px] bg-[var(--cs-accent)] px-2.5 py-1.5 text-sm font-medium text-white hover:opacity-90"
          >
            Confirm
          </button>
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
  const tone =
    item.tone === "danger"
      ? "border-l-[var(--cs-danger)]"
      : item.tone === "warn"
        ? "border-l-[var(--cs-warn)]"
        : "border-l-[var(--cs-accent)]";

  return (
    <div className={`rounded-[10px] border border-l-2 border-[var(--cs-border)] bg-[var(--cs-surface)] px-3 py-2.5 ${tone}`}>
      <div className="flex items-start gap-2.5">
        <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-[6px] bg-[var(--cs-bg)] text-[var(--cs-text-muted)]">
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
            title="Snooze for a day"
            onClick={() => onHide(item.id, 24 * 3600 * 1000)}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)]"
          >
            <BellOff className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
          <button
            title="Dismiss"
            onClick={() => onHide(item.id, 30 * 24 * 3600 * 1000)}
            className="flex h-7 w-7 items-center justify-center rounded-[6px] text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)]"
          >
            <X className="h-3.5 w-3.5" strokeWidth={1.75} />
          </button>
        </div>
      </div>
    </div>
  );
}

function QueueAction({ item, phone }: { item: QueueItem; phone: string }) {
  const base =
    "inline-flex items-center gap-1 rounded-[6px] border border-[var(--cs-border)] px-2.5 py-1.5 text-xs font-medium text-[var(--cs-text)] hover:bg-[var(--cs-bg)]";

  switch (item.kind) {
    case "overdue_invoice":
      return (
        <Link to="/app/invoices" className={base}>
          <Receipt className="h-3.5 w-3.5" strokeWidth={1.75} /> Collect
        </Link>
      );
    case "unmarked_session":
      // The session is on the Line/debt window; jump to the calendar to mark.
      return (
        <Link to="/app/calendar" className={base}>
          <Check className="h-3.5 w-3.5" strokeWidth={1.75} /> Mark
        </Link>
      );
    case "absence_streak":
      return phone ? (
        <a href={`tel:${phone}`} className={base}>
          <Phone className="h-3.5 w-3.5" strokeWidth={1.75} /> Call
        </a>
      ) : (
        <Link to={item.studentId ? `/app/students/${item.studentId}` : "/app/students"} className={base}>
          Open
        </Link>
      );
    case "quiet_lead":
      return (
        <Link to="/app/leads" className={base}>
          <Flame className="h-3.5 w-3.5" strokeWidth={1.75} /> Follow up
        </Link>
      );
    case "schedule_conflict":
      return (
        <Link to="/app/calendar" className={base}>
          Resolve
        </Link>
      );
    default:
      return null;
  }
}

// --- small helpers ----------------------------------------------------------

function greetFor(now: Date, name?: string): string {
  const h = now.getHours();
  const part = h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
  const first = name ? name.split(" ")[0] : "";
  return first ? `${part}, ${first}` : `${part}`;
}

function weekDeltaHint(thisWeek: number, lastWeek: number): string {
  const delta = thisWeek - lastWeek;
  if (lastWeek === 0 && thisWeek === 0) return "No sessions last week";
  if (delta === 0) return "Same as last week";
  return delta > 0 ? `+${delta} vs last week` : `${delta} vs last week`;
}
