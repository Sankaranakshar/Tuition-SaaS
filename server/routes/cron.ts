import express from "express";
import { pool, withTransaction } from "../db.ts";
import { materializeTemplate, TEMPLATE_SELECT, MATERIALIZABLE, type Template } from "./scheduling.ts";
import { writeAudit } from "../utils/audit.ts";
import { paiseToRupees } from "../../shared/money.ts";
import { resolveCreditExpiryPolicy, computeCreditExpiry, type ExpiryWarning } from "../../shared/creditExpiry.ts";
import { enqueueMessage } from "../utils/messaging/outbox.ts";
import { resolveStudentGuardianRecipients } from "../utils/messaging/recipients.ts";
import { renderTemplate } from "../utils/messaging/templates.ts";
import { getMessagingProvider, type MessagingChannel } from "../utils/messaging/provider.ts";
import { sessionReminderKey } from "../utils/messaging/idempotency.ts";
import { backoffMinutes, nextChannel, isDeadLetter } from "../utils/messaging/backoff.ts";
import { rollupWeeklyLoop, rollupActivation } from "../utils/analyticsRollup.ts";

// Machine-to-machine endpoint, wired to Vercel Cron (vercel.json's `crons`
// array) daily against all four routes below. No Supabase user session
// exists for a scheduler invocation, so this is gated by a shared secret
// instead of authenticateToken/requireOrg — Vercel Cron sends
// `Authorization: Bearer ${CRON_SECRET}`; `x-cron-secret: ${CRON_SECRET}` is
// also accepted for manual/curl invocation and any non-Vercel scheduler.
// Cadence is daily, shorter than WEEKS_AHEAD in scheduling.ts, so the
// rolling session window never runs dry. All four crons fire between 20:00
// and 20:15 UTC (01:30-01:45 IST) — comfortably after midnight IST so a
// day's worth of India-timezone activity (org timezone model, C-01) has
// closed before reporting-daily/expire-credits/reconcile-wallets look at it,
// each offset a few minutes apart so they don't all grab the 3-connection
// pool (server/db.ts PG_POOL_MAX) at once.
const router = express.Router();

