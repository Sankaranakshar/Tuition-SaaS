import { isSameDay, isAfter, startOfDay, parseISO, format } from "date-fns";

export interface Student {
  id: string;
  status: string;
  organizationId?: string;
  tutorId?: string;
  name: string;
  [key: string]: any;
}

export interface Session {
  id: string;
  startTime: string;
  endTime: string;
  studentIds: string[];
  isOnline?: boolean;
  meetingLink?: string;
  [key: string]: any;
}

export interface Invoice {
  id: string;
  status: string;
  amount: number | string;
  dueDate?: string;
  createdAt?: string;
  [key: string]: any;
}

export interface Assessment {
  id: string;
  studentId: string;
  score: number | string;
  maxScore: number | string;
  [key: string]: any;
}

export function calculateStudentMetrics(students: Student[]) {
  return {
    totalStudents: students.length,
    activeStudents: students.filter((s) => s.status === 'active').length,
  };
}

export function calculateSessionMetrics(sessions: Session[], today: Date) {
  const classesToday = sessions.filter((s) => isSameDay(parseISO(s.startTime), today)).length;
  
  const upcomingClasses = sessions
    .filter((s) => isAfter(parseISO(s.startTime), startOfDay(today)) || isSameDay(parseISO(s.startTime), today))
    .sort((a, b) => new Date(a.startTime).getTime() - new Date(b.startTime).getTime())
    .slice(0, 5);

  return { classesToday, upcomingClasses };
}

export function calculateInvoiceMetrics(invoices: Invoice[]) {
  const pendingInvoiceAmount = invoices
    .filter((i) => i.status === 'pending')
    .reduce((sum, i) => sum + (Number(i.amount) || 0), 0);

  const paidInvoices = invoices.filter((i) => i.status === 'paid');
  const revenueByMonth: Record<string, number> = {};
  
  paidInvoices.forEach((inv) => {
    const dateStr = inv.dueDate || inv.createdAt;
    if (dateStr) {
      const date = parseISO(dateStr);
      const monthKey = format(date, 'yyyy-MM');
      revenueByMonth[monthKey] = (revenueByMonth[monthKey] || 0) + (Number(inv.amount) || 0);
    }
  });

  const monthlyRevenue = Object.entries(revenueByMonth)
    .map(([month, total]) => ({ month, total }))
    .sort((a, b) => a.month.localeCompare(b.month));

  return { pendingInvoiceAmount, monthlyRevenue };
}

export function calculateAssessmentMetrics(assessments: Assessment[]) {
  const studentAverages: Record<string, { totalScore: number, totalMax: number, count: number }> = {};
  
  assessments.forEach((a) => {
    if (!studentAverages[a.studentId]) {
      studentAverages[a.studentId] = { totalScore: 0, totalMax: 0, count: 0 };
    }
    studentAverages[a.studentId].totalScore += Number(a.score) || 0;
    studentAverages[a.studentId].totalMax += Number(a.maxScore) || 0;
    studentAverages[a.studentId].count += 1;
  });

  const studentPerformance = Object.entries(studentAverages).map(([studentId, stats]) => {
    const percentage = stats.totalMax > 0 ? Math.round((stats.totalScore / stats.totalMax) * 100) : 0;
    let status = 'green';
    if (percentage < 60) status = 'red';
    else if (percentage < 80) status = 'yellow';

    return {
      studentId,
      percentage,
      status,
      assessmentsCount: stats.count
    };
  }).sort((a, b) => a.percentage - b.percentage);

  return { studentPerformance };
}

