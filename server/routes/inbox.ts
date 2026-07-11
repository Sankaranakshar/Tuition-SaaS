import express from "express";
import { z } from "zod";
import type { PoolClient } from "pg";
import { withTransaction } from "../db.ts";
import { authenticateToken, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { ensureClassChannelResponseSchema } from "../../shared/schemas/inbox.ts";

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

  const studentsRes = await client.query(
    `select student_user_id from students where id = any($1::uuid[]) and student_user_id is not null`,
    [studentIds]
  );
  const parentsRes = await client.query(
    `select distinct parent_user_id from parent_links where student_id = any($1::uuid[])`,
    [studentIds]
  );
  return {
    tutorId,
    studentUserIds: studentsRes.rows.map((r) => r.student_user_id as string),
    parentUserIds: parentsRes.rows.map((r) => r.parent_user_id as string),
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

export default router;
