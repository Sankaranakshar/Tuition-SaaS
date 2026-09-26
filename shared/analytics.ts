// C-07 (EXECUTION_PLAN.md Step 32): the pure computations behind activation
// analytics. No IO: the analytics-rollup cron (server/routes/cron.ts) and
// GET /api/v1/admin/analytics (server/routes/admin.ts) fetch rows and hand
// them here, and tests/unit/analytics.test.ts pins every rule below.
// Zod-free, like shared/analyticsEvents.ts.

import { localDateKeyInZone } from "./timezone.ts";

/**
 * Activation, exactly as MASTER_PLAN.md §11 defines it: an org that has
 * marked attendance on 10 or more sessions AND collected at least one
 * rupee through ClassStackr, both within 14 days of signup.
 *
 * - Signup is the org's creation (organizations.created_at): the moment
 *   onboarding's final submit bootstraps it.
 * - A session counts once attendance is marked for at least one student and
 *   not every mark on it has been reversed, at the time of its first mark.
 * - Collected means money recorded in the ClassStackr ledger: invoice
 *   payments (manual and Razorpay) plus wallet top-ups. Overpayment credit is
 *   not counted twice (it is part of the payment that caused it). The online
 *   (Razorpay) share is tracked separately; see Step 32's Decisions for why
 *   manual payments count.
 */
export const ACTIVATION = {
  windowDays: 14,
  minSessionsAttended: 10,
  minCollectedPaise: 100,
} as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export interface Collection {
  at: string;
  paise: number;
  online: boolean;
}

export interface ActivationInput {
  signupAt: string;
  /** Earliest class_sessions.created_at for the org, or null. */
  firstClassAt: string | null;
  /** One entry per session with live (unreversed) attendance: when it was first marked. Any order. */
  sessionFirstMarkedAt: string[];
  collections: Collection[];
}

export interface ActivationResult {
  signupAt: string;
  windowEndsAt: string;
  firstClassAt: string | null;
  firstAttendanceAt: string | null;
  sessionsAttendedInWindow: number;
  tenthSessionAttendedAt: string | null;
  firstCollectedAt: string | null;
  collectedInWindowPaise: number;
  collectedOnlineInWindowPaise: number;
  activatedAt: string | null;
}

const iso = (ms: number) => new Date(ms).toISOString();

export function computeActivation(input: ActivationInput): ActivationResult {
  const signupMs = new Date(input.signupAt).getTime();
  const windowEndMs = signupMs + ACTIVATION.windowDays * DAY_MS;
  const inWindow = (ms: number) => ms <= windowEndMs;

  const marks = input.sessionFirstMarkedAt.map((t) => new Date(t).getTime()).sort((a, b) => a - b);
  const tenthMs = marks.length >= ACTIVATION.minSessionsAttended ? marks[ACTIVATION.minSessionsAttended - 1] : null;

  // "First rupee collected" is the moment the running total first reaches
  // one rupee, not the first row: a ₹0 row never counts.
  const collections = [...input.collections]
    .filter((c) => c.paise > 0)
    .map((c) => ({ ms: new Date(c.at).getTime(), paise: c.paise, online: c.online }))
    .sort((a, b) => a.ms - b.ms);
  let running = 0;
  let firstCollectedMs: number | null = null;
  let collectedInWindow = 0;
  let collectedOnlineInWindow = 0;
  for (const c of collections) {
    running += c.paise;
    if (firstCollectedMs === null && running >= ACTIVATION.minCollectedPaise) firstCollectedMs = c.ms;
    if (inWindow(c.ms)) {
      collectedInWindow += c.paise;
      if (c.online) collectedOnlineInWindow += c.paise;
    }
  }

  const activated =
    tenthMs !== null && inWindow(tenthMs) &&
    firstCollectedMs !== null && inWindow(firstCollectedMs);

  return {
    signupAt: iso(signupMs),
    windowEndsAt: iso(windowEndMs),
    firstClassAt: input.firstClassAt ? iso(new Date(input.firstClassAt).getTime()) : null,
    firstAttendanceAt: marks.length ? iso(marks[0]) : null,
    sessionsAttendedInWindow: marks.filter(inWindow).length,
    tenthSessionAttendedAt: tenthMs !== null ? iso(tenthMs) : null,
    firstCollectedAt: firstCollectedMs !== null ? iso(firstCollectedMs) : null,
    collectedInWindowPaise: collectedInWindow,
    collectedOnlineInWindowPaise: collectedOnlineInWindow,
    activatedAt: activated ? iso(Math.max(tenthMs!, firstCollectedMs!)) : null,
  };
}

