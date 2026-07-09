import express from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, withTransaction } from "../db.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";

// Capacity and double-booking checks used to run client-side (read-then-write
// from the browser SDK), which is a race: two parallel enrollments/bookings
// could both read "capacity OK" before either write landed. Both checks now
// run inside a real Postgres transaction on the server so only one wins —
// same guarantee the old Firestore db.runTransaction() gave, via row locks
// (enrollment capacity) and an advisory lock (session conflicts) instead.
const router = express.Router();
router.use(authenticateToken, requireOrg);

const CAN_SCHEDULE = ["owner", "admin", "tutor", "frontdesk"] as const;

const enrollSchema = z.object({
  studentId: z.string().uuid(),
  templateId: z.string().uuid(),
});

router.post("/enrollments", requireRole(...CAN_SCHEDULE), async (req: AuthRequest, res, next) => {
  try {
    const { studentId, templateId } = enrollSchema.parse(req.body);
    const orgId = req.user!.organizationId!;

    const enrollmentId = await withTransaction(async (client) => {
      // Row lock on the template serializes concurrent enrollment attempts
      // against it, so the capacity count read below is race-free.
      const templateRes = await client.query(
        `select organization_id, type, capacity from class_templates where id = $1 for update`,
        [templateId]
      );
      if (templateRes.rowCount === 0) {
        throw Object.assign(new Error("Class template not found"), { status: 404, code: "not_found" });
      }
      const template = templateRes.rows[0];
      if (template.organization_id !== orgId) {
        throw Object.assign(new Error("Template belongs to another organization"), { status: 403, code: "forbidden" });
      }

      if (template.type === "BATCH") {
        const countRes = await client.query(
          `select count(*)::int as n from enrollments where template_id = $1 and status = 'active'`,
          [templateId]
        );
        if (countRes.rows[0].n >= template.capacity) {
          throw Object.assign(
            new Error(`Cannot enroll: ${template.type} is at max capacity (${template.capacity})`),
            { status: 409, code: "capacity_full" }
          );
        }
      }

      const insertRes = await client.query(
        `insert into enrollments (organization_id, student_id, template_id, status)
         values ($1, $2, $3, 'active') returning id`,
        [orgId, studentId, templateId]
      );
      return insertRes.rows[0].id as string;
    });

    await writeAudit(orgId, req.user!.id, "enrollment.create", "enrollments", enrollmentId, { studentId, templateId });
    res.json({ ok: true, enrollmentId });
  } catch (err) { next(err); }
});

const sessionSchema = z.object({
  templateId: z.string().uuid(),
  tutorId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).optional(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  isOnline: z.boolean().optional(),
  roomNumber: z.string().optional(),
});

/**
 * class_sessions.student_ids holds student RECORD ids (what the booking UI
 * and staff views key off). RLS needs to match a logged-in student/parent's
 * auth uid instead, so student_user_ids/parent_user_ids are separate,
 * derived columns populated here at insert time — mirrors the three-array
 * shape the old Firestore docs used (studentIds/studentUserIds/parentUserIds)
 * rather than conflating record ids and auth ids into one column.
 */
async function resolveUserIds(
  client: PoolClient,
  studentIds: string[]
): Promise<{ studentUserIds: string[]; parentUserIds: string[] }> {
  if (studentIds.length === 0) return { studentUserIds: [], parentUserIds: [] };

  const studentsRes = await client.query(
    `select student_user_id from students where id = any($1::uuid[]) and student_user_id is not null`,
    [studentIds]
  );
  const parentsRes = await client.query(
    `select distinct parent_user_id from parent_links where student_id = any($1::uuid[])`,
    [studentIds]
  );
  return {
    studentUserIds: studentsRes.rows.map((r) => r.student_user_id as string),
    parentUserIds: parentsRes.rows.map((r) => r.parent_user_id as string),
  };
}

