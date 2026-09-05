import express from "express";
import { pool, withTransaction } from "../db.ts";
import { materializeTemplate, TEMPLATE_SELECT, MATERIALIZABLE, type Template } from "./scheduling.ts";
import { writeAudit } from "../utils/audit.ts";
import { paiseToRupees } from "../../shared/money.ts";
import { resolveCreditExpiryPolicy, computeCreditExpiry, type ExpiryWarning } from "../../shared/creditExpiry.ts";

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

// Wallet-to-ledger reconciliation (B-03, MASTER_PLAN.md §3 R1) — the check
// that catches the next B-01-shaped bug before a parent notices their
// balance is wrong. wallet_ledger is the append-only source of truth (every
// top-up/attendance-debit/refund/reversal route writes a signed delta row
// here); wallets.balance_credits/balance_currency are denormalized running
// totals kept in sync by those same routes. This job re-derives the totals
// from the ledger and compares — on a mismatch it does NOT auto-correct
// (a real drift needs a human to look at it, not a job silently rewriting
// money), it just logs an audit_events row so it's visible in the audit log
// viewer. balance_currency is legacy display-mirror rupees (numeric(10,2),
// shared/money.ts); expected_paise is cast to numeric before dividing since
// bigint/int division in Postgres truncates.
router.post("/reconcile-wallets", async (_req, res, next) => {
  try {
    const mismatches = await pool.query(
      `with expected as (
         select organization_id, student_id,
                coalesce(sum(credits), 0)::int as expected_credits,
                coalesce(sum(paise), 0)::bigint as expected_paise
         from wallet_ledger
         group by organization_id, student_id
       )
       select w.id, w.organization_id, w.student_id,
              w.balance_credits, w.balance_currency,
              coalesce(e.expected_credits, 0) as expected_credits,
              coalesce(e.expected_paise, 0) as expected_paise
       from wallets w
       left join expected e
         on e.organization_id = w.organization_id and e.student_id = w.student_id
       where w.balance_credits <> coalesce(e.expected_credits, 0)
          or w.balance_currency <> round(coalesce(e.expected_paise, 0)::numeric / 100, 2)`
    );

    for (const row of mismatches.rows) {
      await writeAudit(
        row.organization_id,
        { system: "wallet_reconciliation_cron" },
        "wallet.reconciliation_mismatch",
        "wallets",
        row.id,
        {
          studentId: row.student_id,
          actualCredits: row.balance_credits,
          expectedCredits: row.expected_credits,
          actualCurrency: row.balance_currency,
          expectedCurrency: paiseToRupees(Number(row.expected_paise)),
        }
      );
    }

    const totalRes = await pool.query(`select count(*)::int as total from wallets`);
    res.json({ ok: true, walletsChecked: totalRes.rows[0].total, mismatches: mismatches.rowCount });
  } catch (err) { next(err); }
});

