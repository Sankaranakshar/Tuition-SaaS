import express from "express";
import { z } from "zod";
import { adminDb } from "../firebaseAdmin.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";

// Capacity and double-booking checks used to run client-side (read-then-write
// from the browser SDK), which is a race: two parallel enrollments/bookings
// could both read "capacity OK" before either write landed. Both checks now
// run inside a Firestore transaction on the server so only one wins.
const router = express.Router();
router.use(authenticateToken, requireOrg);

const CAN_SCHEDULE = ["owner", "admin", "tutor", "frontdesk"] as const;

const enrollSchema = z.object({
  studentId: z.string().min(1),
  templateId: z.string().min(1),
});

router.post("/enrollments", requireRole(...CAN_SCHEDULE), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const { studentId, templateId } = enrollSchema.parse(req.body);
    const orgId = req.user!.organizationId!;

    const templateRef = db.collection("class_templates").doc(templateId);

    const enrollmentRef = await db.runTransaction(async (tx) => {
      const templateSnap = await tx.get(templateRef);
      if (!templateSnap.exists) {
        throw Object.assign(new Error("Class template not found"), { status: 404, code: "not_found" });
      }
      const template = templateSnap.data()!;
      if (template.organizationId !== orgId) {
        throw Object.assign(new Error("Template belongs to another organization"), { status: 403, code: "forbidden" });
      }

      if (template.type === "BATCH") {
        // Bounded by capacity, which is always a small integer, so
        // fetching the count inside the transaction stays cheap.
        const enrollmentsSnap = await tx.get(
          db.collection("enrollments")
            .where("templateId", "==", templateId)
            .where("status", "==", "active")
        );
        if (enrollmentsSnap.size >= template.capacity) {
          throw Object.assign(
            new Error(`Cannot enroll: ${template.type} is at max capacity (${template.capacity})`),
            { status: 409, code: "capacity_full" }
          );
        }
      }

      const ref = db.collection("enrollments").doc();
      tx.set(ref, {
        organizationId: orgId,
        studentId,
        templateId,
        enrollmentDate: new Date().toISOString(),
        status: "active",
      });
      return ref;
    });

    await writeAudit(orgId, req.user!.id, "enrollment.create", "enrollments", enrollmentRef.id, { studentId, templateId });
    res.json({ ok: true, enrollmentId: enrollmentRef.id });
  } catch (err) { next(err); }
});

const sessionSchema = z.object({
  templateId: z.string().min(1),
  tutorId: z.string().min(1),
  studentIds: z.array(z.string().min(1)).optional(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  isOnline: z.boolean().optional(),
  roomNumber: z.string().optional(),
});

router.post("/sessions", requireRole(...CAN_SCHEDULE), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const body = sessionSchema.parse(req.body);
    const orgId = req.user!.organizationId!;

    const sessionRef = await db.runTransaction(async (tx) => {
      // Conflict window is bounded (no session exceeds 12h), so this read
      // stays flat-cost regardless of tutor history size.
      const windowStart = new Date(new Date(body.startTime).getTime() - 12 * 3600 * 1000).toISOString();
      const conflictsSnap = await tx.get(
        db.collection("class_sessions")
          .where("organizationId", "==", orgId)
          .where("tutorId", "==", body.tutorId)
          .where("status", "==", "scheduled")
          .where("startTime", ">=", windowStart)
          .where("startTime", "<", body.endTime)
      );

      const newStart = new Date(body.startTime).getTime();
      const newEnd = new Date(body.endTime).getTime();
      for (const docSnap of conflictsSnap.docs) {
        const existing = docSnap.data();
        const exStart = new Date(existing.startTime).getTime();
        const exEnd = new Date(existing.endTime).getTime();
        if (newStart < exEnd && newEnd > exStart) {
          throw Object.assign(new Error("Tutor has a conflicting session at this time."), { status: 409, code: "conflict" });
        }
      }

      // Meeting links are attached server-side via the Google Calendar
      // integration (Epic 8, deferred). Never fabricate one here.
      const ref = db.collection("class_sessions").doc();
      tx.set(ref, {
        organizationId: orgId,
        templateId: body.templateId,
        tutorId: body.tutorId,
        studentIds: body.studentIds || [],
        startTime: body.startTime,
        endTime: body.endTime,
        status: "scheduled",
        isOnline: body.isOnline ?? false,
        roomNumber: body.roomNumber ?? null,
      });
      return ref;
    });

    res.json({ ok: true, sessionId: sessionRef.id });
  } catch (err) { next(err); }
});

