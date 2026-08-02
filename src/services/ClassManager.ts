import { api } from "../lib/api";
import type { EnrollResponse, CreateSessionResponse } from "../../shared/schemas/scheduling";

export enum ClassType {
  BATCH = "BATCH",
  ONE_ON_ONE = "ONE_ON_ONE",
  CRASH_COURSE = "CRASH_COURSE",
  WORKSHOP = "WORKSHOP"
}

export enum PricingModel {
  MONTHLY = "MONTHLY",
  PER_SESSION = "PER_SESSION",
  PACKAGE = "PACKAGE",
  FLAT_FEE = "FLAT_FEE"
}

export interface ClassTemplate {
  id?: string;
  organizationId: string;
  courseId: string;
  tutorId: string;
  type: ClassType;
  pricingModel: PricingModel;
  feeAmount: number;
  capacity: number;
  recurringPattern?: string; // e.g., "Mon,Wed,Fri"
  metadata?: any;
}

export interface ClassSession {
  id?: string;
  organizationId: string;
  templateId: string;
  tutorId: string;
  studentIds?: string[];
  startTime: string;
  endTime: string;
  status: "scheduled" | "completed" | "cancelled" | "no_show";
  isOnline?: boolean;
  meetingLink?: string;
  roomNumber?: string;
}

export class ClassManager {
  
  // Phase 2: Logic Injection by Class Type
  
  // Capacity is checked inside a server-side transaction (DEV_PLAN E3.6):
  // a client read-then-write here would let two parallel enrollments both
  // see "capacity OK" before either write lands.
  static async enrollStudent(_organizationId: string, studentId: string, templateId: string) {
    await api<EnrollResponse>("/scheduling/enrollments", {
      method: "POST",
      body: { studentId, templateId },
    });
    return true;
  }

  // Conflict detection runs inside a server-side transaction (DEV_PLAN
  // E3.6): a client read-then-write here would let two parallel bookings
  // both see "no conflict" before either write lands.
  static async createSession(sessionData: ClassSession) {
    return await api<CreateSessionResponse>("/scheduling/sessions", {
      method: "POST",
      body: {
        templateId: sessionData.templateId,
        tutorId: sessionData.tutorId,
        studentIds: sessionData.studentIds,
        startTime: sessionData.startTime,
        endTime: sessionData.endTime,
        isOnline: sessionData.isOnline,
        roomNumber: sessionData.roomNumber,
      },
    });
  }

  // Recurring session generation is server-side now (DEV_PLAN E3.7): see
  // POST /api/v1/scheduling/materialize and server/routes/scheduling.ts's
  // materializeTemplate(). The template's persisted schedule fields
  // (daysOfWeek/startHour/startMinute/durationMinutes) are the source of
  // truth; this class no longer bulk-generates sessions client-side.

  // Attendance + billing moved server-side: see src/lib/api.ts markAttendance()
  // and server/routes/billing.ts. Client-side wallet mutation is forbidden by rules.
}
