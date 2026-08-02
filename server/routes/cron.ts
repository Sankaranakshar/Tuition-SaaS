import express from "express";
import { pool } from "../db.ts";
import { materializeTemplate, TEMPLATE_SELECT, MATERIALIZABLE, type Template } from "./scheduling.ts";

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
    // Skip templates materializeTemplate would drop on entry anyway (one-to-ones,
    // unscheduled batches) — across every org that is most of the table.
    const templatesRes = await pool.query(`${TEMPLATE_SELECT} where ${MATERIALIZABLE}`);

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

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// Populates org_stats_daily (Stage 4 "Reporting", DEV_PLAN §3.2). The table
// existed since the original schema but nothing ever wrote to it — Money's
// insights tab still computes its trend/collection-rate live from
// payments/invoices client-side (src/lib/money.ts) and this job doesn't
// change that; it just gives future consumers (an admin history view, the
// deferred AI morning brief) a cheap per-org daily snapshot instead of a
// full-table scan. One row per active org per day, upserted so a rerun for
// the same date is idempotent. Defaults to UTC yesterday so the day being
// aggregated is always fully closed; pass `date` (YYYY-MM-DD) to backfill.
router.post("/reporting-daily", async (req, res, next) => {
  try {
    const body = (req.body ?? {}) as { date?: unknown };
    const targetDate = typeof body.date === "string" && DATE_RE.test(body.date)
      ? body.date
      : new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);

    const result = await pool.query(
      `with day_payments as (
         select organization_id, coalesce(sum(amount_paise), 0) as revenue_paise, count(*) as payment_count
         from payments
         where at >= $1::date and at < $1::date + 1
         group by organization_id
       ),
       day_invoices as (
         select organization_id, count(*) as invoices_created
         from invoices
         where created_at >= $1::date and created_at < $1::date + 1
         group by organization_id
       ),
       day_attendance as (
         select organization_id, count(*) as attendance_marked,
                count(*) filter (where status in ('present', 'late')) as attendance_present
         from attendance_records
         where marked_at >= $1::date and marked_at < $1::date + 1
         group by organization_id
       ),
       outstanding as (
         select organization_id, coalesce(sum(total_paise - paid_paise), 0) as outstanding_paise
         from invoices
         where status <> 'void'
         group by organization_id
       ),
       active_students as (
         select organization_id, count(*) as active_student_count
         from students
         where status = 'active' and is_deleted = false
         group by organization_id
       )
       insert into org_stats_daily (organization_id, date, stats)
       select
         o.id,
         $1::date,
         jsonb_build_object(
           'revenueCollectedPaise', coalesce(dp.revenue_paise, 0),
           'paymentCount', coalesce(dp.payment_count, 0),
           'invoicesCreated', coalesce(di.invoices_created, 0),
           'outstandingPaise', coalesce(os.outstanding_paise, 0),
           'activeStudentCount', coalesce(ac.active_student_count, 0),
           'attendanceMarked', coalesce(da.attendance_marked, 0),
           'attendancePresent', coalesce(da.attendance_present, 0)
         )
       from organizations o
       left join day_payments dp on dp.organization_id = o.id
       left join day_invoices di on di.organization_id = o.id
       left join day_attendance da on da.organization_id = o.id
       left join outstanding os on os.organization_id = o.id
       left join active_students ac on ac.organization_id = o.id
       where o.status = 'active'
       on conflict (organization_id, date) do update set stats = excluded.stats
       returning organization_id`,
      [targetDate]
    );

    res.json({ ok: true, date: targetDate, orgsProcessed: result.rowCount });
  } catch (err) { next(err); }
});

export default router;
