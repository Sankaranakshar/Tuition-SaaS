import { pool } from "../db.ts";
import { computeActivation, daysToActivate, type ActivationResult } from "../../shared/analytics.ts";
import { trackEvent } from "./analytics.ts";

// C-07 (EXECUTION_PLAN.md Step 32): the analytics-rollup cron's work for one
// org. Everything is recomputed from the tables of record (sessions,
// attendance, invoices, payments, wallet top-ups, the outbox) rather than
// from product_events, for three reasons: those tables are the truth when
// an attendance mark is reversed or an invoice voided; they cover every org's
// history from before this step shipped, so nothing needed a backfill; and
// a full recompute is idempotent, so a re-run or a retry writes the same
// rows. product_events supplies only what no other table records (parent
// portal opens, parent payment starts).

/**
 * Money collected through ClassStackr, one row per receipt: invoice payments
 * (manual and Razorpay) plus wallet top-ups (manual and Razorpay).
 * Overpayment credit is excluded; it is part of the payment that caused it.
 * `$1` is the org id.
 */
export const COLLECTIONS_SQL = `
  select at, amount_paise::bigint as paise, gateway is not null as online
  from payments where organization_id = $1 and amount_paise > 0
  union all
  select at, paise::bigint as paise, gateway_payment_id is not null as online
  from wallet_ledger
  where organization_id = $1 and type = 'credit_currency' and reason = 'topup' and paise > 0`;

/** The same receipts as COLLECTIONS_SQL, for every org at once, since `$1` (a timestamptz). */
export const ALL_ORGS_COLLECTIONS_SINCE_SQL = `
  select organization_id, at, amount_paise::bigint as paise, gateway is not null as online
  from payments where amount_paise > 0 and at >= $1
  union all
  select organization_id, at, paise::bigint as paise, gateway_payment_id is not null as online
  from wallet_ledger
  where type = 'credit_currency' and reason = 'topup' and paise > 0 and at >= $1`;

/** Recomputes every week of org_weekly_loop from the org's signup week to this week, in the org's timezone. */
export async function rollupWeeklyLoop(orgId: string): Promise<number> {
  const res = await pool.query(
    `with o as (
       select created_at, timezone as tz from organizations where id = $1
     ),
     weeks as (
       select generate_series(
         date_trunc('week', (select created_at at time zone tz from o)),
         date_trunc('week', (select now() at time zone tz from o)),
         interval '7 days'
       )::date as week_start
     ),
     sched as (
       select date_trunc('week', start_time at time zone (select tz from o))::date as w, count(*) as n
       from class_sessions where organization_id = $1 and status <> 'cancelled' group by 1
     ),
     att as (
       select date_trunc('week', first_mark at time zone (select tz from o))::date as w,
              count(*) as sessions, sum(marks) as marks
       from (
         select session_id, min(created_at) as first_mark, count(*) as marks
         from attendance_records where organization_id = $1 and reversed_at is null
         group by session_id
       ) s group by 1
     ),
     inv as (
       select date_trunc('week', created_at at time zone (select tz from o))::date as w, count(*) as n
       from invoices where organization_id = $1 and status <> 'void' group by 1
     ),
     msg as (
       select date_trunc('week', delivered_at at time zone (select tz from o))::date as w, count(*) as n
       from message_outbox where organization_id = $1 and delivered_at is not null group by 1
     ),
     coll as (
       select date_trunc('week', at at time zone (select tz from o))::date as w,
              sum(paise) as total, coalesce(sum(paise) filter (where online), 0) as online
       from (${COLLECTIONS_SQL}) c group by 1
     ),
     ev as (
       select date_trunc('week', occurred_at at time zone (select tz from o))::date as w,
              count(*) filter (where name = 'parent.portal_opened') as opens,
              count(*) filter (where name = 'parent.payment_started') as pays
       from product_events
       where organization_id = $1 and name in ('parent.portal_opened', 'parent.payment_started')
       group by 1
     )
     insert into org_weekly_loop (
       organization_id, week_start, sessions_scheduled, sessions_attended, attendance_marked,
       invoices_raised, messages_delivered, collected_paise, collected_online_paise,
       parent_portal_opens, parent_payments_started, computed_at
     )
     select $1, weeks.week_start,
            coalesce(sched.n, 0), coalesce(att.sessions, 0), coalesce(att.marks, 0),
            coalesce(inv.n, 0), coalesce(msg.n, 0), coalesce(coll.total, 0), coalesce(coll.online, 0),
            coalesce(ev.opens, 0), coalesce(ev.pays, 0), now()
     from weeks
     left join sched on sched.w = weeks.week_start
     left join att on att.w = weeks.week_start
     left join inv on inv.w = weeks.week_start
     left join msg on msg.w = weeks.week_start
     left join coll on coll.w = weeks.week_start
     left join ev on ev.w = weeks.week_start
     on conflict (organization_id, week_start) do update set
       sessions_scheduled = excluded.sessions_scheduled,
       sessions_attended = excluded.sessions_attended,
       attendance_marked = excluded.attendance_marked,
       invoices_raised = excluded.invoices_raised,
       messages_delivered = excluded.messages_delivered,
       collected_paise = excluded.collected_paise,
       collected_online_paise = excluded.collected_online_paise,
       parent_portal_opens = excluded.parent_portal_opens,
       parent_payments_started = excluded.parent_payments_started,
       computed_at = excluded.computed_at`,
    [orgId]
  );
  return res.rowCount ?? 0;
}