// Credit expiry (B-04, D-07 — EXECUTION_PLAN.md Step 9). Per-org opt-in: a
// center sets { enabled, windowDays } at organizations.settings.creditExpiry
// (Settings → Organization). There is no platform default — an org that
// never configures this keeps immortal credits, today's behaviour, and this
// job skips it entirely. Expiry runs from each top-up / purchase DATE, not
// last activity, so it can't work off the scalar wallet balance: it walks
// wallet_ledger FIFO (shared/creditExpiry.ts), attributing every debit to
// the oldest open lot, and breaks the unspent remainder of any lot older
// than the window. Computed on the fly each run — no wallet_credit_lots
// table — matching B-03's "re-derive from the ledger" instinct; production
// wallets are tiny. For each broken lot a credit_expiry ledger row (negative
// delta, reason 'credit_expiry') is written, keyed idempotent on the source
// lot's ledger id, and the wallet balance is decremented to match so B-03's
// reconciliation still holds (balance == ledger sum). Nothing is deleted.
// 30-day and 7-day warning notifications fire once per lot via the existing
// notifications surface, deduped against notifications already written.
router.post("/expire-credits", async (_req, res, next) => {
  try {
    const orgsRes = await pool.query(
      `select id, settings from organizations
       where status = 'active' and settings -> 'creditExpiry' ->> 'enabled' = 'true'`
    );

    let walletsChecked = 0;
    let lotsExpired = 0;
    let creditsExpired = 0;
    let paiseExpired = 0;
    let warningsSent = 0;

    for (const org of orgsRes.rows) {
      const policy = resolveCreditExpiryPolicy((org.settings as Record<string, unknown> | null)?.creditExpiry);
      if (!policy.enabled) continue; // toggle on but window unset/zero — treat as not configured

      const walletsRes = await pool.query(
        `select id, student_id, balance_credits, balance_currency
         from wallets where organization_id = $1`,
        [org.id]
      );

      for (const wallet of walletsRes.rows) {
        walletsChecked++;

        const ledgerRes = await pool.query(
          `select id, credits, paise, at from wallet_ledger
           where organization_id = $1 and student_id = $2
           order by at asc, id asc`,
          [org.id, wallet.student_id]
        );

        const { expired, warnings } = computeCreditExpiry(ledgerRes.rows, policy.windowDays, new Date());

        if (expired.length > 0) {
          await withTransaction(async (client) => {
            let dCredits = 0;
            let dPaise = 0;
            for (const lot of expired) {
              const key = `credit_expiry_${lot.lotLedgerId}_${lot.denom === "credits" ? "c" : "p"}`;
              const dup = await client.query(
                `select 1 from wallet_ledger where organization_id = $1 and idempotency_key = $2`,
                [org.id, key]
              );
              if ((dup.rowCount ?? 0) > 0) continue;

              const credits = lot.denom === "credits" ? -lot.amount : 0;
              const paise = lot.denom === "paise" ? -lot.amount : 0;
              await client.query(
                `insert into wallet_ledger
                   (organization_id, student_id, type, credits, paise, reason, by, idempotency_key, at)
                 values ($1, $2, 'credit_expiry', $3, $4, 'credit_expiry', 'credit_expiry_cron', $5, now())`,
                [org.id, wallet.student_id, credits, paise, key]
              );
              dCredits += credits;
              dPaise += paise;
              lotsExpired++;
              if (lot.denom === "credits") creditsExpired += lot.amount;
              else paiseExpired += lot.amount;
            }

            if (dCredits !== 0 || dPaise !== 0) {
              await client.query(
                `update wallets
                   set balance_credits = balance_credits + $1,
                       balance_currency = balance_currency + $2
                 where id = $3`,
                [dCredits, paiseToRupees(dPaise), wallet.id]
              );
              await writeAudit(
                org.id,
                { system: "credit_expiry_cron" },
                "wallet.credit_expiry",
                "wallets",
                wallet.id,
                { studentId: wallet.student_id, creditsExpired: -dCredits, paiseExpired: -dPaise }
              );
            }
          });
        }

        for (const warn of warnings) {
          if (await sendExpiryWarning(org.id, wallet.student_id, warn)) warningsSent++;
        }
      }
    }

    res.json({
      ok: true,
      orgsProcessed: orgsRes.rowCount,
      walletsChecked,
      lotsExpired,
      creditsExpired,
      paiseExpired,
      warningsSent,
    });
  } catch (err) { next(err); }
});

// One 30-day and one 7-day notification per lapsing lot, to every parent
// linked to the student plus the student's own login. Deduped on
// (lotLedgerId, stage, denom) against notifications already written, so a
// daily cadence doesn't re-notify. A parent linked after the warning fired
// won't be backfilled — these are time-sensitive nudges, not guaranteed
// delivery. Returns whether a new notification was written.
async function sendExpiryWarning(orgId: string, studentId: string, warn: ExpiryWarning): Promise<boolean> {
  const existing = await pool.query(
    `select 1 from notifications
     where organization_id = $1 and type = 'wallet_credit_expiring'
       and payload ->> 'lotLedgerId' = $2 and payload ->> 'stage' = $3 and payload ->> 'denom' = $4
     limit 1`,
    [orgId, warn.lotLedgerId, String(warn.stage), warn.denom]
  );
  if ((existing.rowCount ?? 0) > 0) return false;

  const recipientsRes = await pool.query(
    `select parent_user_id as uid from parent_links where student_id = $1
     union
     select student_user_id as uid from students where id = $1 and student_user_id is not null`,
    [studentId]
  );
  if (recipientsRes.rowCount === 0) return false;

  const amountLabel =
    warn.denom === "credits"
      ? `${warn.remaining} credit${warn.remaining === 1 ? "" : "s"}`
      : `₹${(warn.remaining / 100).toLocaleString("en-IN")}`;
  const title = `${amountLabel} of wallet credit expires in ${warn.stage} days`;
  const payload = JSON.stringify({
    title,
    studentId,
    denom: warn.denom,
    stage: warn.stage,
    remaining: warn.remaining,
    lotLedgerId: warn.lotLedgerId,
    expiresAt: warn.expiresAt,
  });

  for (const row of recipientsRes.rows) {
    await pool.query(
      `insert into notifications (organization_id, user_id, type, payload)
       values ($1, $2, 'wallet_credit_expiring', $3::jsonb)`,
      [orgId, row.uid, payload]
    );
  }
  return true;
}

export default router;
