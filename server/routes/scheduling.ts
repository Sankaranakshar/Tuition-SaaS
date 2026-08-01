import express from "express";
import type { PoolClient } from "pg";
import { pool, withTransaction } from "../db.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";
import {
  enrollRequestSchema as enrollSchema,
  createSessionRequestSchema as sessionSchema,
  rescheduleSessionRequestSchema as rescheduleSchema,
  updateTemplateScopeSchema as templateScopeSchema,
  findGapsQuerySchema as gapsQuerySchema,
} from "../../shared/schemas/scheduling.ts";

// Capacity and double-booking checks used to run client-side (read-then-write
// from the browser SDK), which is a race: two parallel enrollments/bookings
// could both read "capacity OK" before either write landed. Both checks now
// run inside a real Postgres transaction on the server so only one wins —
// same guarantee the old Firestore db.runTransaction() gave, via row locks
// (enrollment capacity) and an advisory lock (session conflicts) instead.
const router = express.Router();
router.use(authenticateToken, requireOrg);

const CAN_SCHEDULE = ["owner", "admin", "tutor", "frontdesk"] as const;

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

  // One round trip, not two: this runs inside every session insert (and once
  // per template on the materialize sweep), and a PoolClient can't pipeline
  // two awaits anyway — they would serialize.
  const { rows } = await client.query(
    `select 'student' as kind, student_user_id as user_id
       from students where id = any($1::uuid[]) and student_user_id is not null
     union
     select 'parent', parent_user_id
       from parent_links where student_id = any($1::uuid[])`,
    [studentIds]
  );
  return {
    studentUserIds: rows.filter((r) => r.kind === "student").map((r) => r.user_id as string),
    parentUserIds: rows.filter((r) => r.kind === "parent").map((r) => r.user_id as string),
  };
}

/** Serializes all session-creation attempts for one (org, tutor) pair.
 *  pg_advisory_xact_lock auto-releases at COMMIT/ROLLBACK — no manual unlock. */
async function lockTutorSchedule(client: PoolClient, orgId: string, tutorId: string): Promise<void> {
  await client.query(`select pg_advisory_xact_lock(hashtextextended($1, 0))`, [`${orgId}:${tutorId}`]);
}

/**
 * Range-overlap conflict check for a tutor, scoped by an advisory lock on
 * (org, tutor). `excludeSessionId` lets a reschedule of an existing session
 * re-check against every *other* session without tripping over itself.
 *
 * The overlap test is a SQL predicate with `limit 1` rather than the previous
 * "pull every session starting within 12h and compare in JS". That reads one
 * row instead of a day's worth, and it also closes a real gap: the old
 * 12-hour lookback silently missed an existing session that started more than
 * 12h before the new one but ran past its start (a long workshop block), so
 * two overlapping sessions could both be accepted.
 */
async function assertNoTutorConflict(
  client: PoolClient,
  orgId: string,
  tutorId: string,
  startTime: string,
  endTime: string,
  excludeSessionId?: string
): Promise<void> {
  const conflict = await client.query(
    `select 1 from class_sessions
     where organization_id = $1 and tutor_id = $2 and status = 'scheduled'
       and start_time < $4::timestamptz and end_time > $3::timestamptz
       and ($5::uuid is null or id <> $5::uuid)
     limit 1`,
    [orgId, tutorId, startTime, endTime, excludeSessionId ?? null]
  );
  if (conflict.rowCount) {
    throw Object.assign(new Error("Tutor has a conflicting session at this time."), { status: 409, code: "conflict" });
  }
}