/** Whole days from signup to activation, for the org.activated event. */
export function daysToActivate(r: ActivationResult): number | null {
  if (!r.activatedAt) return null;
  return Math.floor((new Date(r.activatedAt).getTime() - new Date(r.signupAt).getTime()) / DAY_MS);
}

// ---------------------------------------------------------------------
// Funnel. Every entity (a person who started onboarding, or an org) has a
// furthest stage reached; a step's count is everyone at that stage or
// beyond, so the funnel can only narrow and drop-off is never negative.
// ---------------------------------------------------------------------

export const FUNNEL_STAGES = [
  { stage: 1, key: "beat_1", label: "Started onboarding (beat 1: solo or centre)" },
  { stage: 2, key: "beat_2", label: "Reached beat 2 (first class)" },
  { stage: 3, key: "beat_3", label: "Reached beat 3 (add students)" },
  { stage: 4, key: "org_created", label: "Finished onboarding (org created)" },
  { stage: 5, key: "first_class", label: "First class scheduled" },
  { stage: 6, key: "first_attendance", label: "First attendance marked" },
  { stage: 7, key: "ten_sessions", label: "10 sessions with attendance, within 14 days" },
  { stage: 8, key: "activated", label: "Activated: and at least ₹1 collected, within 14 days" },
] as const;

export type ActivationSnapshot = Pick<
  ActivationResult,
  "firstClassAt" | "firstAttendanceAt" | "sessionsAttendedInWindow" | "activatedAt"
>;

/** The furthest org-side stage (4 to 8) an org has reached. */
export function orgStage(a: ActivationSnapshot): number {
  if (a.activatedAt) return 8;
  if (a.sessionsAttendedInWindow >= ACTIVATION.minSessionsAttended) return 7;
  if (a.firstAttendanceAt) return 6;
  if (a.firstClassAt) return 5;
  return 4;
}

export interface OnboardingStarter {
  /** Highest onboarding beat seen for this person (1 to 3). */
  maxBeat: number;
  /** The org their onboarding created, once it exists. */
  organizationId: string | null;
}

/** The furthest stage (1 to 8) a person who started onboarding has reached. */
export function starterStage(s: OnboardingStarter, activationByOrg: Map<string, ActivationSnapshot>): number {
  if (s.organizationId) {
    const a = activationByOrg.get(s.organizationId);
    return a ? orgStage(a) : 4;
  }
  return Math.max(1, Math.min(3, s.maxBeat));
}

export interface FunnelStep {
  key: string;
  label: string;
  count: number;
  /** How many reached the previous step but not this one. 0 for the first step. */
  dropOff: number;
  /** count / previous step's count, or null when the previous step is empty. */
  conversionFromPrevious: number | null;
}

export function computeFunnel(stagesReached: number[], fromStage = 1): FunnelStep[] {
  const steps = FUNNEL_STAGES.filter((s) => s.stage >= fromStage);
  let prev: number | null = null;
  return steps.map((s) => {
    const count = stagesReached.filter((r) => r >= s.stage).length;
    const step: FunnelStep = {
      key: s.key,
      label: s.label,
      count,
      dropOff: prev === null ? 0 : prev - count,
      conversionFromPrevious: prev === null ? null : prev === 0 ? null : count / prev,
    };
    prev = count;
    return step;
  });
}

// ---------------------------------------------------------------------
// Weeks and months, in an org's own timezone.
// ---------------------------------------------------------------------

/** YYYY-MM-DD plus `days`, calendar arithmetic only (no timezone involved). */
export function addDaysToDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** The Monday (YYYY-MM-DD) starting the week that contains `instant`, as seen in `zone`. */
export function weekStartInZone(instant: Date, zone: string): string {
  const key = localDateKeyInZone(instant, zone);
  const [y, m, d] = key.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  return addDaysToDateKey(key, -((dow + 6) % 7));
}

/** The last `n` month keys (YYYY-MM), oldest first, ending with the month containing `now` in `zone`. */
export function lastMonthKeys(now: Date, n: number, zone: string): string[] {
  const [y, m] = localDateKeyInZone(now, zone).split("-").map(Number);
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(Date.UTC(y, m - 1 - i, 1));
    out.push(d.toISOString().slice(0, 7));
  }
  return out;
}

// ---------------------------------------------------------------------
// Retention cohorts, by signup week, measured on the weekly loop rather
// than on login (MASTER_PLAN.md §11 item 3): an org is retained in a week
// when it marked attendance on at least one session that week.
// ---------------------------------------------------------------------