/** Range-overlap conflict check for a tutor, scoped by an advisory lock on (org, tutor). */
async function checkTutorConflictAndInsert(
  client: PoolClient,
  orgId: string,
  tutorId: string,
  startTime: string,
  endTime: string,
  insert: () => Promise<string>
): Promise<string> {
  // pg_advisory_xact_lock serializes all session-creation attempts for this
  // (org, tutor) pair and auto-releases at COMMIT/ROLLBACK — no manual unlock.
  await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${orgId}:${tutorId}`]);

  const windowStart = new Date(new Date(startTime).getTime() - 12 * 3600 * 1000).toISOString();
  const conflicts = await client.query(
    `select start_time, end_time from class_sessions
     where organization_id = $1 and tutor_id = $2 and status = 'scheduled'
       and start_time >= $3 and start_time < $4`,
    [orgId, tutorId, windowStart, endTime]
  );
  const newStart = new Date(startTime).getTime();
  const newEnd = new Date(endTime).getTime();
  for (const row of conflicts.rows) {
    const exStart = new Date(row.start_time).getTime();
    const exEnd = new Date(row.end_time).getTime();
    if (newStart < exEnd && newEnd > exStart) {
      throw Object.assign(new Error("Tutor has a conflicting session at this time."), { status: 409, code: "conflict" });
    }
  }
  return insert();
}

router.post("/sessions", requireRole(...CAN_SCHEDULE), async (req: AuthRequest, res, next) => {
  try {
    const body = sessionSchema.parse(req.body);
    const orgId = req.user!.organizationId!;

    const sessionId = await withTransaction((client) =>
      checkTutorConflictAndInsert(client, orgId, body.tutorId, body.startTime, body.endTime, async () => {
        const studentIds = body.studentIds || [];
        const { studentUserIds, parentUserIds } = await resolveUserIds(client, studentIds);
        // Meeting links are attached server-side via the Google Calendar
        // integration (Epic 8, deferred). Never fabricate one here.
        const insertRes = await client.query(
          `insert into class_sessions
             (organization_id, template_id, tutor_id, student_ids, student_user_ids, parent_user_ids, start_time, end_time, status, is_online, room_number)
           values ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9, $10)
           returning id`,
          [orgId, body.templateId, body.tutorId, studentIds, studentUserIds, parentUserIds, body.startTime, body.endTime, body.isOnline ?? false, body.roomNumber ?? null]
        );
        return insertRes.rows[0].id as string;
      })
    );

    res.json({ ok: true, sessionId });
  } catch (err) { next(err); }
});

// --- Session materialization (DEV_PLAN E3.7) -----------------------------
// The template is the source of truth for a recurring batch's schedule.
// Rather than bulk-generating months of sessions once at template creation
// (which goes stale the moment the template's schedule is edited), this
// keeps a rolling window of sessions materialized from the template, and
// is safe to call repeatedly: existing sessions are never duplicated (the
// `unique (template_id, materialized_date)` constraint replaces the old
// deterministic Firestore doc id) and conflicts are returned to the caller,
// never swallowed into a console.warn.
const WEEKS_AHEAD = 8;

interface Template {
  id: string;
  organization_id: string;
  type: string;
  tutor_id: string | null;
  student_ids: string[];
  days_of_week: number[];
  start_hour: number | null;
  start_minute: number;
  duration_minutes: number;
  is_online: boolean;
  room_number: string | null;
}

interface MaterializeResult {
  created: string[];
  conflicts: { templateId: string; date: string }[];
}

async function materializeTemplate(template: Template): Promise<MaterializeResult> {
  const result: MaterializeResult = { created: [], conflicts: [] };
  const daysOfWeek = template.days_of_week || [];
  if (template.type !== "BATCH" || daysOfWeek.length === 0 || template.start_hour == null || !template.tutor_id) return result;

  const durationMinutes = template.duration_minutes ?? 60;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + WEEKS_AHEAD * 7 * 24 * 3600 * 1000);

  for (let d = new Date(today); d <= horizon; d.setDate(d.getDate() + 1)) {
    if (!daysOfWeek.includes(d.getDay())) continue;

    const sessionStart = new Date(d);
    sessionStart.setHours(template.start_hour, template.start_minute ?? 0, 0, 0);
    if (sessionStart < new Date()) continue; // don't materialize into the past
    const sessionEnd = new Date(sessionStart.getTime() + durationMinutes * 60 * 1000);
    const dateKey = sessionStart.toISOString().split("T")[0];

    const outcome = await withTransaction(async (client) => {
      const existing = await client.query(
        `select 1 from class_sessions where template_id = $1 and materialized_date = $2`,
        [template.id, dateKey]
      );
      if ((existing.rowCount ?? 0) > 0) return "exists" as const;

      try {
        await checkTutorConflictAndInsert(
          client, template.organization_id, template.tutor_id!, sessionStart.toISOString(), sessionEnd.toISOString(),
          async () => {
            const studentIds = template.student_ids || [];
            const { studentUserIds, parentUserIds } = await resolveUserIds(client, studentIds);
            const insertRes = await client.query(
              `insert into class_sessions
                 (organization_id, template_id, tutor_id, student_ids, student_user_ids, parent_user_ids, start_time, end_time, status, is_online, room_number, materialized_date)
               values ($1, $2, $3, $4, $5, $6, $7, $8, 'scheduled', $9, $10, $11)
               returning id`,
              [template.organization_id, template.id, template.tutor_id, studentIds, studentUserIds, parentUserIds,
                sessionStart.toISOString(), sessionEnd.toISOString(), template.is_online ?? false, template.room_number ?? null, dateKey]
            );
            return insertRes.rows[0].id as string;
          }
        );
        return "created" as const;
      } catch (err: any) {
        if (err.code === "conflict") return "conflict" as const;
        throw err;
      }
    });

    if (outcome === "created") result.created.push(dateKey);
    if (outcome === "conflict") result.conflicts.push({ templateId: template.id, date: dateKey });
  }

  return result;
}

// Staff-triggered: materialize the caller's org only. Useful right after
// creating/editing a template so the calendar fills in immediately.
router.post("/materialize", requireRole(...CAN_SCHEDULE), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const templatesRes = await pool.query(
      `select id, organization_id, type, tutor_id, student_ids, days_of_week, start_hour, start_minute, duration_minutes, is_online, room_number
       from class_templates where organization_id = $1`,
      [orgId]
    );

    const aggregate: MaterializeResult = { created: [], conflicts: [] };
    for (const row of templatesRes.rows as Template[]) {
      const r = await materializeTemplate(row);
      aggregate.created.push(...r.created);
      aggregate.conflicts.push(...r.conflicts);
    }
    res.json({ ok: true, ...aggregate });
  } catch (err) { next(err); }
});

export { materializeTemplate, type Template };
export default router;