/** Recomputes the org's org_activation row. Emits org.activated (once, ever) the first run that finds it activated. */
export async function rollupActivation(orgId: string): Promise<{ result: ActivationResult; newlyActivated: boolean }> {
  const [orgRes, classRes, marksRes, collRes] = await Promise.all([
    pool.query(`select created_at from organizations where id = $1`, [orgId]),
    pool.query(`select min(created_at) as first_class_at from class_sessions where organization_id = $1`, [orgId]),
    pool.query(
      `select min(created_at) as first_mark from attendance_records
       where organization_id = $1 and reversed_at is null group by session_id`,
      [orgId]
    ),
    pool.query(COLLECTIONS_SQL, [orgId]),
  ]);
  const toIso = (v: unknown) => new Date(v as string).toISOString();

  const result = computeActivation({
    signupAt: toIso(orgRes.rows[0].created_at),
    firstClassAt: classRes.rows[0]?.first_class_at ? toIso(classRes.rows[0].first_class_at) : null,
    sessionFirstMarkedAt: marksRes.rows.map((r) => toIso(r.first_mark)),
    collections: collRes.rows.map((r) => ({ at: toIso(r.at), paise: Number(r.paise), online: !!r.online })),
  });

  await pool.query(
    `insert into org_activation (
       organization_id, signup_at, window_ends_at, first_class_at, first_attendance_at,
       sessions_attended_in_window, tenth_session_attended_at, first_collected_at,
       collected_in_window_paise, collected_online_in_window_paise, activated_at, computed_at
     ) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, now())
     on conflict (organization_id) do update set
       signup_at = excluded.signup_at,
       window_ends_at = excluded.window_ends_at,
       first_class_at = excluded.first_class_at,
       first_attendance_at = excluded.first_attendance_at,
       sessions_attended_in_window = excluded.sessions_attended_in_window,
       tenth_session_attended_at = excluded.tenth_session_attended_at,
       first_collected_at = excluded.first_collected_at,
       collected_in_window_paise = excluded.collected_in_window_paise,
       collected_online_in_window_paise = excluded.collected_online_in_window_paise,
       activated_at = excluded.activated_at,
       computed_at = excluded.computed_at`,
    [
      orgId, result.signupAt, result.windowEndsAt, result.firstClassAt, result.firstAttendanceAt,
      result.sessionsAttendedInWindow, result.tenthSessionAttendedAt, result.firstCollectedAt,
      result.collectedInWindowPaise, result.collectedOnlineInWindowPaise, result.activatedAt,
    ]
  );

  let newlyActivated = false;
  if (result.activatedAt) {
    const tracked = await trackEvent({
      organizationId: orgId,
      name: "org.activated",
      properties: {
        sessionsAttended: result.sessionsAttendedInWindow,
        collectedPaise: result.collectedInWindowPaise,
        daysToActivate: daysToActivate(result)!,
      },
      dedupeKey: `org.activated:${orgId}`,
      occurredAt: result.activatedAt,
    });
    newlyActivated = tracked === "recorded";
  }
  return { result, newlyActivated };
}
