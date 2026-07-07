import { useState, useEffect } from "react";
import { Calendar as CalendarIcon, Clock, Video, CheckCircle, XCircle, AlertCircle } from "lucide-react";
import { collection, query, where, onSnapshot } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { format, parseISO, isAfter, isBefore, startOfDay, endOfDay } from "date-fns";

export default function Timetable() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    const qSessions = query(
      collection(db, "class_sessions"),
      where("studentIds", "array-contains", user.id)
    );
    
    const unsubSessions = onSnapshot(qSessions, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setSessions(data.sort((a, b) => new Date(b.startTime).getTime() - new Date(a.startTime).getTime()));
      setLoading(false);
    });

    return () => unsubSessions();
  }, [user]);

  if (loading) return <div>Loading timetable...</div>;

  const today = new Date();
  const upcomingSessions = sessions.filter(s => isAfter(parseISO(s.startTime), today) || (isAfter(parseISO(s.endTime), today) && isBefore(parseISO(s.startTime), today)));
  const pastSessions = sessions.filter(s => isBefore(parseISO(s.endTime), today));

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">My Timetable</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Upcoming Classes */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <CalendarIcon className="w-5 h-5 mr-2 text-indigo-500" />
              Upcoming Classes
            </h2>
          </div>
          
          {upcomingSessions.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {upcomingSessions.map((session) => (
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
              <CalendarIcon className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">No upcoming classes scheduled.</p>
            </div>
          )}
        </div>

        {/* Attendance Log */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <CheckCircle className="w-5 h-5 mr-2 text-indigo-500" />
              Attendance Log
            </h2>
          </div>
          
          {pastSessions.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {pastSessions.map((session) => {
                // Mock attendance status based on some logic or field
                const status = session.attendanceStatus || 'present'; // present, absent, no-show
                
                return (
                  <li key={session.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{session.title || 'Class Session'}</p>
                      <p className="text-xs text-gray-500 mt-1">{format(parseISO(session.startTime), 'MMM d, yyyy')}</p>
                    </div>
                    <div className="flex items-center">
                      {status === 'present' && (
                        <span className="flex items-center text-sm font-medium text-green-600">
                          <CheckCircle className="w-4 h-4 mr-1" /> Present
                        </span>
                      )}
                      {status === 'absent' && (
                        <span className="flex items-center text-sm font-medium text-red-600">
                          <XCircle className="w-4 h-4 mr-1" /> Absent
                        </span>
                      )}
                      {status === 'no-show' && (
                        <span className="flex items-center text-sm font-medium text-orange-600">
                          <AlertCircle className="w-4 h-4 mr-1" /> No-Show
                        </span>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <div className="px-6 py-8 text-center">
              <Clock className="mx-auto h-10 w-10 text-gray-300" />
              <p className="mt-2 text-sm text-gray-500">No past classes recorded.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