// --- Session materialization (DEV_PLAN E3.7) -----------------------------
// The template is the source of truth for a recurring batch's schedule.
// Rather than bulk-generating months of sessions once at template creation
// (which goes stale the moment the template's schedule is edited), this
// keeps a rolling window of sessions materialized from the template, and
// is safe to call repeatedly: existing sessions are never duplicated
// (deterministic per-template-per-date IDs) and conflicts are returned to
// the caller, never swallowed into a console.warn.
const WEEKS_AHEAD = 8;

interface MaterializeResult {
  created: string[];
  conflicts: { templateId: string; date: string }[];
}

async function materializeTemplate(
  db: FirebaseFirestore.Firestore,
  templateId: string,
  template: FirebaseFirestore.DocumentData
): Promise<MaterializeResult> {
  const result: MaterializeResult = { created: [], conflicts: [] };
  const daysOfWeek: number[] = Array.isArray(template.daysOfWeek) ? template.daysOfWeek : [];
  if (template.type !== "BATCH" || daysOfWeek.length === 0 || template.startHour == null) return result;

  const durationMinutes = template.durationMinutes ?? 60;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + WEEKS_AHEAD * 7 * 24 * 3600 * 1000);

  for (let d = new Date(today); d <= horizon; d.setDate(d.getDate() + 1)) {
    if (!daysOfWeek.includes(d.getDay())) continue;

    const sessionStart = new Date(d);
    sessionStart.setHours(template.startHour, template.startMinute ?? 0, 0, 0);
    if (sessionStart < new Date()) continue; // don't materialize into the past
    const sessionEnd = new Date(sessionStart.getTime() + durationMinutes * 60 * 1000);
    const dateKey = sessionStart.toISOString().split("T")[0];
    const sessionRef = db.collection("class_sessions").doc(`${templateId}_${dateKey}`);

    const outcome = await db.runTransaction(async (tx) => {
      const existing = await tx.get(sessionRef);
      if (existing.exists) return "exists" as const;

      const windowStart = new Date(sessionStart.getTime() - 12 * 3600 * 1000).toISOString();
      const conflictsSnap = await tx.get(
        db.collection("class_sessions")
          .where("organizationId", "==", template.organizationId)
          .where("tutorId", "==", template.tutorId)
          .where("status", "==", "scheduled")
          .where("startTime", ">=", windowStart)
          .where("startTime", "<", sessionEnd.toISOString())
      );
      const newStart = sessionStart.getTime();
      const newEnd = sessionEnd.getTime();
      for (const docSnap of conflictsSnap.docs) {
        const existingSession = docSnap.data();
        const exStart = new Date(existingSession.startTime).getTime();
        const exEnd = new Date(existingSession.endTime).getTime();
        if (newStart < exEnd && newEnd > exStart) return "conflict" as const;
      }

      tx.set(sessionRef, {
        organizationId: template.organizationId,
        templateId,
        tutorId: template.tutorId,
        studentIds: template.studentIds || [],
        startTime: sessionStart.toISOString(),
        endTime: sessionEnd.toISOString(),
        status: "scheduled",
        isOnline: template.isOnline ?? false,
        roomNumber: template.roomNumber ?? null,
      });
      return "created" as const;
    });

    if (outcome === "created") result.created.push(dateKey);
    if (outcome === "conflict") result.conflicts.push({ templateId, date: dateKey });
  }

  return result;
}

// Staff-triggered: materialize the caller's org only. Useful right after
// creating/editing a template so the calendar fills in immediately.
router.post("/materialize", requireRole(...CAN_SCHEDULE), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const orgId = req.user!.organizationId!;
    const templatesSnap = await db.collection("class_templates").where("organizationId", "==", orgId).get();

    const aggregate: MaterializeResult = { created: [], conflicts: [] };
    for (const templateDoc of templatesSnap.docs) {
      const r = await materializeTemplate(db, templateDoc.id, templateDoc.data());
      aggregate.created.push(...r.created);
      aggregate.conflicts.push(...r.conflicts);
    }
    res.json({ ok: true, ...aggregate });
  } catch (err) { next(err); }
});

export { materializeTemplate };
export default router;
