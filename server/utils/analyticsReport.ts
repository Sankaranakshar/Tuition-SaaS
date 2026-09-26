import { pool } from "../db.ts";
import { DEFAULT_ORG_TIMEZONE } from "../../shared/timezone.ts";
import {
  ACTIVATION,
  addDaysToDateKey,
  computeFunnel,
  computeRetentionCohorts,
  lastMonthKeys,
  orgStage,
  pivotMonthlyCollected,
  starterStage,
  weekStartInZone,
  type ActivationSnapshot,
  type AnalyticsReport,
  type LoopTotals,
  type OrgActivationRow,
} from "../../shared/analytics.ts";
import { ALL_ORGS_COLLECTIONS_SINCE_SQL } from "./analyticsRollup.ts";

// C-07 (EXECUTION_PLAN.md Step 32): assembles GET /api/v1/admin/analytics.
// Reads the rollup tables the analytics-rollup cron writes, plus
// product_events for the onboarding beats and feature usage, and hands the
// rows to shared/analytics.ts's pure functions. Rupees collected per month
// are read straight from the ledger (payments + wallet top-ups) so the
// headline number is never a night behind.

const MONTHS_SHOWN = 6;
const COHORT_WEEKS = 8;

const iso = (v: unknown) => (v ? new Date(v as string).toISOString() : null);