export interface WeeklyLoopRow {
  organizationId: string;
  weekStart: string;
  sessionsAttended: number;
}

export interface CohortRow {
  cohortWeek: string;
  size: number;
  /** One entry per week offset from signup (0 = the signup week). null = that week has not happened yet. */
  retained: (number | null)[];
}

export function computeRetentionCohorts(
  orgs: { organizationId: string; signupWeek: string }[],
  weekly: WeeklyLoopRow[],
  currentWeek: string,
  maxOffset = 8
): CohortRow[] {
  const active = new Set(weekly.filter((w) => w.sessionsAttended > 0).map((w) => `${w.organizationId}|${w.weekStart}`));
  const byCohort = new Map<string, string[]>();
  for (const o of orgs) {
    const list = byCohort.get(o.signupWeek) ?? [];
    list.push(o.organizationId);
    byCohort.set(o.signupWeek, list);
  }
  return [...byCohort.entries()]
    .sort(([a], [b]) => (a < b ? 1 : a > b ? -1 : 0))
    .map(([cohortWeek, ids]) => ({
      cohortWeek,
      size: ids.length,
      retained: Array.from({ length: maxOffset + 1 }, (_, k) => {
        const week = addDaysToDateKey(cohortWeek, 7 * k);
        if (week > currentWeek) return null;
        return ids.filter((id) => active.has(`${id}|${week}`)).length;
      }),
    }));
}

// ---------------------------------------------------------------------
// Rupees collected per org per month: the one metric that matters
// (MASTER_PLAN.md §11).
// ---------------------------------------------------------------------

export interface MonthlyCollectedRow {
  organizationId: string;
  month: string;
  collectedPaise: number;
  onlinePaise: number;
}

export interface OrgMonthlyCollected {
  organizationId: string;
  name: string;
  months: { month: string; collectedPaise: number; onlinePaise: number }[];
  totalPaise: number;
}

export function pivotMonthlyCollected(
  orgs: { organizationId: string; name: string }[],
  rows: MonthlyCollectedRow[],
  months: string[]
): OrgMonthlyCollected[] {
  const cell = new Map(rows.map((r) => [`${r.organizationId}|${r.month}`, r]));
  return orgs
    .map((o) => {
      const cells = months.map((month) => {
        const r = cell.get(`${o.organizationId}|${month}`);
        return { month, collectedPaise: r?.collectedPaise ?? 0, onlinePaise: r?.onlinePaise ?? 0 };
      });
      return { organizationId: o.organizationId, name: o.name, months: cells, totalPaise: cells.reduce((s, c) => s + c.collectedPaise, 0) };
    })
    .sort((a, b) => b.totalPaise - a.totalPaise || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------
// GET /api/v1/admin/analytics's response (platform admins only).
// ---------------------------------------------------------------------

export interface OrgActivationRow {
  organizationId: string;
  name: string;
  status: string;
  signupAt: string;
  windowEndsAt: string;
  sessionsAttendedInWindow: number;
  collectedInWindowPaise: number;
  collectedOnlineInWindowPaise: number;
  firstClassAt: string | null;
  firstAttendanceAt: string | null;
  firstCollectedAt: string | null;
  activatedAt: string | null;
  stage: number;
}

export interface LoopTotals {
  organizationId: string;
  name: string;
  sessionsScheduled: number;
  sessionsAttended: number;
  attendanceMarked: number;
  invoicesRaised: number;
  messagesDelivered: number;
  collectedPaise: number;
  parentPortalOpens: number;
  parentPaymentsStarted: number;
  onlinePaise: number;
}

export interface AnalyticsReport {
  generatedAt: string;
  /** When the rollup last ran (the newest org_activation.computed_at), or null if it never has. */
  rolledUpAt: string | null;
  activationDefinition: typeof ACTIVATION;
  /** Everyone who started tutor onboarding since tracking began, followed to activation. */
  onboardingFunnel: { trackedSince: string | null; steps: FunnelStep[] };
  /** Every org, from creation to activation (includes orgs created before tracking began). */
  orgFunnel: FunnelStep[];
  activation: OrgActivationRow[];
  monthlyCollected: { months: string[]; orgs: OrgMonthlyCollected[] };
  /** The weekly loop summed over the last four weeks, per org. */
  loopLastFourWeeks: { fromWeek: string; toWeek: string; orgs: LoopTotals[] };
  cohorts: { currentWeek: string; rows: CohortRow[] };
  /** Workspace opens over the last 28 days, one per person per workspace per day. */
  featureUsage: { feature: string; opens: number; orgs: number }[];
}
