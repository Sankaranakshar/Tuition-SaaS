import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Calendar, DollarSign, Video, Clock, FileText, CheckCircle, AlertTriangle } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { format, isSameDay, parseISO, isAfter, startOfDay } from "date-fns";
import { Link } from "react-router-dom";
import { formatINR } from "../lib/format";
import { debounce } from "../lib/debounce";
import { EmptyState, Skeleton, SkeletonText, StatChip, StatusChip, type ChipTone } from "../components/kit";

export default function StudentDashboard() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [upcomingClasses, setUpcomingClasses] = useState<any[]>([]);
  const [recentGrades, setRecentGrades] = useState<any[]>([]);
  const [walletBalance, setWalletBalance] = useState<number>(0);
  const [overdueInvoices, setOverdueInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;

    // Upcoming classes: this student's sessions (array-contains -> .contains()).
    const loadSessions = async () => {
      const { data, error } = await supabase
        .from("class_sessions")
        .select("*")
        .contains("student_user_ids", [user.id])
        .limit(50);
      if (cancelled) return;
      if (error) {
        console.error("StudentDashboard: sessions listener", error);
        return;
      }
      const sessions = (data || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        startTime: row.start_time,
        endTime: row.end_time,
        isOnline: row.is_online,
        meetingLink: row.meeting_link,
      }));
      const today = new Date();
      const upcoming = sessions
        .filter((s: any) => isAfter(parseISO(s.startTime), startOfDay(today)) || isSameDay(parseISO(s.startTime), today))
        .sort((a: any, b: any) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
        .slice(0, 3);
      setUpcomingClasses(upcoming);
    };

    // Recent grades.
    const loadAssessments = async () => {
      const { data, error } = await supabase
        .from("assessments")
        .select("*")
        .eq("student_id", user.id)
        .limit(50);
      if (cancelled) return;
      if (error) {
        console.error("StudentDashboard: assessments listener", error);
        return;
      }
      const assessments = (data || []).map((row: any) => ({
        id: row.id,
        title: row.title,
        type: row.type,
        date: row.date,
        score: row.score,
        totalScore: row.total_score,
        feedback: row.feedback,
      }));
      const sorted = assessments
        .sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime())
        .slice(0, 3);
      setRecentGrades(sorted);
    };

    // Wallet & invoices.
    const loadInvoices = async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("*")
        .eq("student_id", user.id)
        .limit(50);
      if (cancelled) return;
      if (error) {
        console.error("StudentDashboard: invoices listener", error);
        setLoading(false);
        return;
      }
      const invoices = (data || []).map((row: any) => ({
        id: row.id,
        status: row.status,
        dueDate: row.due_date,
      }));
      const overdue = invoices.filter((i: any) => i.status === 'pending' && new Date(i.dueDate) < new Date());
      setOverdueInvoices(overdue);
      setLoading(false);
    };

    const loadWallet = async () => {
      const { data, error } = await supabase
        .from("wallets")
        .select("*")
        .eq("student_id", user.id)
        .limit(1);
      if (cancelled) return;
      if (error) {
        console.error("StudentDashboard: wallet listener", error);
        return;
      }
      setWalletBalance((data && data[0]?.balance_credits) || 0);
    };

    const loadAll = () => {
      loadSessions();
      loadAssessments();
      loadInvoices();
      loadWallet();
    };
    loadAll();

    // class_sessions has no plain student_id column (membership is an
    // array-contains check on student_user_ids), so postgres_changes' single
    // column=eq filter genuinely can't scope it — left broad, debounced, and
    // loadSessions() reapplies the real filter on refetch. assessments/
    // invoices/wallets DO have a plain student_id column, so (unlike the
    // stale comment this replaces claimed) they're filtered directly instead
    // of firing this student's dashboard on every other student's row change.
    const channel = supabase
      .channel(`student-dashboard-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "class_sessions" }, debounce(loadSessions, 200))
      .on("postgres_changes", { event: "*", schema: "public", table: "assessments", filter: `student_id=eq.${user.id}` }, debounce(loadAssessments, 200))
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices", filter: `student_id=eq.${user.id}` }, debounce(loadInvoices, 200))
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `student_id=eq.${user.id}` }, debounce(loadWallet, 200))
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  if (loading) {
    return (
      <div className="mx-auto max-w-7xl space-y-6">
        <Skeleton className="h-7 w-48" />
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          <div className="space-y-6 lg:col-span-2">
            <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-6">
              <SkeletonText lines={4} />
            </div>
          </div>
          <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-6">
            <SkeletonText lines={3} />
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl space-y-6">
      <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--cs-text)]">{t("studentDashboard.title")}</h1>

      {overdueInvoices.length > 0 && (
        <div className="flex rounded-[var(--cs-radius-container)] border-l-4 border-[var(--cs-danger)] bg-[var(--cs-danger-soft)] p-4">
          <AlertTriangle className="h-5 w-5 shrink-0 text-[var(--cs-danger)]" strokeWidth={1.75} />
          <p className="ml-3 text-sm text-[var(--cs-danger)]">
            {t("studentDashboard.overdueCount", { count: overdueInvoices.length })}
            <Link to="/app/money" className="ml-1 font-medium underline">{t("studentDashboard.payNow")}</Link>
          </p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
            <div className="flex items-center justify-between border-b border-[var(--cs-border)] px-4 py-3">
              <h2 className="text-sm font-semibold text-[var(--cs-text)]">{t("studentDashboard.upcomingClasses")}</h2>
              <Link to="/app/timetable" className="text-sm font-medium text-[var(--cs-accent)] hover:text-[var(--cs-accent-hover)]">
                {t("studentDashboard.viewTimetable")}
              </Link>
            </div>

            {upcomingClasses.length > 0 ? (
              <ul className="divide-y divide-[var(--cs-border)]">
                {upcomingClasses.map((session) => (
                  <li key={session.id} className="flex items-center justify-between gap-3 px-4 py-3 transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-surface-2)]">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--cs-text)]">{session.title || t("studentDashboard.classSession")}</p>
                      <p className="mt-1 flex items-center text-sm text-[var(--cs-text-muted)]">
                        <Clock className="mr-1 h-4 w-4 shrink-0" strokeWidth={1.75} />
                        {format(parseISO(session.startTime), 'MMM d, yyyy')} · {format(parseISO(session.startTime), 'h:mm a')} - {format(parseISO(session.endTime), 'h:mm a')}
                      </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                      <StatusChip label={session.isOnline ? t("studentDashboard.online") : t("studentDashboard.inPerson")} tone="neutral" />
                      {session.isOnline && session.meetingLink && (
                        <a
                          href={session.meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center gap-1.5 rounded-[var(--cs-radius-control)] bg-[var(--cs-accent)] px-3 py-1.5 text-sm font-medium text-[var(--cs-accent-contrast)] transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-accent-hover)]"
                        >
                          <Video className="h-4 w-4" strokeWidth={1.75} />
                          {t("studentDashboard.join")}
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState icon={Calendar} title={t("studentDashboard.noUpcomingClasses")} className="border-0" />
            )}
          </div>

          <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
            <div className="flex items-center justify-between border-b border-[var(--cs-border)] px-4 py-3">
              <h2 className="text-sm font-semibold text-[var(--cs-text)]">{t("studentDashboard.latestGrades")}</h2>
              <Link to="/app/my-story" className="text-sm font-medium text-[var(--cs-accent)] hover:text-[var(--cs-accent-hover)]">
                {t("studentDashboard.viewGradebook")}
              </Link>
            </div>

            {recentGrades.length > 0 ? (
              <ul className="divide-y divide-[var(--cs-border)]">
                {recentGrades.map((grade) => {
                  const maxScore = grade.totalScore || grade.maxScore || 100;
                  const percentage = Math.round((Number(grade.score) / Number(maxScore)) * 100);
                  const passed = percentage >= 60;
                  const tone: ChipTone = passed ? "positive" : "danger";
                  return (
                    <li key={grade.id} className="flex items-center justify-between px-4 py-3 transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-surface-2)]">
                      <div>
                        <p className="text-sm font-medium text-[var(--cs-text)]">{grade.title || t("studentDashboard.untitledAssessment")}</p>
                        <p className="mt-1 text-xs text-[var(--cs-text-muted)]">{grade.date ? format(parseISO(grade.date), 'MMM d, yyyy') : t("studentDashboard.notAvailable")} · {grade.type}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <div className="text-right">
                          <p className="text-sm font-semibold tabular-nums text-[var(--cs-text)]">{grade.score} / {maxScore}</p>
                          <p className="text-xs tabular-nums text-[var(--cs-text-muted)]">{percentage}%</p>
                        </div>
                        <StatusChip label={passed ? t("studentDashboard.pass") : t("studentDashboard.review")} tone={tone} />
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState icon={FileText} title={t("studentDashboard.noRecentGrades")} className="border-0" />
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--cs-text)]">{t("studentDashboard.walletBalance")}</h2>
            <StatChip label={t("studentDashboard.availableCredits")} value={formatINR(walletBalance)} icon={DollarSign} />
            <Link
              to="/app/money"
              className="mt-4 flex w-full items-center justify-center rounded-[var(--cs-radius-control)] bg-[var(--cs-accent-soft)] px-4 py-2 text-sm font-medium text-[var(--cs-accent)] transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-accent)] hover:text-[var(--cs-accent-contrast)]"
            >
              {t("studentDashboard.topUpWallet")}
            </Link>
          </div>

          <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4">
            <h2 className="mb-3 text-sm font-semibold text-[var(--cs-text)]">{t("studentDashboard.quickLinks")}</h2>
            <div className="space-y-2">
              <Link to="/app/my-story" className="flex items-center rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] p-3 transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-surface-2)]">
                <div className="mr-3 rounded-[var(--cs-radius-control)] bg-[var(--cs-accent-soft)] p-2 text-[var(--cs-accent)]">
                  <FileText className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--cs-text)]">{t("studentDashboard.studyMaterial")}</p>
                  <p className="text-xs text-[var(--cs-text-muted)]">{t("studentDashboard.studyMaterialDescription")}</p>
                </div>
              </Link>
              <Link to="/app/inbox" className="flex items-center rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] p-3 transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-surface-2)]">
                <div className="mr-3 rounded-[var(--cs-radius-control)] bg-[var(--cs-surface-2)] p-2 text-[var(--cs-text-muted)]">
                  <CheckCircle className="h-5 w-5" strokeWidth={1.75} />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--cs-text)]">{t("studentDashboard.tutorChat")}</p>
                  <p className="text-xs text-[var(--cs-text-muted)]">{t("studentDashboard.tutorChatDescription")}</p>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