export async function buildAnalyticsReport(now: Date = new Date()): Promise<AnalyticsReport> {
  const orgsRes = await pool.query(
    `select o.id, o.name, o.status, o.created_at, o.timezone,
            a.window_ends_at, a.first_class_at, a.first_attendance_at, a.sessions_attended_in_window,
            a.first_collected_at, a.collected_in_window_paise, a.collected_online_in_window_paise,
            a.activated_at, a.computed_at
     from organizations o
     left join org_activation a on a.organization_id = o.id
     order by o.created_at desc`
  );

  const activation: OrgActivationRow[] = orgsRes.rows.map((r) => {
    const snapshot: ActivationSnapshot = {
      firstClassAt: iso(r.first_class_at),
      firstAttendanceAt: iso(r.first_attendance_at),
      sessionsAttendedInWindow: Number(r.sessions_attended_in_window ?? 0),
      activatedAt: iso(r.activated_at),
    };
    return {
      organizationId: r.id,
      name: r.name,
      status: r.status,
      signupAt: iso(r.created_at)!,
      windowEndsAt: iso(r.window_ends_at) ?? new Date(new Date(r.created_at).getTime() + ACTIVATION.windowDays * 86400000).toISOString(),
      collectedInWindowPaise: Number(r.collected_in_window_paise ?? 0),
      collectedOnlineInWindowPaise: Number(r.collected_online_in_window_paise ?? 0),
      firstCollectedAt: iso(r.first_collected_at),
      ...snapshot,
      stage: orgStage(snapshot),
    };
  });
  const activationByOrg = new Map<string, ActivationSnapshot>(activation.map((a) => [a.organizationId, a]));
  const rolledUpAt = orgsRes.rows.reduce<string | null>((max, r) => {
    const t = iso(r.computed_at);
    return t && (!max || t > max) ? t : max;
  }, null);

  // Onboarding funnel: each person's highest beat, and the org their
  // onboarding created (org.created's actor), if any.
  const startersRes = await pool.query(
    `select b.actor_user_id, b.max_beat, b.first_seen, c.organization_id
     from (
       select actor_user_id, max((properties ->> 'beat')::int) as max_beat, min(occurred_at) as first_seen
       from product_events
       where name = 'onboarding.beat_viewed' and actor_user_id is not null
       group by actor_user_id
     ) b
     left join lateral (
       select organization_id from product_events
       where name = 'org.created' and actor_user_id = b.actor_user_id
       order by occurred_at limit 1
     ) c on true`
  );
  const starterStages = startersRes.rows.map((r) =>
    starterStage({ maxBeat: Number(r.max_beat), organizationId: r.organization_id ?? null }, activationByOrg)
  );
  const trackedSince = startersRes.rows.reduce<string | null>((min, r) => {
    const t = iso(r.first_seen);
    return t && (!min || t < min) ? t : min;
  }, null);

  // Rupees collected per org per month, each org's months in its own zone.
  const months = lastMonthKeys(now, MONTHS_SHOWN, DEFAULT_ORG_TIMEZONE);
  const monthlyRes = await pool.query(
    `select c.organization_id, to_char(c.at at time zone o.timezone, 'YYYY-MM') as month,
            sum(c.paise) as total, coalesce(sum(c.paise) filter (where c.online), 0) as online
     from (${ALL_ORGS_COLLECTIONS_SINCE_SQL}) c
     join organizations o on o.id = c.organization_id
     group by 1, 2`,
    [new Date(now.getTime() - (MONTHS_SHOWN + 1) * 31 * 86400000).toISOString()]
  );
  const monthlyRows = monthlyRes.rows.map((r) => ({
    organizationId: r.organization_id as string, month: r.month as string, collectedPaise: Number(r.total), onlinePaise: Number(r.online),
  }));

  const currentWeek = weekStartInZone(now, DEFAULT_ORG_TIMEZONE);
  const fromWeek = addDaysToDateKey(currentWeek, -21);
  const weeklyRes = await pool.query(
    `select organization_id, to_char(week_start, 'YYYY-MM-DD') as week_start,
            sessions_scheduled, sessions_attended, attendance_marked, invoices_raised, messages_delivered,
            collected_paise, collected_online_paise, parent_portal_opens, parent_payments_started
     from org_weekly_loop`
  );

  const nameById = new Map<string, string>(orgsRes.rows.map((r) => [r.id, r.name]));
  const loopByOrg = new Map<string, LoopTotals>();
  for (const w of weeklyRes.rows) {
    if (w.week_start < fromWeek || w.week_start > currentWeek) continue;
    const t = loopByOrg.get(w.organization_id) ?? {
      organizationId: w.organization_id, name: nameById.get(w.organization_id) ?? "",
      sessionsScheduled: 0, sessionsAttended: 0, attendanceMarked: 0, invoicesRaised: 0, messagesDelivered: 0,
      collectedPaise: 0, onlinePaise: 0, parentPortalOpens: 0, parentPaymentsStarted: 0,
    };
    t.sessionsScheduled += Number(w.sessions_scheduled);
    t.sessionsAttended += Number(w.sessions_attended);
    t.attendanceMarked += Number(w.attendance_marked);
    t.invoicesRaised += Number(w.invoices_raised);
    t.messagesDelivered += Number(w.messages_delivered);
    t.collectedPaise += Number(w.collected_paise);
    t.onlinePaise += Number(w.collected_online_paise);
    t.parentPortalOpens += Number(w.parent_portal_opens);
    t.parentPaymentsStarted += Number(w.parent_payments_started);
    loopByOrg.set(w.organization_id, t);
  }

  const cohortRows = computeRetentionCohorts(
    orgsRes.rows.map((r) => ({
      organizationId: r.id,
      signupWeek: weekStartInZone(new Date(r.created_at), r.timezone || DEFAULT_ORG_TIMEZONE),
    })),
    weeklyRes.rows.map((w) => ({ organizationId: w.organization_id, weekStart: w.week_start, sessionsAttended: Number(w.sessions_attended) })),
    currentWeek,
    COHORT_WEEKS
  );

  const featureRes = await pool.query(
    `select properties ->> 'feature' as feature, count(*) as opens, count(distinct organization_id) as orgs
     from product_events
     where name = 'feature.opened' and occurred_at >= now() - interval '28 days'
     group by 1 order by 2 desc`
  );

  return {
    generatedAt: now.toISOString(),
    rolledUpAt,
    activationDefinition: ACTIVATION,
    onboardingFunnel: { trackedSince, steps: computeFunnel(starterStages, 1) },
    orgFunnel: computeFunnel(activation.map((a) => a.stage), 4),
    activation,
    monthlyCollected: {
      months,
      orgs: pivotMonthlyCollected(orgsRes.rows.map((r) => ({ organizationId: r.id, name: r.name })), monthlyRows, months),
    },
    loopLastFourWeeks: {
      fromWeek,
      toWeek: currentWeek,
      orgs: [...loopByOrg.values()].sort((a, b) => b.sessionsAttended - a.sessionsAttended || a.name.localeCompare(b.name)),
    },
    cohorts: { currentWeek, rows: cohortRows },
    featureUsage: featureRes.rows.map((r) => ({ feature: r.feature, opens: Number(r.opens), orgs: Number(r.orgs) })),
  };
}
