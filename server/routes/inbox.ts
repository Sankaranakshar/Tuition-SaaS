import express from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { pool, withTransaction } from "../db.ts";
import { authenticateToken, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { ensureClassChannelResponseSchema, tutorContactsResponseSchema } from "../../shared/schemas/inbox.ts";

// Inbox workspace (DEV_PLAN §2a Stage 2 item 4, REDESIGN §6.5). Every Inbox
// write except this one is a direct client insert/update under RLS (send
// message, archive/snooze via inbox_state, mark notification read,
// assign/grade homework via assessments) — same posture as the Messaging.tsx
// page this replaces. Class channels are the exception: resolving a batch's
// current roster into auth-uid participants requires the same
// student/parent-link lookup scheduling.ts's resolveUserIds() does, which
// needs server-side table access no client policy grants.
const router = express.Router();
router.use(authenticateToken, requireOrg);

const templateIdParamSchema = z.object({ templateId: z.string().uuid() });

/** Same shape as scheduling.ts's private resolveUserIds(), applied to a template's active roster instead of an explicit student id list. */
async function resolveClassParticipantIds(
  client: PoolClient,
  orgId: string,
  templateId: string
): Promise<{ tutorId: string | null; studentUserIds: string[]; parentUserIds: string[] }> {
  const templateRes = await client.query(
    `select tutor_id from class_templates where id = $1 and organization_id = $2`,
    [templateId, orgId]
  );
  if (templateRes.rowCount === 0) {
    throw Object.assign(new Error("Class not found"), { status: 404, code: "not_found" });
  }
  const tutorId = templateRes.rows[0].tutor_id as string | null;

  const rosterRes = await client.query(
    `select student_id from enrollments where template_id = $1 and status = 'active'`,
    [templateId]
  );
  const studentIds = rosterRes.rows.map((r) => r.student_id as string);
  if (studentIds.length === 0) return { tutorId, studentUserIds: [], parentUserIds: [] };

  // One round trip for both id spaces, matching scheduling.ts's resolveUserIds.
  const { rows } = await client.query(
    `select 'student' as kind, student_user_id as user_id
       from students where id = any($1::uuid[]) and student_user_id is not null
     union
     select 'parent', parent_user_id
       from parent_links where student_id = any($1::uuid[])`,
    [studentIds]
  );
  return {
    tutorId,
    studentUserIds: rows.filter((r) => r.kind === "student").map((r) => r.user_id as string),
    parentUserIds: rows.filter((r) => r.kind === "parent").map((r) => r.user_id as string),
  };
}

router.post("/class-channels/:templateId/ensure", async (req: AuthRequest, res, next) => {
  try {
    const { templateId } = templateIdParamSchema.parse(req.params);
    const orgId = req.user!.organizationId!;

    const result = await withTransaction(async (client) => {
      const { tutorId, studentUserIds, parentUserIds } = await resolveClassParticipantIds(client, orgId, templateId);
      const participantIds = Array.from(new Set([...(tutorId ? [tutorId] : []), ...studentUserIds, ...parentUserIds]));

      // conversations_class_channel_idx (unique on org+anchor_id where kind =
      // 'class_channel') makes this idempotent: re-running just refreshes the
      // roster for a channel that already exists, rather than duplicating it.
      const upsertRes = await client.query(
        `insert into conversations (organization_id, participant_ids, kind, anchor_type, anchor_id)
         values ($1, $2, 'class_channel', 'class', $3)
         on conflict (organization_id, anchor_id) where kind = 'class_channel'
         do update set participant_ids = excluded.participant_ids
         returning id`,
        [orgId, participantIds, templateId]
      );
      return { conversationId: upsertRes.rows[0].id as string, participantCount: participantIds.length };
    });

    res.json(ensureClassChannelResponseSchema.parse({ ok: true, ...result }));
  } catch (err) { next(err); }
});

// D-06 follow-up (EXECUTION_PLAN.md Step 30): parents can read their child's
// tutor-student threads but not reply in them, so they need their own way to
// reach the tutor. Returns the teaching staff of each child the caller is a
// linked parent of: the student's assigned tutor, the tutor of any class
// they're actively enrolled in, and the tutor of any recent or upcoming
// session they're on. Anyone who isn't a linked parent gets an empty list.
// Only current owner/admin/tutor members are returned, so a tutor who has
// left the org drops out.
router.get("/tutor-contacts", async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const { rows } = await pool.query(
      `with kids as (
         select s.id, s.name, s.tutor_id
           from parent_links pl
           join students s on s.id = pl.student_id
          where pl.parent_user_id = $1 and pl.organization_id = $2
            and s.organization_id = $2 and not s.is_deleted
       ),
       teaching as (
         select k.id as student_id, k.name as student_name, k.tutor_id
           from kids k where k.tutor_id is not null
         union
         select k.id, k.name, ct.tutor_id
           from kids k
           join enrollments e on e.student_id = k.id and e.status = 'active'
           join class_templates ct on ct.id = e.template_id and ct.organization_id = $2
          where ct.tutor_id is not null
         union
         select k.id, k.name, cs.tutor_id
           from kids k
           join class_sessions cs on cs.organization_id = $2 and k.id = any(cs.student_ids)
          where cs.tutor_id is not null and cs.status <> 'cancelled'
            and cs.start_time > now() - interval '30 days'
       )
       select t.tutor_id as user_id, t.student_id, t.student_name,
              coalesce(nullif(tp.full_name, ''), nullif(p.name, ''), 'Tutor') as name
         from teaching t
         join organization_members om
           on om.organization_id = $2 and om.user_id = t.tutor_id and om.role in ('owner', 'admin', 'tutor')
         left join tutor_profiles tp on tp.user_id = t.tutor_id and tp.organization_id = $2
         left join profiles p on p.id = t.tutor_id
        where t.tutor_id <> $1
        order by name, t.student_name
        limit 50`,
      [req.user!.id, orgId]
    );
    res.json(
      tutorContactsResponseSchema.parse({
        ok: true,
        tutors: rows.map((r) => ({ userId: r.user_id, name: r.name, studentId: r.student_id, studentName: r.student_name })),
      })
    );
  } catch (err) { next(err); }
});

export default router;
