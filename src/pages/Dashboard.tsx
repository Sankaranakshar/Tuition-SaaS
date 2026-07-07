import { useState, useEffect } from "react";
import { Users, Calendar, DollarSign, Video, AlertTriangle, CheckCircle, TrendingDown } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { Link } from "react-router-dom";
import StudentDashboard from "./StudentDashboard";
import { 
  calculateStudentMetrics, 
  calculateSessionMetrics, 
  calculateInvoiceMetrics, 
  calculateAssessmentMetrics,
  Student,
  Session,
  Invoice,
  Assessment
} from "../utils/analytics";

import LoadingSpinner from "../components/LoadingSpinner";

interface DashboardData {
  kpis: {
    activeStudents: number;
    classesToday: number;
    pendingInvoiceAmount: number;
  };
  upcomingClasses: Session[];
  monthlyRevenue: { month: string; total: number }[];
  studentPerformance: {
    studentId: string;
    percentage: number;
    status: string;
    assessmentsCount: number;
  }[];
}

export default function Dashboard() {
  const { user, currentRole } = useAuth();
  const [data, setData] = useState<DashboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [students, setStudents] = useState<Student[]>([]);

  useEffect(() => {
    if (currentRole === 'student') return;
    if (!user || !user.organizationId) return;

    const studentsConstraints = [where("organizationId", "==", user.organizationId)];
    if (user.role === 'tutor') studentsConstraints.push(where("tutorId", "==", user.id));
    const qStudents = query(collection(db, "students"), ...studentsConstraints);
    
    const unsubStudents = onSnapshot(qStudents, (snapshot) => {
      const studs = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Student));
      setStudents(studs);
      
      const { activeStudents } = calculateStudentMetrics(studs);

      setData(prev => ({
        ...prev,
        kpis: {
          ...prev?.kpis,
          activeStudents,
          classesToday: prev?.kpis?.classesToday || 0,
          pendingInvoiceAmount: prev?.kpis?.pendingInvoiceAmount || 0
        },
        upcomingClasses: prev?.upcomingClasses || [],
        monthlyRevenue: prev?.monthlyRevenue || [],
        studentPerformance: prev?.studentPerformance || []
      }));
    }, (error) => {
      console.error("Firestore Error (Students): ", error);
    });

    const sessionsConstraints = [where("organizationId", "==", user.organizationId)];
    if (user.role === 'tutor') sessionsConstraints.push(where("tutorId", "==", user.id));
    const qSessions = query(collection(db, "class_sessions"), ...sessionsConstraints);
    
    const unsubSessions = onSnapshot(qSessions, (sessionSnapshot) => {
      const sessions = sessionSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Session));
      
      const { classesToday, upcomingClasses } = calculateSessionMetrics(sessions, new Date());

      setData(prev => ({
        ...prev,
        kpis: {
          ...prev?.kpis,
          activeStudents: prev?.kpis?.activeStudents || 0,
          classesToday,
          pendingInvoiceAmount: prev?.kpis?.pendingInvoiceAmount || 0
        },
        upcomingClasses,
        monthlyRevenue: prev?.monthlyRevenue || [],
        studentPerformance: prev?.studentPerformance || []
      }));
    }, (error) => {
      console.error("Firestore Error (Sessions): ", error);
    });

    const invoicesConstraints = [where("organizationId", "==", user.organizationId)];
    if (user.role === 'tutor') invoicesConstraints.push(where("tutorId", "==", user.id));
    const qInvoices = query(collection(db, "invoices"), ...invoicesConstraints);
    
    const unsubInvoices = onSnapshot(qInvoices, (invoiceSnapshot) => {
      const invoices = invoiceSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Invoice));
      
      const { pendingInvoiceAmount, monthlyRevenue } = calculateInvoiceMetrics(invoices);

      setData(prev => ({
        ...prev,
        kpis: {
          ...prev?.kpis,
          activeStudents: prev?.kpis?.activeStudents || 0,
          classesToday: prev?.kpis?.classesToday || 0,
          pendingInvoiceAmount
        },
        upcomingClasses: prev?.upcomingClasses || [],
        monthlyRevenue,
        studentPerformance: prev?.studentPerformance || []
      }));
    }, (error) => {
      console.error("Firestore Error (Invoices): ", error);
    });

    const assessmentsConstraints = [where("organizationId", "==", user.organizationId)];
    if (user.role === 'tutor') assessmentsConstraints.push(where("tutorId", "==", user.id));
    const qAssessments = query(collection(db, "assessments"), ...assessmentsConstraints);
    
    const unsubAssessments = onSnapshot(qAssessments, (assessmentSnapshot) => {
      const assessments = assessmentSnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Assessment));
      
      const { studentPerformance } = calculateAssessmentMetrics(assessments);

      setData(prev => ({
        ...prev,
        kpis: {
          ...prev?.kpis,
          activeStudents: prev?.kpis?.activeStudents || 0,
          classesToday: prev?.kpis?.classesToday || 0,
          pendingInvoiceAmount: prev?.kpis?.pendingInvoiceAmount || 0
        },
        upcomingClasses: prev?.upcomingClasses || [],
        monthlyRevenue: prev?.monthlyRevenue || [],
        studentPerformance
      }));
      setLoading(false);
    }, (error) => {
      console.error("Firestore Error (Assessments): ", error);
      setLoading(false);
    });

    return () => {
      unsubStudents();
      unsubSessions();
      unsubInvoices();
      unsubAssessments();
    };
  }, [user, currentRole]);

  const getStudentName = (id: string) => {
    const student = students.find(s => s.id === id);
    return student ? student.name : "Unknown Student";
  };

  if (currentRole === 'student') {
    return <StudentDashboard />;
  }

  if (loading) return <LoadingSpinner message="Loading dashboard..." />;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Business Pulse & Actions</h1>
        <div className="flex space-x-3">
          <Link to="/app/students" className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700">
            <Users className="w-4 h-4 mr-2" />
            Onboard Student
          </Link>
          <Link to="/app/calendar" className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-green-600 hover:bg-green-700">
            <Calendar className="w-4 h-4 mr-2" />
            Schedule Class
          </Link>
          <Link to="/app/invoices" className="inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-orange-600 hover:bg-orange-700">
            <DollarSign className="w-4 h-4 mr-2" />
            Manual Billing
          </Link>
        </div>
      </div>
      
      {/* KPI Widgets */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center transition-all duration-200 hover:shadow-md hover:-translate-y-1">
          <div className="p-3 rounded-full bg-blue-50 text-blue-600 mr-4">
            <Calendar className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Classes Today</p>
            <p className="text-2xl font-bold text-gray-900">{data?.kpis?.classesToday || 0}</p>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center transition-all duration-200 hover:shadow-md hover:-translate-y-1">
          <div className="p-3 rounded-full bg-green-50 text-green-600 mr-4">
            <Users className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Active Students</p>
            <p className="text-2xl font-bold text-gray-900">{data?.kpis?.activeStudents || 0}</p>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex items-center transition-all duration-200 hover:shadow-md hover:-translate-y-1">
          <div className="p-3 rounded-full bg-orange-50 text-orange-600 mr-4">
            <DollarSign className="w-6 h-6" />
          </div>
          <div>
            <p className="text-sm font-medium text-gray-500">Pending Invoices</p>
            <p className="text-2xl font-bold text-gray-900">${data?.kpis?.pendingInvoiceAmount?.toFixed(2) || "0.00"}</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Revenue Chart */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 transition-all duration-200 hover:shadow-md">
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Monthly Revenue</h2>
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data?.monthlyRevenue || []}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} />
                <XAxis 
                  dataKey="month" 
                  tickFormatter={(value) => {
                    const date = new Date(value + "-01");
                    return date.toLocaleDateString('en-US', { month: 'short' });
                  }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis 
                  axisLine={false}
                  tickLine={false}
                  tickFormatter={(value) => `$${value}`}
                />
                <Tooltip 
                  formatter={(value: number) => [`$${value}`, 'Revenue']}
                  labelFormatter={(label) => {
                    const date = new Date(label + "-01");
                    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
                  }}
                />
                <Bar dataKey="total" fill="#4f46e5" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Upcoming Classes */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900">Upcoming Classes</h2>
          </div>
          
          {Array.isArray(data?.upcomingClasses) && data.upcomingClasses.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {data.upcomingClasses.map((session) => (
                <li key={session.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-gray-900">
                      {session.studentIds?.map(id => getStudentName(id)).join(', ') || 'Unknown Student'}
                    </p>
                    <p className="text-sm text-gray-500">
                      {new Date(session.startTime).toLocaleDateString()} • {new Date(session.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - {new Date(session.endTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
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
                        Join Meet
                      </a>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-6 py-12 text-center">
              <Calendar className="mx-auto h-12 w-12 text-gray-300" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No upcoming classes</h3>
              <p className="mt-1 text-sm text-gray-500">You don't have any classes scheduled for today.</p>
            </div>
          )}
        </div>
      </div>

      {/* Students Needing Attention */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden mt-6">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            <TrendingDown className="w-5 h-5 mr-2 text-red-500" /> Students Needing Attention
          </h2>
        </div>
        
        {Array.isArray(data?.studentPerformance) && data.studentPerformance.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Student</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Average Score</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assessments</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {data.studentPerformance.filter(p => p.status === 'red' || p.status === 'yellow').slice(0, 5).map((perf) => (
                  <tr key={perf.studentId} className="hover:bg-gray-50">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-medium text-gray-900">{getStudentName(perf.studentId)}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm font-bold text-gray-900">{perf.percentage}%</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        perf.status === 'red' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'
                      }`}>
                        {perf.status === 'red' ? 'Needs Help' : 'At Risk'}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {perf.assessmentsCount}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <Link to={`/app/students/${perf.studentId}`} className="text-indigo-600 hover:text-indigo-900">
                        View Profile
                      </Link>
                    </td>
                  </tr>
                ))}
                {data.studentPerformance.filter(p => p.status === 'red' || p.status === 'yellow').length === 0 && (
                  <tr>
                    <td colSpan={5} className="px-6 py-8 text-center text-sm text-gray-500">
                      <CheckCircle className="mx-auto h-8 w-8 text-green-400 mb-2" />
                      All students are performing well!
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-8 text-center text-sm text-gray-500">
            No assessment data available yet.
          </div>
        )}
      </div>
    </div>
  );
}

