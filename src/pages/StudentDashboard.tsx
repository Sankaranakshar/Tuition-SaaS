import { useState, useEffect } from "react";
import { Calendar, DollarSign, Video, BookOpen, Clock, FileText, CheckCircle, AlertTriangle } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { format, isSameDay, parseISO, isAfter, startOfDay } from "date-fns";
import { Link } from "react-router-dom";
import LoadingSpinner from "../components/LoadingSpinner";
import { formatINR } from "../lib/format";
import { debounce } from "../lib/debounce";

export default function StudentDashboard() {
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

  if (loading) return <LoadingSpinner message="Loading dashboard..." />;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-[var(--cs-text)]">Student Overview</h1>
      </div>

      {/* Action Center Alerts */}
      {overdueInvoices.length > 0 && (
        <div className="bg-red-50 border-l-4 border-[var(--cs-danger)] p-4 rounded-[6px]">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-[var(--cs-danger)]" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-[var(--cs-danger)]">
                You have {overdueInvoices.length} overdue invoice(s).
                <Link to="/app/money" className="font-medium underline ml-1">Pay now</Link>
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: My Snapshot */}
        <div className="lg:col-span-2 space-y-6">

          {/* Upcoming Classes */}
          <div className="bg-[var(--cs-surface)] rounded-[10px] border border-[var(--cs-border)] overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--cs-border)] flex justify-between items-center">
              <h2 className="text-lg font-semibold text-[var(--cs-text)] flex items-center">
                <Calendar className="w-5 h-5 mr-2 text-[var(--cs-accent)]" />
                Next Upcoming Classes
              </h2>
              <Link to="/app/timetable" className="text-sm text-[var(--cs-accent)] hover:opacity-80 font-medium">
                View Timetable
              </Link>
            </div>

            {upcomingClasses.length > 0 ? (
              <ul className="divide-y divide-[var(--cs-border)]">
                {upcomingClasses.map((session) => (
                  <li key={session.id} className="px-6 py-4 flex items-center justify-between gap-3 hover:bg-[var(--cs-bg)] transition-colors">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-[var(--cs-text)]">{session.title || 'Class Session'}</p>
                      <p className="text-sm text-[var(--cs-text-muted)] flex items-center mt-1">
                        <Clock className="w-4 h-4 mr-1 shrink-0" />
                        {format(parseISO(session.startTime), 'MMM d, yyyy')} • {format(parseISO(session.startTime), 'h:mm a')} - {format(parseISO(session.endTime), 'h:mm a')}
                      </p>
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      <span className={`whitespace-nowrap px-2.5 py-1 rounded-full text-xs font-medium ${session.isOnline ? 'bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]' : 'bg-green-50 text-[var(--cs-ok)]'}`}>
                        {session.isOnline ? 'Online' : 'In-Person'}
                      </span>
                      {session.isOnline && session.meetingLink && (
                        <a
                          href={session.meetingLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex items-center rounded-[6px] bg-[var(--cs-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 transition-opacity"
                        >
                          <Video className="w-4 h-4 mr-2" />
                          Join
                        </a>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <div className="px-6 py-8 text-center">
                <Calendar className="mx-auto h-10 w-10 text-[var(--cs-border)]" />
                <p className="mt-2 text-sm text-[var(--cs-text-muted)]">No upcoming classes scheduled.</p>
              </div>
            )}
          </div>

          {/* Recent Grades */}
          <div className="bg-[var(--cs-surface)] rounded-[10px] border border-[var(--cs-border)] overflow-hidden">
            <div className="px-6 py-4 border-b border-[var(--cs-border)] flex justify-between items-center">
              <h2 className="text-lg font-semibold text-[var(--cs-text)] flex items-center">
                <BookOpen className="w-5 h-5 mr-2 text-[var(--cs-accent)]" />
                Latest Grades
              </h2>
              <Link to="/app/my-story" className="text-sm text-[var(--cs-accent)] hover:opacity-80 font-medium">
                View Gradebook
              </Link>
            </div>

            {recentGrades.length > 0 ? (
              <ul className="divide-y divide-[var(--cs-border)]">
                {recentGrades.map((grade) => {
                  const maxScore = grade.totalScore || grade.maxScore || 100;
                  const percentage = Math.round((Number(grade.score) / Number(maxScore)) * 100);
                  let statusColor = 'text-[var(--cs-ok)] bg-green-50';
                  if (percentage < 60) statusColor = 'text-[var(--cs-danger)] bg-red-50';
                  else if (percentage < 80) statusColor = 'text-[var(--cs-warn)] bg-yellow-50';

                  return (
                    <li key={grade.id} className="px-6 py-4 flex items-center justify-between hover:bg-[var(--cs-bg)] transition-colors">
                      <div>
                        <p className="text-sm font-medium text-[var(--cs-text)]">{grade.title || 'Untitled Assessment'}</p>
                        <p className="text-xs text-[var(--cs-text-muted)] mt-1">{grade.date ? format(parseISO(grade.date), 'MMM d, yyyy') : 'N/A'} • {grade.type}</p>
                      </div>
                      <div className="flex items-center gap-4">
                        <div className="text-right">
                          <p className="text-sm font-bold text-[var(--cs-text)]">{grade.score} / {maxScore}</p>
                          <p className="text-xs text-[var(--cs-text-muted)]">{percentage}%</p>
                        </div>
                        <div className={`px-2.5 py-1 rounded-[6px] text-xs font-bold ${statusColor}`}>
                          {percentage >= 60 ? 'Pass' : 'Review'}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-6 py-8 text-center">
                <FileText className="mx-auto h-10 w-10 text-[var(--cs-border)]" />
                <p className="mt-2 text-sm text-[var(--cs-text-muted)]">No recent grades available.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Wallet & Quick Links */}
        <div className="space-y-6">
          {/* Wallet Snapshot */}
          <div className="bg-[var(--cs-surface)] p-6 rounded-[10px] border border-[var(--cs-border)]">
            <h2 className="text-lg font-semibold text-[var(--cs-text)] flex items-center mb-4">
              <DollarSign className="w-5 h-5 mr-2 text-[var(--cs-accent)]" />
              Wallet Balance
            </h2>
            <div className="text-center py-4">
              <p className="text-4xl font-bold text-[var(--cs-text)]">{formatINR(walletBalance)}</p>
              <p className="text-sm text-[var(--cs-text-muted)] mt-1">Available Credits</p>
            </div>
            <div className="mt-4">
              <Link to="/app/money" className="w-full flex justify-center items-center rounded-[6px] bg-[var(--cs-accent-soft)] px-4 py-2 text-sm font-medium text-[var(--cs-accent)] hover:opacity-90">
                Top-up Wallet
              </Link>
            </div>
          </div>

          {/* Quick Links */}
          <div className="bg-[var(--cs-surface)] p-6 rounded-[10px] border border-[var(--cs-border)]">
            <h2 className="text-lg font-semibold text-[var(--cs-text)] mb-4">Quick Links</h2>
            <div className="space-y-3">
              <Link to="/app/my-story" className="flex items-center p-3 rounded-[6px] border border-[var(--cs-border)] hover:bg-[var(--cs-bg)] transition-colors">
                <div className="bg-[var(--cs-accent-soft)] p-2 rounded-[6px] mr-3 text-[var(--cs-accent)]">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--cs-text)]">Study Material</p>
                  <p className="text-xs text-[var(--cs-text-muted)]">Access notes & assignments</p>
                </div>
              </Link>
              <Link to="/app/inbox" className="flex items-center p-3 rounded-[6px] border border-[var(--cs-border)] hover:bg-[var(--cs-bg)] transition-colors">
                <div className="bg-green-50 p-2 rounded-[6px] mr-3 text-[var(--cs-ok)]">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--cs-text)]">Tutor Chat</p>
                  <p className="text-xs text-[var(--cs-text-muted)]">Message your instructors</p>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
