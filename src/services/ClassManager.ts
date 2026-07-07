import { db } from "../firebase";
import { 
  collection, 
  doc, 
  addDoc, 
  updateDoc, 
  getDoc, 
  getDocs, 
  query, 
  where, 
  runTransaction 
} from "firebase/firestore";

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
  
  static async enrollStudent(organizationId: string, studentId: string, templateId: string) {
    const templateRef = doc(db, "class_templates", templateId);
    const templateSnap = await getDoc(templateRef);
    
    if (!templateSnap.exists()) {
      throw new Error("Class template not found");
    }
    
    const template = templateSnap.data() as ClassTemplate;
    
    // Phase 5: Capacity Checks
    if (template.type === ClassType.BATCH) {
      const enrollmentsQuery = query(
        collection(db, "enrollments"), 
        where("templateId", "==", templateId),
        where("status", "==", "active")
      );
      const enrollmentsSnap = await getDocs(enrollmentsQuery);
      if (enrollmentsSnap.size >= template.capacity) {
        throw new Error(`Cannot enroll: ${template.type} is at max capacity (${template.capacity})`);
      }
    }
    
    // Create enrollment
    const enrollmentData: Enrollment = {
      organizationId,
      studentId,
      templateId,
      enrollmentDate: new Date().toISOString(),
      status: "active"
    };
    
    await addDoc(collection(db, "enrollments"), enrollmentData);
    
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

  static async createSession(sessionData: ClassSession) {
    // Phase 5: Conflict Detection
    const conflictsQuery = query(
      collection(db, "class_sessions"),
      where("tutorId", "==", sessionData.tutorId),
      where("status", "==", "scheduled"),
      where("startTime", "<", sessionData.endTime)
    );
    
    const existingSessions = await getDocs(conflictsQuery);
    const newStart = new Date(sessionData.startTime).getTime();
    const newEnd = new Date(sessionData.endTime).getTime();
    
    for (const docSnap of existingSessions.docs) {
      const existing = docSnap.data() as ClassSession;
      const exStart = new Date(existing.startTime).getTime();
      const exEnd = new Date(existing.endTime).getTime();
      
      // Check for overlap
      if (newStart < exEnd && newEnd > exStart) {
        throw new Error("Tutor has a conflicting session at this time.");
      }
    }
    
    const templateRef = doc(db, "class_templates", sessionData.templateId);
    const templateSnap = await getDoc(templateRef);
    if (templateSnap.exists()) {
      const template = templateSnap.data() as ClassTemplate;
      
      // For ONLINE_LIVE, trigger API call for meeting link (placeholder)
      if (sessionData.isOnline && !sessionData.meetingLink) {
        sessionData.meetingLink = `https://meet.google.com/placeholder-${Date.now()}`;
      }
    }
    
    return await addDoc(collection(db, "class_sessions"), sessionData);
  }

  // Phase 3: Scheduling Engine
  static async generateRecurringSessions(
    templateId: string, 
    organizationId: string, 
    tutorId: string, 
    startDate: Date, 
    endDate: Date, 
    dayOfWeek: number, // 0-6
    startHour: number,
    startMinute: number,
    durationMinutes: number
  ) {
    let currentDate = new Date(startDate);
    // Find first occurrence of dayOfWeek
    while (currentDate.getDay() !== dayOfWeek) {
      currentDate.setDate(currentDate.getDate() + 1);
    }
    
    const sessions = [];
    while (currentDate <= endDate) {
      const sessionStart = new Date(currentDate);
      sessionStart.setHours(startHour, startMinute, 0, 0);
      
      const sessionEnd = new Date(sessionStart);
      sessionEnd.setMinutes(sessionStart.getMinutes() + durationMinutes);
      
      const sessionData: ClassSession = {
        organizationId,
        templateId,
        tutorId,
        startTime: sessionStart.toISOString(),
        endTime: sessionEnd.toISOString(),
        status: "scheduled"
      };
      
      try {
        await this.createSession(sessionData);
        sessions.push(sessionData);
      } catch (e) {
        console.warn(`Skipped session on ${sessionStart.toISOString()} due to conflict`);
      }
      
      currentDate.setDate(currentDate.getDate() + 7);
    }
    return sessions;
  }

  // Phase 2 & 5: Atomicity for attendance
  static async markAttendance(sessionId: string, studentIds: string[]) {
    const sessionRef = doc(db, "class_sessions", sessionId);
    const sessionSnap = await getDoc(sessionRef);
    if (!sessionSnap.exists()) {
      throw new Error("Session does not exist!");
    }
    const session = sessionSnap.data() as ClassSession;

    const templateRef = doc(db, "class_templates", session.templateId);
    const templateSnap = await getDoc(templateRef);
    if (!templateSnap.exists()) {
      throw new Error("Class template does not exist!");
    }
    const template = templateSnap.data() as ClassTemplate;

    // Get wallet refs outside transaction
    const walletRefs: { studentId: string, ref: any }[] = [];
    if (template.pricingModel === PricingModel.PER_SESSION) {
      for (const studentId of studentIds) {
        const walletQuery = query(
          collection(db, "wallets"),
          where("studentId", "==", studentId),
          where("organizationId", "==", session.organizationId)
        );
        const walletSnap = await getDocs(walletQuery);
        if (!walletSnap.empty) {
          walletRefs.push({ studentId, ref: walletSnap.docs[0].ref });
        } else {
          throw new Error(`Wallet not found for student ${studentId}.`);
        }
      }
    }

    await runTransaction(db, async (transaction) => {
      // Read all documents first
      const sessionDoc = await transaction.get(sessionRef);
      if (!sessionDoc.exists()) {
        throw new Error("Session does not exist!");
      }

      const walletDocs = [];
      for (const { studentId, ref } of walletRefs) {
        const wDoc = await transaction.get(ref);
        walletDocs.push({ studentId, ref, data: wDoc.data() as Wallet });
      }

      // Perform updates
      for (const { studentId, ref, data } of walletDocs) {
        if (data.balanceCredits >= 1) {
          transaction.update(ref, { balanceCredits: data.balanceCredits - 1 });
        } else if (data.balanceCurrency >= template.feeAmount) {
          transaction.update(ref, { balanceCurrency: data.balanceCurrency - template.feeAmount });
        } else {
          // Generate an unpaid invoice instead of throwing an error
          const newInvoiceRef = doc(collection(db, "invoices"));
          transaction.set(newInvoiceRef, {
            organizationId: session.organizationId,
            tutorId: session.tutorId,
            studentId,
            totalAmount: template.feeAmount,
            subtotal: template.feeAmount,
            tax: 0,
            discount: 0,
            periodStart: new Date().toISOString().split('T')[0],
            periodEnd: new Date().toISOString().split('T')[0],
            dueDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0], // Due in 7 days
            status: "unpaid",
            items: [
              {
                description: `${template.type} - ${template.pricingModel} (Attendance)`,
                amount: template.feeAmount,
                quantity: 1
              }
            ],
            createdAt: new Date().toISOString()
          });
        }
      }

      // Mark session as completed
      transaction.update(sessionRef, { status: "completed" });
      
      // We would also save attendance records here
    });
  }
}
