import { useState, useEffect } from "react";
import { Calendar, DollarSign, Video, BookOpen, Clock, FileText, CheckCircle, AlertTriangle } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { format, isSameDay, parseISO, isAfter, startOfDay } from "date-fns";
import { Link } from "react-router-dom";
import LoadingSpinner from "../components/LoadingSpinner";
import { formatINR } from "../lib/format";

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

    // postgres_changes filters only support one simple column=eq condition, and
    // none of these tables are org-scoped filterable by this student directly
    // via a single column here, so scope each subscription to its own table
    // and just refetch that table's query on any change within the org-visible
    // rows RLS already restricts to this student.
    const channel = supabase
      .channel(`student-dashboard-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "class_sessions" }, loadSessions)
      .on("postgres_changes", { event: "*", schema: "public", table: "assessments" }, loadAssessments)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices" }, loadInvoices)
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets" }, loadWallet)
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
        <h1 className="text-2xl font-bold text-gray-900">Student Overview</h1>
      </div>
      
      {/* Action Center Alerts */}
      {overdueInvoices.length > 0 && (
        <div className="bg-red-50 border-l-4 border-red-400 p-4 rounded-md">
          <div className="flex">
            <div className="flex-shrink-0">
              <AlertTriangle className="h-5 w-5 text-red-400" />
            </div>
            <div className="ml-3">
              <p className="text-sm text-red-700">
                You have {overdueInvoices.length} overdue invoice(s). 
                <Link to="/app/wallet" className="font-medium underline ml-1">Pay now</Link>
              </p>
            </div>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: My Snapshot */}
        <div className="lg:col-span-2 space-y-6">
          
          {/* Upcoming Classes */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden transition-all duration-200 hover:shadow-md hover:-translate-y-1">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <Calendar className="w-5 h-5 mr-2 text-indigo-500" />
                Next Upcoming Classes
              </h2>
              <Link to="/app/timetable" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
                View Timetable
              </Link>
            </div>
            
            {upcomingClasses.length > 0 ? (
              <ul className="divide-y divide-gray-100">
                {upcomingClasses.map((session) => (
                  <li key={session.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{session.title || 'Class Session'}</p>
                      <p className="text-sm text-gray-500 flex items-center mt-1">
                        <Clock className="w-4 h-4 mr-1" />
                        {format(parseISO(session.startTime), 'MMM d, yyyy')} • {format(parseISO(session.startTime), 'h:mm a')} - {format(parseISO(session.endTime), 'h:mm a')}
                      </p>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${session.isOnline ? 'bg-indigo-50 text-indigo-700' : 'bg-emerald-50 text-emerald-700'}`}>
                        {session.isOnline ? 'Online' : 'In-Person'}
                      </span>
                      {session.isOnline && session.meetingLink && (
                        <a 
                          href={session.meetingLink} 
                          target="_blank" 
                          rel="noopener noreferrer"
                          className="flex items-center px-3 py-1.5 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
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
                <Calendar className="mx-auto h-10 w-10 text-gray-300" />
                <p className="mt-2 text-sm text-gray-500">No upcoming classes scheduled.</p>
              </div>
            )}
          </div>

          {/* Recent Grades */}
          <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden transition-all duration-200 hover:shadow-md hover:-translate-y-1">
            <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
              <h2 className="text-lg font-semibold text-gray-900 flex items-center">
                <BookOpen className="w-5 h-5 mr-2 text-indigo-500" />
                Latest Grades
              </h2>
              <Link to="/app/academic-progress" className="text-sm text-indigo-600 hover:text-indigo-800 font-medium">
                View Gradebook
              </Link>
            </div>
            
            {recentGrades.length > 0 ? (
              <ul className="divide-y divide-gray-100">
                {recentGrades.map((grade) => {
                  const maxScore = grade.totalScore || grade.maxScore || 100;
                  const percentage = Math.round((Number(grade.score) / Number(maxScore)) * 100);
                  let statusColor = 'text-green-600 bg-green-50';
                  if (percentage < 60) statusColor = 'text-red-600 bg-red-50';
                  else if (percentage < 80) statusColor = 'text-yellow-600 bg-yellow-50';

                  return (
                    <li key={grade.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{grade.title || 'Untitled Assessment'}</p>
                        <p className="text-xs text-gray-500 mt-1">{grade.date ? format(parseISO(grade.date), 'MMM d, yyyy') : 'N/A'} • {grade.type}</p>
                      </div>
                      <div className="flex items-center space-x-4">
                        <div className="text-right">
                          <p className="text-sm font-bold text-gray-900">{grade.score} / {maxScore}</p>
                          <p className="text-xs text-gray-500">{percentage}%</p>
                        </div>
                        <div className={`px-2.5 py-1 rounded-md text-xs font-bold ${statusColor}`}>
                          {percentage >= 60 ? 'Pass' : 'Review'}
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="px-6 py-8 text-center">
                <FileText className="mx-auto h-10 w-10 text-gray-300" />
                <p className="mt-2 text-sm text-gray-500">No recent grades available.</p>
              </div>
            )}
          </div>
        </div>

        {/* Right Column: Wallet & Quick Links */}
        <div className="space-y-6">
          {/* Wallet Snapshot */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 transition-all duration-200 hover:shadow-md hover:-translate-y-1">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center mb-4">
              <DollarSign className="w-5 h-5 mr-2 text-indigo-500" />
              Wallet Balance
            </h2>
            <div className="text-center py-4">
              <p className="text-4xl font-bold text-gray-900">{formatINR(walletBalance)}</p>
              <p className="text-sm text-gray-500 mt-1">Available Credits</p>
            </div>
            <div className="mt-4">
              <Link to="/app/transactions" className="w-full flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-indigo-700 bg-indigo-100 hover:bg-indigo-200">
                Top-up Wallet
              </Link>
            </div>
          </div>

          {/* Quick Links */}
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 transition-all duration-200 hover:shadow-md hover:-translate-y-1">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Quick Links</h2>
            <div className="space-y-3">
              <Link to="/app/study-material" className="flex items-center p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                <div className="bg-blue-100 p-2 rounded-md mr-3 text-blue-600">
                  <FileText className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Study Material</p>
                  <p className="text-xs text-gray-500">Access notes & assignments</p>
                </div>
              </Link>
              <Link to="/app/messaging" className="flex items-center p-3 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors">
                <div className="bg-green-100 p-2 rounded-md mr-3 text-green-600">
                  <CheckCircle className="w-5 h-5" />
                </div>
                <div>
                  <p className="text-sm font-medium text-gray-900">Tutor Chat</p>
                  <p className="text-xs text-gray-500">Message your instructors</p>
                </div>
              </Link>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
