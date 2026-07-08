import React, { useState, useEffect } from "react";
import { Plus, Video, ChevronLeft, ChevronRight, Users, User, Calendar as CalendarIcon, Clock, MapPin, CheckCircle, XCircle } from "lucide-react";
import { 
  format, 
  startOfMonth, 
  endOfMonth, 
  startOfWeek, 
  endOfWeek, 
  eachDayOfInterval, 
  isSameMonth, 
  isSameDay, 
  addMonths, 
  subMonths,
  parseISO,
  addMonths as addMonthsDate
} from "date-fns";
import { collection, query, where, onSnapshot, addDoc, doc, updateDoc, getDoc, limit, orderBy } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { ClassManager, ClassType, PricingModel } from "../services/ClassManager";
import { markAttendance as apiMarkAttendance, cancelSession, api } from "../lib/api";
import { toast } from "sonner";
import LoadingSpinner from "../components/LoadingSpinner";

export default function Calendar() {
  const { user } = useAuth();
  const [sessions, setSessions] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [courses, setCourses] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSyncModalOpen, setIsSyncModalOpen] = useState(false);

  const generateICS = () => {
    let icsContent = "BEGIN:VCALENDAR\nVERSION:2.0\nPRODID:-//Tutor App//EN\n";
    
    sessions.forEach(session => {
      const start = parseISO(session.startTime);
      const end = parseISO(session.endTime);
      
      const formatICSDate = (date: Date) => {
        return date.toISOString().replace(/[-:]/g, '').split('.')[0] + 'Z';
      };

      icsContent += "BEGIN:VEVENT\n";
      icsContent += `UID:${session.id}@tutorapp.com\n`;
      icsContent += `DTSTAMP:${formatICSDate(new Date())}\n`;
      icsContent += `DTSTART:${formatICSDate(start)}\n`;
      icsContent += `DTEND:${formatICSDate(end)}\n`;
      icsContent += `SUMMARY:Class Session\n`;
      if (session.meetingLink) {
        icsContent += `LOCATION:${session.meetingLink}\n`;
      } else if (session.roomNumber) {
        icsContent += `LOCATION:Room ${session.roomNumber}\n`;
      }
      icsContent += "END:VEVENT\n";
    });

    icsContent += "END:VCALENDAR";

    const blob = new Blob([icsContent], { type: 'text/calendar;charset=utf-8' });
    const link = document.createElement('a');
    link.href = window.URL.createObjectURL(blob);
    link.setAttribute('download', 'my_schedule.ics');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };
  const [loading, setLoading] = useState(true);
  const [currentMonth, setCurrentMonth] = useState(new Date());
  
  // Wizard State
  const [step, setStep] = useState(1);
  const [classType, setClassType] = useState<ClassType>(ClassType.BATCH);
  
  // Form State
  const [courseId, setCourseId] = useState("");
  const [pricingModel, setPricingModel] = useState<PricingModel>(PricingModel.MONTHLY);
  const [feeAmount, setFeeAmount] = useState(0);
  const [capacity, setCapacity] = useState(1);
  const [selectedDays, setSelectedDays] = useState<number[]>([]);
  const [startDate, setStartDate] = useState("");
  const [startTime, setStartTime] = useState("");
  const [duration, setDuration] = useState(60);
  const [isOnline, setIsOnline] = useState(false);
  const [roomNumber, setRoomNumber] = useState("");
  const [selectedStudentIds, setSelectedStudentIds] = useState<string[]>([]);
  
  // Popover State
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  const [dragDropConfirm, setDragDropConfirm] = useState<{
    sessionId: string;
    newStart: Date;
    newEnd: Date;
    templateId?: string;
  } | null>(null);
  const [conflictWarning, setConflictWarning] = useState<string | null>(null);

  useEffect(() => {
    if (!startDate || !startTime || !user || !user.id) {
      setConflictWarning(null);
      return;
    }

    const checkConflicts = () => {
      const [hours, minutes] = startTime.split(':').map(Number);
      
      if (classType === ClassType.ONE_ON_ONE || classType === ClassType.CRASH_COURSE) {
        const sessionStart = new Date(startDate);
        sessionStart.setHours(hours, minutes, 0, 0);
        const sessionEnd = new Date(sessionStart);
        sessionEnd.setMinutes(sessionStart.getMinutes() + duration);

        const hasOverlap = sessions.some(session => {
          if (session.tutorId !== user.id || session.status !== 'scheduled') return false;
          const sStart = parseISO(session.startTime);
          const sEnd = parseISO(session.endTime);
          return (sessionStart < sEnd && sessionEnd > sStart);
        });

        if (hasOverlap) {
          setConflictWarning("Warning: You have a conflicting session at this time.");
        } else {
          setConflictWarning(null);
        }
      } else {
        // Batch recurring
        if (selectedDays.length === 0) {
          setConflictWarning(null);
          return;
        }

        const startD = new Date(startDate);
        const endD = addMonthsDate(startD, 3);
        
        let hasConflict = false;
        
        for (const dayOfWeek of selectedDays) {
          let currentDate = new Date(startD);
          while (currentDate.getDay() !== dayOfWeek) {
            currentDate.setDate(currentDate.getDate() + 1);
          }
          
          while (currentDate <= endD) {
            const sessionStart = new Date(currentDate);
            sessionStart.setHours(hours, minutes, 0, 0);
            const sessionEnd = new Date(sessionStart);
            sessionEnd.setMinutes(sessionStart.getMinutes() + duration);

            const overlap = sessions.some(session => {
              if (session.tutorId !== user.id || session.status !== 'scheduled') return false;
              const sStart = parseISO(session.startTime);
              const sEnd = parseISO(session.endTime);
              return (sessionStart < sEnd && sessionEnd > sStart);
            });

            if (overlap) {
              hasConflict = true;
              break;
            }
            currentDate.setDate(currentDate.getDate() + 7);
          }
          if (hasConflict) break;
        }

        if (hasConflict) {
          setConflictWarning("Warning: Some recurring sessions conflict with your existing schedule.");
        } else {
          setConflictWarning(null);
        }
      }
    };

    checkConflicts();
  }, [startDate, startTime, duration, classType, selectedDays, sessions, user]);
  useEffect(() => {
    if (!user || !user.organizationId) return;

    const studentsConstraints: any[] = [where("organizationId", "==", user.organizationId)];
    if (user.role === 'tutor') studentsConstraints.push(where("tutorId", "==", user.id));
    studentsConstraints.push(limit(100));
    const qStudents = query(collection(db, "students"), ...studentsConstraints);
    const unsubStudents = onSnapshot(qStudents, (snapshot) => {
      setStudents(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    const sessionsConstraints: any[] = [where("organizationId", "==", user.organizationId)];
    if (user.role === 'tutor') sessionsConstraints.push(where("tutorId", "==", user.id));
    sessionsConstraints.push(orderBy("startTime"), limit(200));
    const qSessions = query(collection(db, "class_sessions"), ...sessionsConstraints);
    const unsubSessions = onSnapshot(qSessions, (snapshot) => {
      setSessions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
      setLoading(false);
    });

    const qCourses = query(collection(db, "courses"), where("organizationId", "==", user.organizationId), limit(100));
    const unsubCourses = onSnapshot(qCourses, (snapshot) => {
      setCourses(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })));
    });

    return () => {
      unsubStudents();
      unsubSessions();
      unsubCourses();
    };
  }, [user]);

  const findGap = () => {
    // Find a gap of `duration` minutes during working hours (9 AM - 5 PM) starting from tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(9, 0, 0, 0);

    let currentCheck = new Date(tomorrow);
    const maxDaysToCheck = 14;

    for (let i = 0; i < maxDaysToCheck; i++) {
      // Check from 9 AM to 5 PM
      while (currentCheck.getHours() < 17) {
        const checkEnd = new Date(currentCheck);
        checkEnd.setMinutes(checkEnd.getMinutes() + duration);

        // Does this overlap with any existing session?
        const hasOverlap = sessions.some(session => {
          const sStart = parseISO(session.startTime);
          const sEnd = parseISO(session.endTime);
          return (currentCheck < sEnd && checkEnd > sStart);
        });

        if (!hasOverlap) {
          // Found a gap!
          setStartDate(format(currentCheck, 'yyyy-MM-dd'));
          setStartTime(format(currentCheck, 'HH:mm'));
          return;
        }

        // Increment by 30 mins
        currentCheck.setMinutes(currentCheck.getMinutes() + 30);
      }
      // Move to next day at 9 AM
      currentCheck.setDate(currentCheck.getDate() + 1);
      currentCheck.setHours(9, 0, 0, 0);
    }
    toast.info("No gaps found in the next 14 days.");
  };

  const handleCreateTemplateAndSessions = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !user.organizationId) return;

    try {
      const [hours, minutes] = startTime.split(':').map(Number);

      // 1. Create Class Template. For a recurring batch this is the source
      // of truth (DEV_PLAN E3.7): the schedule fields persist here, and a
      // server-side job (POST /scheduling/materialize, also run daily via
      // Cloud Scheduler) derives sessions from it going forward, rather
      // than bulk-creating months of sessions once that go stale the
      // moment the template is edited.
      const templateData = {
        organizationId: user.organizationId,
        courseId,
        tutorId: user.id,
        type: classType,
        pricingModel,
        feeAmount: Number(feeAmount),
        capacity: classType === ClassType.ONE_ON_ONE ? 1 : Number(capacity),
        recurringPattern: selectedDays.join(","),
        daysOfWeek: selectedDays,
        startHour: hours,
        startMinute: minutes,
        durationMinutes: duration,
        isOnline,
        roomNumber: roomNumber || null,
        studentIds: selectedStudentIds,
        createdAt: new Date().toISOString()
      };

      const templateRef = await addDoc(collection(db, "class_templates"), templateData);
      const startD = new Date(startDate);

      if (classType === ClassType.ONE_ON_ONE || classType === ClassType.CRASH_COURSE) {
        // Single session or specific one-off date.
        const sessionStart = new Date(startD);
        sessionStart.setHours(hours, minutes, 0, 0);
        const sessionEnd = new Date(sessionStart);
        sessionEnd.setMinutes(sessionStart.getMinutes() + duration);

        await ClassManager.createSession({
          organizationId: user.organizationId,
          templateId: templateRef.id,
          tutorId: user.id,
          studentIds: selectedStudentIds,
          startTime: sessionStart.toISOString(),
          endTime: sessionEnd.toISOString(),
          status: "scheduled",
          isOnline,
          roomNumber,
        });
      } else {
        // Recurring batch: fill the rolling window immediately so the
        // calendar isn't empty until the next cron run.
        const { conflicts } = await api<{ ok: true; created: string[]; conflicts: { templateId: string; date: string }[] }>(
          "/scheduling/materialize",
          { method: "POST" }
        );
        if (conflicts.length > 0) {
          toast.warning(`${conflicts.length} session(s) skipped due to conflicts`, {
            description: conflicts.slice(0, 3).map(c => new Date(c.date).toLocaleDateString()).join(", ") + (conflicts.length > 3 ? "\u2026" : ""),
          });
        }

        // Auto-enroll selected students
        for (const studentId of selectedStudentIds) {
          await ClassManager.enrollStudent(user.organizationId, studentId, templateRef.id);
        }
      }

      closeModal();
      toast.success("Class created");
    } catch (error: any) {
      toast.error("Could not create class", { description: error.message });
    }
  };

  const closeModal = () => {
    setIsModalOpen(false);
    setStep(1);
    setClassType(ClassType.BATCH);
    setCourseId("");
    setSelectedDays([]);
    setStartDate("");
    setStartTime("");
    setSelectedStudentIds([]);
    setRoomNumber("");
    setIsOnline(false);
  };

  const toggleDay = (day: number) => {
    setSelectedDays(prev => 
      prev.includes(day) ? prev.filter(d => d !== day) : [...prev, day]
    );
  };

  const toggleStudent = (studentId: string) => {
    setSelectedStudentIds(prev => 
      prev.includes(studentId) ? prev.filter(id => id !== studentId) : [...prev, studentId]
    );
  };

  const markAttendance = async (sessionId: string, status: string) => {
    try {
      if (status === 'completed' && selectedSession) {
        // Attendance + billing is a server-side transaction; the client has
        // no write path to wallets or attendance records.
        const result = await apiMarkAttendance(
          sessionId,
          (selectedSession.studentIds || []).map((studentId: string) => ({ studentId, status: "present" as const }))
        );
        const parts = ["Attendance saved"];
        if (result.billed.length) parts.push(`${result.billed.length} billed from wallet`);
        if (result.invoiced.length) parts.push(`${result.invoiced.length} invoiced`);
        toast.success(parts.join(" \u00b7 "));
      } else {
        await cancelSession(sessionId);
        toast.success("Session cancelled");
      }
      setSelectedSession(null);
    } catch (error: any) {
      toast.error("Could not update session", { description: error.message });
    }
  };

  const nextMonth = () => setCurrentMonth(addMonths(currentMonth, 1));
  const prevMonth = () => setCurrentMonth(subMonths(currentMonth, 1));

  const monthStart = startOfMonth(currentMonth);
  const monthEnd = endOfMonth(monthStart);
  const calendarStartDate = startOfWeek(monthStart);
  const calendarEndDate = endOfWeek(monthEnd);

  const calendarDays = eachDayOfInterval({
    start: calendarStartDate,
    end: calendarEndDate,
  });

  const updateSessionTime = async (sessionId: string, newStart: Date, newEnd: Date) => {
    try {
      const sessionRef = doc(db, "class_sessions", sessionId);
      await updateDoc(sessionRef, {
        startTime: newStart.toISOString(),
        endTime: newEnd.toISOString()
      });
    } catch (error) {
      console.error("Error updating session time:", error);
    }
  };

  const updateFutureSessions = async () => {
    if (!dragDropConfirm) return;
    
    const { sessionId, newStart, newEnd, templateId } = dragDropConfirm;
    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;
    
    const originalStart = parseISO(session.startTime);
    const dayDiff = Math.round((newStart.getTime() - originalStart.getTime()) / (1000 * 60 * 60 * 24));

    try {
      // Find all future sessions for this template
      const futureSessions = sessions.filter(s => 
        s.templateId === templateId && 
        parseISO(s.startTime).getTime() >= originalStart.getTime()
      );

      // Update them all
      for (const s of futureSessions) {
        const sStart = parseISO(s.startTime);
        const sEnd = parseISO(s.endTime);
        
        const updatedStart = new Date(sStart);
        updatedStart.setDate(updatedStart.getDate() + dayDiff);
        
        const updatedEnd = new Date(sEnd);
        updatedEnd.setDate(updatedEnd.getDate() + dayDiff);

        await updateDoc(doc(db, "class_sessions", s.id), {
          startTime: updatedStart.toISOString(),
          endTime: updatedEnd.toISOString()
        });
      }
      
      setDragDropConfirm(null);
    } catch (error) {
      console.error("Error updating future sessions:", error);
    }
  };

  const handleDrop = async (e: React.DragEvent, targetDay: Date) => {
    e.preventDefault();
    const sessionId = e.dataTransfer.getData('sessionId');
    if (!sessionId) return;

    const session = sessions.find(s => s.id === sessionId);
    if (!session) return;

    const currentStart = parseISO(session.startTime);
    const currentEnd = parseISO(session.endTime);
    
    // Calculate new start and end times
    const newStart = new Date(targetDay);
    newStart.setHours(currentStart.getHours(), currentStart.getMinutes(), 0, 0);
    
    const newEnd = new Date(targetDay);
    newEnd.setHours(currentEnd.getHours(), currentEnd.getMinutes(), 0, 0);

    if (session.templateId) {
      setDragDropConfirm({
        sessionId,
        newStart,
        newEnd,
        templateId: session.templateId
      });
    } else {
      await updateSessionTime(sessionId, newStart, newEnd);
    }
  };

  const getSessionsForDay = (day: Date) => {
    return sessions.filter(session => isSameDay(parseISO(session.startTime), day)).sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime());
  };

  const getStudentNames = (ids: string[]) => {
    if (!ids || ids.length === 0) return "No students";
    const names = ids.map(id => students.find(s => s.id === id)?.name || "Unknown");
    return names.join(", ");
  };

  const getSessionColor = (session: any) => {
    if (session.status === 'completed') return 'bg-green-100 border-green-200 text-green-800';
    if (session.status === 'cancelled') return 'bg-red-100 border-red-200 text-red-800';
    // Color by type (we'd need to fetch template to know type, but let's assume based on student count for now or just a default)
    if (session.studentIds?.length === 1) return 'bg-purple-100 border-purple-200 text-purple-800'; // 1:1
    return 'bg-blue-100 border-blue-200 text-blue-800'; // Batch
  };

  if (loading) {
    return <LoadingSpinner message="Loading calendar..." />;
  }

  return (
    <div className="space-y-6 h-full flex flex-col">
      <div className="flex justify-between items-center">
        <div className="flex items-center space-x-4">
          <h1 className="text-2xl font-bold text-gray-900">Class & Scheduler</h1>
          <div className="flex items-center space-x-2 bg-white rounded-md shadow-sm border border-gray-200 p-1">
            <button onClick={prevMonth} className="p-1 hover:bg-gray-100 rounded-md">
              <ChevronLeft className="w-5 h-5 text-gray-600" />
            </button>
            <span className="text-sm font-medium text-gray-900 w-32 text-center">
              {format(currentMonth, "MMMM yyyy")}
            </span>
            <button onClick={nextMonth} className="p-1 hover:bg-gray-100 rounded-md">
              <ChevronRight className="w-5 h-5 text-gray-600" />
            </button>
          </div>
        </div>
        <div className="flex space-x-3">
          <button 
            onClick={() => setIsSyncModalOpen(true)}
            className="flex items-center px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
          >
            <CalendarIcon className="w-4 h-4 mr-2" />
            Sync Calendar
          </button>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add Class
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-200 flex-1 flex flex-col overflow-hidden relative">
        {/* Days Header */}
        <div className="grid grid-cols-7 border-b border-gray-200 bg-gray-50">
          {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(day => (
            <div key={day} className="py-2 text-center text-xs font-semibold text-gray-500 uppercase tracking-wider">
              {day}
            </div>
          ))}
        </div>
        
        {/* Calendar Grid */}
        <div className="grid grid-cols-7 flex-1 auto-rows-fr">
          {calendarDays.map((day, dayIdx) => {
            const daySessions = getSessionsForDay(day);
            const isCurrentMonth = isSameMonth(day, monthStart);
            
            return (
              <div 
                key={day.toString()} 
                className={`min-h-[120px] border-b border-r border-gray-100 p-2 ${
                  !isCurrentMonth ? 'bg-gray-50/50' : 'bg-white'
                } ${dayIdx % 7 === 6 ? 'border-r-0' : ''}`}
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => handleDrop(e, day)}
              >
                <div className="flex justify-between items-start">
                  <span className={`text-sm font-medium w-6 h-6 flex items-center justify-center rounded-full ${
                    !isCurrentMonth ? 'text-gray-400' : 
                    isSameDay(day, new Date()) ? 'bg-indigo-600 text-white' : 'text-gray-700'
                  }`}>
                    {format(day, 'd')}
                  </span>
                </div>
                
                <div className="mt-2 space-y-1">
                  {daySessions.map(session => (
                    <div 
                      key={session.id}
                      draggable
                      onDragStart={(e) => e.dataTransfer.setData('sessionId', session.id)}
                      onClick={() => setSelectedSession(session)}
                      className={`text-xs p-1.5 rounded border cursor-pointer hover:opacity-80 hover:-translate-y-0.5 transition-all duration-200 ${getSessionColor(session)}`}
                    >
                      <div className="font-medium truncate">
                        {format(parseISO(session.startTime), 'h:mm a')}
                      </div>
                      <div className="truncate opacity-80">
                        {getStudentNames(session.studentIds)}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>

        {/* Session Popover */}
        {selectedSession && (
          <div className="absolute top-1/2 left-1/2 transform -translate-x-1/2 -translate-y-1/2 bg-white rounded-lg shadow-xl border border-gray-200 p-4 w-80 z-10">
            <div className="flex justify-between items-start mb-3">
              <h3 className="font-semibold text-gray-900">Class Details</h3>
              <button onClick={() => setSelectedSession(null)} className="text-gray-400 hover:text-gray-600">
                <XCircle className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-2 text-sm text-gray-600 mb-4">
              <div className="flex items-center"><Clock className="w-4 h-4 mr-2" /> {format(parseISO(selectedSession.startTime), 'MMM d, yyyy h:mm a')}</div>
              <div className="flex items-center"><Users className="w-4 h-4 mr-2" /> {getStudentNames(selectedSession.studentIds)}</div>
              {selectedSession.isOnline ? (
                <div className="flex items-center text-indigo-600"><Video className="w-4 h-4 mr-2" /> <a href={selectedSession.meetingLink} target="_blank" rel="noreferrer" className="hover:underline">Join Meeting</a></div>
              ) : (
                <div className="flex items-center"><MapPin className="w-4 h-4 mr-2" /> Room: {selectedSession.roomNumber || 'TBD'}</div>
              )}
            </div>
            <div className="border-t pt-3">
              <p className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">Quick Actions</p>
              <div className="flex space-x-2">
                <button onClick={() => markAttendance(selectedSession.id, 'completed')} className="flex-1 bg-green-50 text-green-700 py-1.5 rounded text-xs font-medium hover:bg-green-100 border border-green-200">Mark Completed</button>
                <button onClick={() => markAttendance(selectedSession.id, 'cancelled')} className="flex-1 bg-red-50 text-red-700 py-1.5 rounded text-xs font-medium hover:bg-red-100 border border-red-200">Cancel</button>
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Drag Drop Confirm Modal */}
      {dragDropConfirm && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-900 opacity-75" onClick={() => setDragDropConfirm(null)}></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-50 inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Reschedule Recurring Class</h3>
                  <button onClick={() => setDragDropConfirm(null)} className="text-gray-400 hover:text-gray-500">
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
                <div className="mt-2">
                  <p className="text-sm text-gray-500 mb-4">
                    You are moving a session that is part of a recurring series. Do you want to update just this session, or this and all future sessions?
                  </p>
                  <div className="flex flex-col space-y-3">
                    <button
                      onClick={async () => {
                        await updateSessionTime(dragDropConfirm.sessionId, dragDropConfirm.newStart, dragDropConfirm.newEnd);
                        setDragDropConfirm(null);
                      }}
                      className="w-full flex justify-center items-center py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50"
                    >
                      Just this session
                    </button>
                    <button
                      onClick={updateFutureSessions}
                      className="w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                    >
                      This and all future sessions
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Sync Calendar Modal */}
      {isSyncModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-900 opacity-75" onClick={() => setIsSyncModalOpen(false)}></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-50 inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-md sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Sync Calendar</h3>
                  <button onClick={() => setIsSyncModalOpen(false)} className="text-gray-400 hover:text-gray-500">
                    <XCircle className="w-5 h-5" />
                  </button>
                </div>
                <div className="mt-2">
                  <p className="text-sm text-gray-500 mb-4">
                    Download your class schedule as an .ics file to import into Google Calendar, Apple Calendar, or Outlook.
                  </p>
                  <button
                    onClick={generateICS}
                    className="w-full flex justify-center items-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
                  >
                    <CalendarIcon className="w-4 h-4 mr-2" />
                    Download .ics File
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add Class Wizard Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-900 opacity-75" onClick={closeModal}></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-50 inline-block align-bottom bg-white rounded-xl text-left overflow-hidden shadow-2xl transform transition-all sm:my-8 sm:align-middle sm:max-w-2xl sm:w-full">
              
              {/* Wizard Header */}
              <div className="bg-gray-50 px-6 py-4 border-b border-gray-200 flex justify-between items-center">
                <h3 className="text-lg font-semibold text-gray-900">
                  {step === 1 ? "Select Class Type" : "Class Details"}
                </h3>
                <div className="flex space-x-1">
                  <div className={`h-2 w-8 rounded-full ${step >= 1 ? 'bg-indigo-600' : 'bg-gray-200'}`}></div>
                  <div className={`h-2 w-8 rounded-full ${step >= 2 ? 'bg-indigo-600' : 'bg-gray-200'}`}></div>
                </div>
              </div>

              <form onSubmit={step === 1 ? (e) => { e.preventDefault(); setStep(2); } : handleCreateTemplateAndSessions}>
                <div className="px-6 py-6">
                  {step === 1 ? (
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div 
                        onClick={() => setClassType(ClassType.BATCH)}
                        className={`border-2 rounded-xl p-4 cursor-pointer transition-all ${classType === ClassType.BATCH ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`}
                      >
                        <Users className={`w-8 h-8 mb-3 ${classType === ClassType.BATCH ? 'text-indigo-600' : 'text-gray-400'}`} />
                        <h4 className="font-semibold text-gray-900">Batch / Group</h4>
                        <p className="text-xs text-gray-500 mt-1">Recurring classes with multiple students.</p>
                      </div>
                      <div 
                        onClick={() => setClassType(ClassType.ONE_ON_ONE)}
                        className={`border-2 rounded-xl p-4 cursor-pointer transition-all ${classType === ClassType.ONE_ON_ONE ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`}
                      >
                        <User className={`w-8 h-8 mb-3 ${classType === ClassType.ONE_ON_ONE ? 'text-indigo-600' : 'text-gray-400'}`} />
                        <h4 className="font-semibold text-gray-900">1:1 Session</h4>
                        <p className="text-xs text-gray-500 mt-1">Private tutoring for a single student.</p>
                      </div>
                      <div 
                        onClick={() => setClassType(ClassType.CRASH_COURSE)}
                        className={`border-2 rounded-xl p-4 cursor-pointer transition-all ${classType === ClassType.CRASH_COURSE ? 'border-indigo-600 bg-indigo-50' : 'border-gray-200 hover:border-indigo-300'}`}
                      >
                        <CalendarIcon className={`w-8 h-8 mb-3 ${classType === ClassType.CRASH_COURSE ? 'text-indigo-600' : 'text-gray-400'}`} />
                        <h4 className="font-semibold text-gray-900">Workshop</h4>
                        <p className="text-xs text-gray-500 mt-1">One-time event or short crash course.</p>
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      <div className="grid grid-cols-2 gap-6">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Course</label>
                          <select required value={courseId} onChange={e => setCourseId(e.target.value)} className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                            <option value="" disabled>Select a course</option>
                            {courses.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                          </select>
                        </div>
                        {classType === ClassType.BATCH && (
                          <div>
                            <label className="block text-sm font-medium text-gray-700 mb-1">Max Capacity</label>
                            <input type="number" min="1" required value={capacity} onChange={e => setCapacity(Number(e.target.value))} className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                          </div>
                        )}
                      </div>

                      {classType === ClassType.BATCH && (
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-2">Recurring Pattern</label>
                          <div className="flex space-x-2">
                            {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((day, idx) => (
                              <button
                                key={day}
                                type="button"
                                onClick={() => toggleDay(idx)}
                                className={`w-10 h-10 rounded-full flex items-center justify-center text-sm font-medium transition-colors ${
                                  selectedDays.includes(idx) ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
                                }`}
                              >
                                {day[0]}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {conflictWarning && (
                        <div className="bg-yellow-50 border border-yellow-200 p-3 rounded-md mb-4 flex items-start">
                          <XCircle className="w-5 h-5 text-yellow-600 mr-2 flex-shrink-0 mt-0.5" />
                          <p className="text-sm text-yellow-800">{conflictWarning}</p>
                        </div>
                      )}

                      <div className="grid grid-cols-3 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
                          <input type="date" required value={startDate} onChange={e => setStartDate(e.target.value)} className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Start Time</label>
                          <input type="time" required value={startTime} onChange={e => setStartTime(e.target.value)} className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700 mb-1">Duration (mins)</label>
                          <select value={duration} onChange={e => setDuration(Number(e.target.value))} className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                            <option value={30}>30 mins</option>
                            <option value={45}>45 mins</option>
                            <option value={60}>1 hour</option>
                            <option value={90}>1.5 hours</option>
                            <option value={120}>2 hours</option>
                          </select>
                        </div>
                      </div>
                      
                      {classType === ClassType.ONE_ON_ONE && (
                        <div className="flex justify-end">
                          <button 
                            type="button" 
                            onClick={findGap}
                            className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center"
                          >
                            <CalendarIcon className="w-4 h-4 mr-1" /> Find Next Available Gap
                          </button>
                        </div>
                      )}

                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Add Students</label>
                        <div className="max-h-32 overflow-y-auto border border-gray-200 rounded-md p-2 space-y-1">
                          {students.map(student => (
                            <label key={student.id} className="flex items-center p-2 hover:bg-gray-50 rounded cursor-pointer">
                              <input 
                                type="checkbox" 
                                checked={selectedStudentIds.includes(student.id)}
                                onChange={() => toggleStudent(student.id)}
                                className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded" 
                              />
                              <span className="ml-3 text-sm text-gray-700">{student.name}</span>
                            </label>
                          ))}
                          {students.length === 0 && <p className="text-sm text-gray-500 p-2">No students found.</p>}
                        </div>
                      </div>

                      <div className="border-t border-gray-200 pt-4">
                        <h4 className="text-sm font-medium text-gray-900 mb-3">Location & Resources</h4>
                        <div className="flex items-center space-x-6">
                          <label className="flex items-center">
                            <input type="radio" checked={!isOnline} onChange={() => setIsOnline(false)} className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300" />
                            <span className="ml-2 text-sm text-gray-700">In-Person</span>
                          </label>
                          <label className="flex items-center">
                            <input type="radio" checked={isOnline} onChange={() => setIsOnline(true)} className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300" />
                            <span className="ml-2 text-sm text-gray-700">Online</span>
                          </label>
                        </div>
                        <div className="mt-3">
                          {!isOnline ? (
                            <input type="text" placeholder="Room Number (e.g., Room 101)" value={roomNumber} onChange={e => setRoomNumber(e.target.value)} className="w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                          ) : (
                            <p className="text-sm text-gray-500 bg-gray-50 p-2 rounded border border-gray-200">A Google Meet link will be automatically generated.</p>
                          )}
                        </div>
                      </div>
                    </div>
                  )}
                </div>
                
                <div className="bg-gray-50 px-6 py-4 border-t border-gray-200 flex justify-between">
                  {step === 2 ? (
                    <button type="button" onClick={() => setStep(1)} className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                      Back
                    </button>
                  ) : (
                    <button type="button" onClick={closeModal} className="px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                      Cancel
                    </button>
                  )}
                  
                  <button type="submit" className="px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">
                    {step === 1 ? "Continue" : "Create Class"}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