router.use((req, res, next) => {
  const secret = process.env.CRON_SECRET;
  const bearer = req.header("authorization");
  const bearerToken = bearer?.startsWith("Bearer ") ? bearer.slice("Bearer ".length) : null;
  const authorized = !!secret && (req.header("x-cron-secret") === secret || bearerToken === secret);
  if (!authorized) {
    return res.status(404).json({ error: { code: "not_found", message: "Not found" } });
  }
  next();
});

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function materializeSessionsHandler(_req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    // Skip templates materializeTemplate would drop on entry anyway (one-to-ones,
    // unscheduled batches) — across every org that is most of the table.
    const templatesRes = await pool.query(`${TEMPLATE_SELECT} where ${MATERIALIZABLE}`);

    const aggregate = { created: [] as string[], conflicts: [] as { templateId: string; date: string }[], templatesProcessed: 0 };
    // One template's failure (bad data, a lock timeout) shouldn't sink every
    // other org's materialization — isolate per template, keep going, and
    // leave an audit_events trail (scoped to that template's org, the only
    // org a single-template failure can be attributed to) so the failure is
    // discoverable without digging through Vercel's function logs.
    const failures: { organizationId: string; templateId: string; error: string }[] = [];
    for (const row of templatesRes.rows as Template[]) {
      try {
        const r = await materializeTemplate(row);
        aggregate.created.push(...r.created);
        aggregate.conflicts.push(...r.conflicts);
        aggregate.templatesProcessed++;
      } catch (err) {
        const error = errorMessage(err);
        failures.push({ organizationId: row.organization_id, templateId: row.id, error });
        await writeAudit(
          row.organization_id,
          { system: "materialize_sessions_cron" },
          "cron.materialize_sessions_failed",
          "class_templates",
          row.id,
          { error }
        );
      }
    }
    res.json({ ok: failures.length === 0, ...aggregate, ...(failures.length ? { failures } : {}) });
  } catch (err) { next(err); }
}
// Registered for both GET and POST: Vercel Cron always invokes via GET
// (https://vercel.com/docs/cron-jobs#how-cron-jobs-work), but POST is kept
// for the existing contract tests and manual/curl invocation, both written
// against POST before this GET/POST mismatch was found — every unattended
// scheduled invocation has been silently 404ing since Step 26 shipped.
router.route("/materialize-sessions").get(materializeSessionsHandler).post(materializeSessionsHandler);

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
async function reportingDailyHandler(req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const body = (req.body ?? {}) as { date?: unknown };
    const targetDate = typeof body.date === "string" && DATE_RE.test(body.date)
      ? body.date
      : new Date(Date.now() - 24 * 3600 * 1000).toISOString().slice(0, 10);

    const orgsRes = await pool.query(`select id from organizations where status = 'active'`);

    let orgsProcessed = 0;
    // One org per statement (rather than the original single set-based
    // upsert across every org) so one org's bad data can't blank out the
    // whole day's snapshot for every other org, and so a failure has a
    // single org to attribute an audit_events row to.
    const failures: { organizationId: string; error: string }[] = [];
    for (const org of orgsRes.rows as { id: string }[]) {
      try {
        await pool.query(
          `with day_payments as (
             select coalesce(sum(amount_paise), 0) as revenue_paise, count(*) as payment_count
             from payments
             where organization_id = $2 and at >= $1::date and at < $1::date + 1
           ),
           day_invoices as (
             select count(*) as invoices_created
             from invoices
             where organization_id = $2 and created_at >= $1::date and created_at < $1::date + 1
           ),
           day_attendance as (
             select count(*) as attendance_marked,
                    count(*) filter (where status in ('present', 'late')) as attendance_present
             from attendance_records
             where organization_id = $2 and marked_at >= $1::date and marked_at < $1::date + 1
           ),
           outstanding as (
             select coalesce(sum(total_paise - paid_paise), 0) as outstanding_paise
             from invoices
             where organization_id = $2 and status <> 'void'
           ),
           active_students as (
             select count(*) as active_student_count
             from students
             where organization_id = $2 and status = 'active' and is_deleted = false
           )
           insert into org_stats_daily (organization_id, date, stats)
           select
             $2,
             $1::date,
             jsonb_build_object(
               'revenueCollectedPaise', (select revenue_paise from day_payments),
               'paymentCount', (select payment_count from day_payments),
               'invoicesCreated', (select invoices_created from day_invoices),
               'outstandingPaise', (select outstanding_paise from outstanding),
               'activeStudentCount', (select active_student_count from active_students),
               'attendanceMarked', (select attendance_marked from day_attendance),
               'attendancePresent', (select attendance_present from day_attendance)
             )
           on conflict (organization_id, date) do update set stats = excluded.stats`,
          [targetDate, org.id]
        );
        orgsProcessed++;
      } catch (err) {
        const error = errorMessage(err);
        failures.push({ organizationId: org.id, error });
        await writeAudit(
          org.id,
          { system: "reporting_daily_cron" },
          "cron.reporting_daily_failed",
          "org_stats_daily",
          org.id,
          { date: targetDate, error }
        );
      }
    }

    res.json({ ok: failures.length === 0, date: targetDate, orgsProcessed, ...(failures.length ? { failures } : {}) });
  } catch (err) { next(err); }
}
router.route("/reporting-daily").get(reportingDailyHandler).post(reportingDailyHandler);

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
async function reconcileWalletsHandler(_req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const orgsRes = await pool.query(`select distinct organization_id as id from wallets`);

    let walletsChecked = 0;
    let mismatches = 0;
    // Scoped per org (was one set-based query across every org) so a bad
    // row in one org's ledger can't abort reconciliation for every other
    // org, and so a genuine query failure has a single org to attribute an
    // audit_events row to. Mismatches found (not failures — the job is
    // working as intended) still get their own per-row audit row below,
    // unchanged from before.
    const failures: { organizationId: string; error: string }[] = [];
    for (const org of orgsRes.rows as { id: string }[]) {
      try {
        const walletsRes = await pool.query(
          `with expected as (
             select student_id,
                    coalesce(sum(credits), 0)::int as expected_credits,
                    coalesce(sum(paise), 0)::bigint as expected_paise
             from wallet_ledger
             where organization_id = $1
             group by student_id
           )
           select w.id, w.student_id, w.balance_credits, w.balance_currency,
                  coalesce(e.expected_credits, 0) as expected_credits,
                  coalesce(e.expected_paise, 0) as expected_paise,
                  w.balance_credits <> coalesce(e.expected_credits, 0)
                    or w.balance_currency <> round(coalesce(e.expected_paise, 0)::numeric / 100, 2) as mismatch
           from wallets w
           left join expected e on e.student_id = w.student_id
           where w.organization_id = $1`,
          [org.id]
        );

        for (const row of walletsRes.rows) {
          walletsChecked++;
          if (!row.mismatch) continue;
          mismatches++;
          await writeAudit(
            org.id,
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
      } catch (err) {
        const error = errorMessage(err);
        failures.push({ organizationId: org.id, error });
        await writeAudit(
          org.id,
          { system: "wallet_reconciliation_cron" },
          "cron.reconcile_wallets_failed",
          "wallets",
          org.id,
          { error }
        );
      }
    }

    res.json({ ok: failures.length === 0, walletsChecked, mismatches, ...(failures.length ? { failures } : {}) });
  } catch (err) { next(err); }
}
router.route("/reconcile-wallets").get(reconcileWalletsHandler).post(reconcileWalletsHandler);

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
async function expireCreditsHandler(_req: express.Request, res: express.Response, next: express.NextFunction) {
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
    // One org's failure (bad settings, a lock timeout inside withTransaction)
    // shouldn't stop every other org's credits from expiring on schedule —
    // isolate per org, keep going, and leave an audit_events trail.
    const failures: { organizationId: string; error: string }[] = [];

    for (const org of orgsRes.rows) {
      try {
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
      } catch (err) {
        const error = errorMessage(err);
        failures.push({ organizationId: org.id, error });
        await writeAudit(
          org.id,
          { system: "credit_expiry_cron" },
          "cron.expire_credits_failed",
          "organizations",
          org.id,
          { error }
        );
      }
    }

    res.json({
      ok: failures.length === 0,
      orgsProcessed: orgsRes.rowCount,
      walletsChecked,
      lotsExpired,
      creditsExpired,
      paiseExpired,
      warningsSent,
      ...(failures.length ? { failures } : {}),
    });
  } catch (err) { next(err); }
}
router.route("/expire-credits").get(expireCreditsHandler).post(expireCreditsHandler);

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

