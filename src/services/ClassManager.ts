import { db } from "../firebase";
import {
  collection,
  getDocs,
  query,
  where
} from "firebase/firestore";
import { api } from "../lib/api";

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

export interface Enrollment {
  id?: string;
  organizationId: string;
  studentId: string;
  templateId: string;
  enrollmentDate: string;
  status: "active" | "inactive" | "completed";
}

export interface Wallet {
  id?: string;
  organizationId: string;
  studentId: string;
  balanceCredits: number;
  balanceCurrency: number;
}

export interface TutorAvailability {
  id?: string;
  organizationId: string;
  tutorId: string;
  dayOfWeek: number; // 0-6
  startTime: string; // HH:mm
  endTime: string; // HH:mm
  isAvailable: boolean;
}

export class ClassManager {
  
  // Phase 2: Logic Injection by Class Type
  
  // Capacity is checked inside a server-side transaction (DEV_PLAN E3.6):
  // a client read-then-write here would let two parallel enrollments both
  // see "capacity OK" before either write lands.
  static async enrollStudent(_organizationId: string, studentId: string, templateId: string) {
    await api<{ ok: true; enrollmentId: string }>("/scheduling/enrollments", {
      method: "POST",
      body: { studentId, templateId },
    });
    return true;
  }

  static async bookOneOnOneSession(
    organizationId: string,
    studentId: string,
    tutorId: string,
    templateId: string,
    startTime: Date,
    durationMinutes: number
  ) {
    const dayOfWeek = startTime.getDay();
    const startHour = startTime.getHours().toString().padStart(2, '0');
    const startMinute = startTime.getMinutes().toString().padStart(2, '0');
    const timeString = `${startHour}:${startMinute}`;

    // 1. Check Tutor Availability
    const availabilityQuery = query(
      collection(db, "tutor_availability"),
      where("tutorId", "==", tutorId),
      where("dayOfWeek", "==", dayOfWeek),
      where("isAvailable", "==", true)
    );
    const availabilitySnap = await getDocs(availabilityQuery);
    
    let isAvailable = false;
    for (const docSnap of availabilitySnap.docs) {
      const slot = docSnap.data() as TutorAvailability;
      if (timeString >= slot.startTime && timeString < slot.endTime) {
        isAvailable = true;
        break;
      }
    }

    if (!isAvailable) {
      throw new Error("Tutor is not available at this time.");
    }

    // 2. Create Session (this will also check for conflicts)
    const endTime = new Date(startTime);
    endTime.setMinutes(endTime.getMinutes() + durationMinutes);

    const sessionData: ClassSession = {
      organizationId,
      templateId,
      tutorId,
      studentIds: [studentId],
      startTime: startTime.toISOString(),
      endTime: endTime.toISOString(),
      status: "scheduled"
    };

    return await this.createSession(sessionData);
  }

  // Conflict detection runs inside a server-side transaction (DEV_PLAN
  // E3.6): a client read-then-write here would let two parallel bookings
  // both see "no conflict" before either write lands.
  static async createSession(sessionData: ClassSession) {
    return await api<{ ok: true; sessionId: string }>("/scheduling/sessions", {
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
