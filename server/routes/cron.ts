import express from "express";
import { pool } from "../db.ts";
import { materializeTemplate, type Template } from "./scheduling.ts";

// Machine-to-machine endpoint for Cloud Scheduler. No Supabase user session
// exists for a scheduler invocation, so this is gated by a shared secret
// instead of authenticateToken/requireOrg. Configure Cloud Scheduler to send
// `x-cron-secret: ${CRON_SECRET}` and point it at this route on a cadence
// shorter than WEEKS_AHEAD in scheduling.ts (e.g. daily) so the rolling
// session window never runs dry.
const router = express.Router();

router.use((req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.header("x-cron-secret") !== secret) {
    return res.status(404).json({ error: { code: "not_found", message: "Not found" } });
  }
  next();
});

router.post("/materialize-sessions", async (_req, res, next) => {
  try {
    const templatesRes = await pool.query(
      `select id, organization_id, type, tutor_id, student_ids, days_of_week, start_hour, start_minute, duration_minutes, is_online, room_number
       from class_templates`
    );

    const aggregate = { created: [] as string[], conflicts: [] as { templateId: string; date: string }[], templatesProcessed: 0 };
    for (const row of templatesRes.rows as Template[]) {
      const r = await materializeTemplate(row);
      aggregate.created.push(...r.created);
      aggregate.conflicts.push(...r.conflicts);
      aggregate.templatesProcessed++;
    }
    res.json({ ok: true, ...aggregate });
  } catch (err) { next(err); }
});

export default router;