// B-17 (EXECUTION_PLAN.md Step 27): the delivery sweep. Two jobs in one route
// deliberately, not two cron entries: Vercel Cron on the Hobby plan only
// schedules daily (see this file's header comment on the 20:00-20:15 UTC
// window), so a session-reminder job that only *enqueues* on its own daily
// tick would still need this same sweep to actually send -- combining them
// means one cron entry instead of two, and "enqueue, then send what's due"
// reads as one coherent daily pass rather than two jobs racing each other.
//
// Retry/backoff/dead-letter state machine: queued -> [send attempt] -> sent,
// or -> failed (next_attempt_at pushed out, exponential backoff capped at 60
// minutes) -> retried on a later sweep, up to MAX_DELIVERY_ATTEMPTS, after
// which the row moves to dead_letter and writes one audit_events row (not
// one per retry, which would spam the audit log for a single lapsing
// message). The first failure on a whatsapp-channel message flips it to sms
// for the next attempt -- D-10's "WhatsApp-first with SMS fallback"
// implemented as a state transition, not a second code path. The state
// machine itself lives in server/utils/messaging/backoff.ts so it's
// unit-testable without a database; this handler is just the IO around it.

// Lookahead covers a bit more than a full day so a session materialized (or
// a reminder missed) close to the boundary of one daily sweep is still
// caught by the next one, rather than requiring the two to land exactly 24h
// apart. Idempotency key is per (session, student) pair, so re-running the
// sweep before the next day never double-reminds.
const SESSION_REMINDER_LOOKAHEAD_MS = 26 * 3600 * 1000;