async function checkTutorConflictAndInsert(
  client: PoolClient,
  orgId: string,
  tutorId: string,
  startTime: string,
  endTime: string,
  insert: () => Promise<string>,
  excludeSessionId?: string
): Promise<string> {
  await lockTutorSchedule(client, orgId, tutorId);
  await assertNoTutorConflict(client, orgId, tutorId, startTime, endTime, excludeSessionId);
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

// Single-session reschedule (drag-move/resize on the Schedule workspace).
// Previously the client wrote start_time/end_time directly via the
// class_sessions_update RLS policy, which has no conflict awareness at all —
// two staff dragging sessions concurrently, or one drag onto an occupied
// slot, would both silently succeed. This route runs the same advisory-lock
// + range-overlap check used at creation, just excluding the row itself.
router.patch("/sessions/:id", requireRole(...CAN_SCHEDULE), async (req: AuthRequest, res, next) => {
  try {
    const body = rescheduleSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const sessionId = req.params.id;

    await withTransaction(async (client) => {
      const existing = await client.query(
        `select organization_id, tutor_id, status from class_sessions where id = $1`,
        [sessionId]
      );
      if (existing.rowCount === 0) {
        throw Object.assign(new Error("Session not found"), { status: 404, code: "not_found" });
      }
      const row = existing.rows[0];
      if (row.organization_id !== orgId) {
        throw Object.assign(new Error("Session belongs to another organization"), { status: 403, code: "forbidden" });
      }
      if (row.status === "completed") {
        throw Object.assign(new Error("Cannot reschedule a completed session"), { status: 409, code: "already_completed" });
      }

      await checkTutorConflictAndInsert(
        client, orgId, row.tutor_id, body.startTime, body.endTime,
        async () => {
          await client.query(
            `update class_sessions set start_time = $1, end_time = $2, updated_at = now() where id = $3`,
            [body.startTime, body.endTime, sessionId]
          );
          return sessionId;
        },
        sessionId
      );
    });

    await writeAudit(orgId, req.user!.id, "session.reschedule", "class_sessions", sessionId, { startTime: body.startTime, endTime: body.endTime });
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

/** Column list materializeTemplate needs, shared by the three call sites. */
const TEMPLATE_SELECT = `select id, organization_id, type, tutor_id, student_ids, days_of_week,
    start_hour, start_minute, duration_minutes, is_online, room_number
  from class_templates`;

/** The same guard materializeTemplate applies on entry, pushed into SQL so
 *  the sweep doesn't ship rows it will immediately discard — on the platform
 *  cron that is every one-to-one template in every org. */
const MATERIALIZABLE = `type = 'BATCH' and tutor_id is not null and start_hour is not null
  and coalesce(array_length(days_of_week, 1), 0) > 0`;

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

/** `YYYY-MM-DD` in local time. Deliberately not toISOString().split("T")[0],
 *  which shifts the date across the UTC boundary for evening sessions in
 *  positive-offset zones (IST, this app's primary market). */
function localDateKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/**
 * One transaction per template, not one per candidate day. The previous
 * shape opened a fresh pool checkout + BEGIN/COMMIT for every date in the
 * 8-week horizon — roughly 25 transactions and 100 round trips per template,
 * multiplied by every template in every org on the nightly cron sweep, all
 * strictly serial against a 3-connection pool. That is what made the sweep
 * scale with (templates x days) instead of (templates).
 *
 * Now: take the advisory lock once, read the already-materialized dates and
 * the tutor's existing bookings in the window in one query each, decide every
 * slot in memory, and write the survivors in a single multi-row INSERT.
 *
 * Two consequences worth knowing:
 *   - Slots accepted earlier in this run are appended to `busy`, so a
 *     template that would double-book itself still self-conflicts exactly as
 *     it did when each day committed before the next was checked.
 *   - A template's window is now all-or-nothing rather than partially
 *     committed on failure. The operation is idempotent, so a retry converges.
 */
async function materializeTemplate(template: Template): Promise<MaterializeResult> {
  const result: MaterializeResult = { created: [], conflicts: [] };
  const daysOfWeek = template.days_of_week || [];
  if (template.type !== "BATCH" || daysOfWeek.length === 0 || template.start_hour == null || !template.tutor_id) return result;

  const durationMinutes = template.duration_minutes ?? 60;
  const now = new Date();
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const horizon = new Date(today.getTime() + WEEKS_AHEAD * 7 * 24 * 3600 * 1000);

  const candidates: { dateKey: string; start: Date; end: Date }[] = [];
  for (let d = new Date(today); d <= horizon; d.setDate(d.getDate() + 1)) {
    if (!daysOfWeek.includes(d.getDay())) continue;

    const start = new Date(d);
    start.setHours(template.start_hour, template.start_minute ?? 0, 0, 0);
    if (start < now) continue; // don't materialize into the past
    candidates.push({
      dateKey: localDateKey(start),
      start,
      end: new Date(start.getTime() + durationMinutes * 60 * 1000),
    });
  }
  if (candidates.length === 0) return result;

  const orgId = template.organization_id;
  const tutorId = template.tutor_id;
  const windowStart = candidates[0].start.toISOString();
  const windowEnd = candidates[candidates.length - 1].end.toISOString();

  return withTransaction(async (client) => {
    await lockTutorSchedule(client, orgId, tutorId);

    // materialized_date is a `date`; format it in SQL so the comparison key
    // never round-trips through a timezone-sensitive JS Date.
    const existingRes = await client.query(
      `select to_char(materialized_date, 'YYYY-MM-DD') as date_key
       from class_sessions
       where template_id = $1 and materialized_date = any($2::date[])`,
      [template.id, candidates.map((c) => c.dateKey)]
    );
    const alreadyMaterialized = new Set(existingRes.rows.map((r) => r.date_key as string));

    const busyRes = await client.query(
      `select start_time, end_time from class_sessions
       where organization_id = $1 and tutor_id = $2 and status = 'scheduled'
         and start_time < $4::timestamptz and end_time > $3::timestamptz`,
      [orgId, tutorId, windowStart, windowEnd]
    );
    const busy = busyRes.rows.map((r) => ({
      start: new Date(r.start_time).getTime(),
      end: new Date(r.end_time).getTime(),
    }));

    const toInsert: { dateKey: string; start: Date; end: Date }[] = [];
    for (const c of candidates) {
      if (alreadyMaterialized.has(c.dateKey)) continue;
      const start = c.start.getTime();
      const end = c.end.getTime();
      if (busy.some((b) => start < b.end && end > b.start)) {
        result.conflicts.push({ templateId: template.id, date: c.dateKey });
        continue;
      }
      busy.push({ start, end });
      toInsert.push(c);
    }
    if (toInsert.length === 0) return result;

    const studentIds = template.student_ids || [];
    const { studentUserIds, parentUserIds } = await resolveUserIds(client, studentIds);

    // `on conflict do nothing` on unique (template_id, materialized_date) is
    // belt-and-braces: the advisory lock already excludes a concurrent sweep
    // for this tutor, but the constraint is the real guarantee, and RETURNING
    // then reports only the rows this call actually created.
    const insertRes = await client.query(
      `insert into class_sessions
         (organization_id, template_id, tutor_id, student_ids, student_user_ids, parent_user_ids,
          start_time, end_time, status, is_online, room_number, materialized_date)
       select $1, $2, $3, $4::uuid[], $5::uuid[], $6::uuid[],
              v.start_time, v.end_time, 'scheduled', $7, $8, v.materialized_date
       from unnest($9::timestamptz[], $10::timestamptz[], $11::date[])
            as v(start_time, end_time, materialized_date)
       on conflict (template_id, materialized_date) do nothing
       returning to_char(materialized_date, 'YYYY-MM-DD') as date_key`,
      [
        orgId, template.id, tutorId, studentIds, studentUserIds, parentUserIds,
        template.is_online ?? false, template.room_number ?? null,
        toInsert.map((c) => c.start.toISOString()),
        toInsert.map((c) => c.end.toISOString()),
        toInsert.map((c) => c.dateKey),
      ]
    );
    result.created.push(...insertRes.rows.map((r) => r.date_key as string));
    return result;
  });
}

// Staff-triggered: materialize the caller's org only. Useful right after
// creating/editing a template so the calendar fills in immediately.
router.post("/materialize", requireRole(...CAN_SCHEDULE), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const templatesRes = await pool.query(
      `${TEMPLATE_SELECT} where organization_id = $1 and ${MATERIALIZABLE}`,
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

// Recurring-edit scope: "this and future" and "all" both resolve to the same
// operation — update the template, then drop every not-yet-completed,
// not-cancelled materialized session and rematerialize through the same
// conflict-checked path a fresh template would use. Genuinely retroactive
// "all" (touching completed sessions) isn't offered — those are historical
// record and class_sessions_update's RLS already blocks that write anyway.
router.patch("/templates/:id", requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    const body = templateScopeSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const templateId = req.params.id;

    const templateRes = await pool.query(`${TEMPLATE_SELECT} where id = $1`, [templateId]);
    if (templateRes.rowCount === 0) {
      throw Object.assign(new Error("Class template not found"), { status: 404, code: "not_found" });
    }
    const existing = templateRes.rows[0] as Template;
    if (existing.organization_id !== orgId) {
      throw Object.assign(new Error("Template belongs to another organization"), { status: 403, code: "forbidden" });
    }

    const updateRes = await pool.query(
      `update class_templates set
         days_of_week = coalesce($1, days_of_week),
         start_hour = coalesce($2, start_hour),
         start_minute = coalesce($3, start_minute),
         duration_minutes = coalesce($4, duration_minutes)
       where id = $5
       returning id, organization_id, type, tutor_id, student_ids, days_of_week, start_hour, start_minute, duration_minutes, is_online, room_number`,
      [body.daysOfWeek ?? null, body.startHour ?? null, body.startMinute ?? null, body.durationMinutes ?? null, templateId]
    );
    const updated = updateRes.rows[0] as Template;

    // Drop future, still-scheduled sessions for this template so
    // materializeTemplate can lay down fresh, conflict-checked ones at the
    // new days/time — a plain UPDATE of start_time/end_time in place would
    // skip the conflict check entirely.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    await pool.query(
      `delete from class_sessions
       where template_id = $1 and status = 'scheduled' and materialized_date >= $2`,
      [templateId, localDateKey(today)]
    );

    const result = await materializeTemplate(updated);
    await writeAudit(orgId, req.user!.id, "template.update_scope", "class_templates", templateId, { scope: body.scope, ...result });
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

// "Find a gap": scan the tutor's declared availability against their
// existing sessions over the next 14 days and return open slots of the
// requested duration. Read-only — no writes, no conflict lock needed.
router.get("/gaps", requireRole(...CAN_SCHEDULE), async (req: AuthRequest, res, next) => {
  try {
    const query = gapsQuerySchema.parse(req.query);
    const orgId = req.user!.organizationId!;
    const LOOKAHEAD_DAYS = 14;
    const MAX_SLOTS = 10;

    const availabilityRes = await pool.query(
      `select day_of_week, start_time, end_time from tutor_availability
       where organization_id = $1 and tutor_id = $2`,
      [orgId, query.tutorId]
    );
    if (availabilityRes.rowCount === 0) {
      return res.json({ ok: true, slots: [] });
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const horizon = new Date(today.getTime() + LOOKAHEAD_DAYS * 24 * 3600 * 1000);

    const sessionsRes = await pool.query(
      `select start_time, end_time from class_sessions
       where organization_id = $1 and tutor_id = $2 and status = 'scheduled'
         and start_time >= $3 and start_time < $4`,
      [orgId, query.tutorId, today.toISOString(), horizon.toISOString()]
    );
    const busy = sessionsRes.rows.map((r) => ({ start: new Date(r.start_time).getTime(), end: new Date(r.end_time).getTime() }));

    const durationMs = query.durationMinutes * 60 * 1000;
    const slots: { start: string; end: string }[] = [];
    const now = Date.now();

    for (let d = new Date(today); d <= horizon && slots.length < MAX_SLOTS; d.setDate(d.getDate() + 1)) {
      const dayAvailability = availabilityRes.rows.filter((a) => a.day_of_week === d.getDay());
      for (const window of dayAvailability) {
        if (slots.length >= MAX_SLOTS) break;
        const [startH, startM] = String(window.start_time).split(":").map(Number);
        const [endH, endM] = String(window.end_time).split(":").map(Number);
        const windowStart = new Date(d);
        windowStart.setHours(startH, startM, 0, 0);
        const windowEnd = new Date(d);
        windowEnd.setHours(endH, endM, 0, 0);

        // 15-minute step across the availability window looking for a gap
        // of at least durationMinutes that doesn't overlap any busy session.
        for (let cursor = windowStart.getTime(); cursor + durationMs <= windowEnd.getTime(); cursor += 15 * 60 * 1000) {
          if (cursor < now) continue;
          const slotEnd = cursor + durationMs;
          const overlaps = busy.some((b) => cursor < b.end && slotEnd > b.start);
          if (!overlaps) {
            slots.push({ start: new Date(cursor).toISOString(), end: new Date(slotEnd).toISOString() });
            if (slots.length >= MAX_SLOTS) break;
          }
        }
      }
    }

    res.json({ ok: true, slots });
  } catch (err) { next(err); }
});

export { materializeTemplate, TEMPLATE_SELECT, MATERIALIZABLE, type Template };
export default router;