function formatSessionTimeInZone(instant: Date, zone: string): string {
  return new Intl.DateTimeFormat("en-IN", {
    timeZone: zone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(instant);
}

async function enqueueSessionReminders(): Promise<{ sessionsChecked: number; enqueued: number }> {
  const sessionsRes = await pool.query(
    `select s.id, s.organization_id, s.student_ids, s.start_time, o.timezone,
            ct.name as template_name
     from class_sessions s
     join organizations o on o.id = s.organization_id
     left join class_templates ct on ct.id = s.template_id
     where s.status = 'scheduled'
       and s.start_time >= now()
       and s.start_time < now() + ($1 || ' milliseconds')::interval`,
    [String(SESSION_REMINDER_LOOKAHEAD_MS)]
  );

  let enqueued = 0;
  for (const session of sessionsRes.rows as {
    id: string; organization_id: string; student_ids: string[]; start_time: string;
    timezone: string; template_name: string | null;
  }[]) {
    const startTimeLocal = formatSessionTimeInZone(new Date(session.start_time), session.timezone);
    for (const studentId of session.student_ids) {
      const studentRes = await pool.query(`select name from students where id = $1`, [studentId]);
      const studentName = studentRes.rows[0]?.name as string | undefined;
      if (!studentName) continue;

      const recipients = await resolveStudentGuardianRecipients(pool, studentId);
      for (const recipient of recipients) {
        const result = await enqueueMessage(pool, {
          organizationId: session.organization_id,
          recipientUserId: recipient.recipientUserId,
          recipientPhone: recipient.recipientPhone,
          templateKey: "session_reminder",
          payload: { studentName, startTimeLocal, subject: session.template_name },
          source: { kind: "class_session", entityId: session.id },
          idempotencyKey: sessionReminderKey(session.id, studentId),
        });
        if (result.enqueued) enqueued++;
      }
    }
  }
  return { sessionsChecked: sessionsRes.rowCount ?? 0, enqueued };
}

async function sweepOutbox(): Promise<{ checked: number; sent: number; failed: number; deadLettered: number }> {
  const provider = getMessagingProvider();
  const dueRes = await pool.query(
    `select id, organization_id, recipient_phone, channel, template_key, payload, attempts
     from message_outbox
     where state in ('queued', 'failed') and next_attempt_at <= now()
     order by created_at asc
     limit 200`
  );

  let sent = 0;
  let failed = 0;
  let deadLettered = 0;

  for (const row of dueRes.rows as {
    id: string; organization_id: string; recipient_phone: string; channel: MessagingChannel;
    template_key: string; payload: Record<string, unknown>; attempts: number;
  }[]) {
    let sendError: string | null = null;
    let providerMessageId: string | undefined;
    try {
      const text = renderTemplate(row.template_key as Parameters<typeof renderTemplate>[0], row.payload);
      const result = await provider.send({
        channel: row.channel, recipientPhone: row.recipient_phone, templateKey: row.template_key, text,
      });
      if (result.ok) {
        providerMessageId = result.providerMessageId;
      } else {
        sendError = result.error ?? "send_failed";
      }
    } catch (err) {
      sendError = errorMessage(err);
    }

    if (!sendError) {
      await pool.query(
        `update message_outbox
           set state = 'sent', sent_at = now(), attempts = attempts + 1, provider_message_id = $2,
               error = null, updated_at = now()
         where id = $1`,
        [row.id, providerMessageId ?? null]
      );
      sent++;
      continue;
    }

    const attempts = row.attempts + 1;
    if (isDeadLetter(attempts)) {
      await pool.query(
        `update message_outbox set state = 'dead_letter', attempts = $2, error = $3, updated_at = now() where id = $1`,
        [row.id, attempts, sendError]
      );
      await writeAudit(
        row.organization_id,
        { system: "messaging_delivery_sweep" },
        "cron.messaging_dead_letter",
        "message_outbox",
        row.id,
        { templateKey: row.template_key, attempts, error: sendError }
      );
      deadLettered++;
    } else {
      const channel: MessagingChannel = nextChannel(attempts, row.channel);
      await pool.query(
        `update message_outbox
           set state = 'failed', attempts = $2, channel = $3,
               next_attempt_at = now() + ($4 || ' minutes')::interval, error = $5, updated_at = now()
         where id = $1`,
        [row.id, attempts, channel, String(backoffMinutes(attempts)), sendError]
      );
      failed++;
    }
  }

  return { checked: dueRes.rowCount ?? 0, sent, failed, deadLettered };
}

async function deliverySweepHandler(_req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const reminders = await enqueueSessionReminders();
    const sweep = await sweepOutbox();
    res.json({ ok: true, reminders, ...sweep });
  } catch (err) { next(err); }
}
router.route("/delivery-sweep").get(deliverySweepHandler).post(deliverySweepHandler);

// C-07 (EXECUTION_PLAN.md Step 32): activation analytics' aggregation job,
// the sixth cron (vercel.json, 20:25 UTC, after delivery-sweep so the day's
// deliveries are settled first). For every active org it recomputes the
// weekly loop and the activation snapshot in full from the tables of record
// (server/utils/analyticsRollup.ts), so a re-run writes identical rows and
// org.activated lands at most once per org. Offboarded orgs keep their last
// rows untouched. Same per-org failure isolation and audit trail as
// reporting-daily.
async function analyticsRollupHandler(_req: express.Request, res: express.Response, next: express.NextFunction) {
  try {
    const orgsRes = await pool.query(`select id from organizations where status = 'active' order by created_at`);
    let orgsProcessed = 0;
    let weekRows = 0;
    let activated = 0;
    let newlyActivated = 0;
    const failures: { organizationId: string; error: string }[] = [];
    for (const org of orgsRes.rows as { id: string }[]) {
      try {
        weekRows += await rollupWeeklyLoop(org.id);
        const a = await rollupActivation(org.id);
        if (a.result.activatedAt) activated++;
        if (a.newlyActivated) newlyActivated++;
        orgsProcessed++;
      } catch (err) {
        const error = errorMessage(err);
        failures.push({ organizationId: org.id, error });
        await writeAudit(org.id, { system: "analytics_rollup_cron" }, "cron.analytics_rollup_failed", "organizations", org.id, { error });
      }
    }
    res.json({ ok: failures.length === 0, orgsProcessed, weekRows, activated, newlyActivated, ...(failures.length ? { failures } : {}) });
  } catch (err) { next(err); }
}
router.route("/analytics-rollup").get(analyticsRollupHandler).post(analyticsRollupHandler);

export default router;
