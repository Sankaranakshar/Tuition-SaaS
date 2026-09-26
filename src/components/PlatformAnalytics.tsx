import { useEffect, useState, type ReactNode } from "react";
import { BarChart3 } from "lucide-react";
import { getAdminAnalytics } from "../lib/api";
import { formatDate, formatPaise } from "../lib/format";
import { activationStatus, featureLabel, formatCohortCell, formatMonthKey, formatRate } from "../lib/admin";
import type { AnalyticsReport, FunnelStep } from "../../shared/analytics";
import { EmptyState, SkeletonRow } from "./kit";

// C-07 (EXECUTION_PLAN.md Step 32): the platform admin's analytics tab.
// Everything here comes from one call, GET /api/v1/admin/analytics, which
// requires a platform admin server-side. Sections follow MASTER_PLAN.md
// §11's order, except that rupees collected per org per month, the one
// metric that matters, comes first.

const TABLE = "min-w-full divide-y divide-[var(--cs-border)] text-sm";
const THEAD = "bg-[var(--cs-surface-2)] text-left text-xs font-medium uppercase tracking-wide text-[var(--cs-text-muted)]";
const TH = "px-4 py-2 whitespace-nowrap";
const TD = "px-4 py-2 text-[var(--cs-text-muted)] whitespace-nowrap";
const TD_NAME = "px-4 py-2 font-medium text-[var(--cs-text)]";

function Section({ id, title, description, children }: { id: string; title: string; description: string; children: ReactNode }) {
  return (
    <section aria-labelledby={id} className="space-y-2">
      <div>
        <h2 id={id} className="text-[15px] font-semibold text-[var(--cs-text)]">{title}</h2>
        <p className="text-sm text-[var(--cs-text-muted)]">{description}</p>
      </div>
      <div className="overflow-x-auto rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        {children}
      </div>
    </section>
  );
}

function FunnelTable({ steps, caption }: { steps: FunnelStep[]; caption: string }) {
  return (
    <table className={TABLE}>
      <caption className="sr-only">{caption}</caption>
      <thead className={THEAD}>
        <tr><th scope="col" className={TH}>Step</th><th scope="col" className={TH}>Reached</th><th scope="col" className={TH}>Dropped here</th><th scope="col" className={TH}>From previous step</th></tr>
      </thead>
      <tbody className="divide-y divide-[var(--cs-border)]">
        {steps.map((s, i) => (
          <tr key={s.key}>
            <td className={TD_NAME}>{s.label}</td>
            <td className={TD}>{s.count}</td>
            <td className={TD}>{i === 0 ? "–" : s.dropOff}</td>
            <td className={TD}>{formatRate(s.conversionFromPrevious)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function PlatformAnalytics() {
  const [report, setReport] = useState<AnalyticsReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getAdminAnalytics()
      .then((r) => { if (!cancelled) setReport(r); })
      .catch((err) => { if (!cancelled) setError(err?.message || "Failed to load analytics"); });
    return () => { cancelled = true; };
  }, []);

  if (error) {
    return <div className="rounded-[var(--cs-radius-control)] bg-[var(--cs-danger-soft)] p-3 text-sm text-[var(--cs-danger)]">{error}</div>;
  }
  if (!report) {
    return <div className="space-y-2" aria-busy="true">{Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}</div>;
  }

  const now = new Date(report.generatedAt);
  const def = report.activationDefinition;

  return (
    <div className="space-y-8">
      <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface-2)] p-4 text-sm text-[var(--cs-text-muted)]">
        <p>
          <span className="font-medium text-[var(--cs-text)]">Activated</span> means {def.minSessionsAttended} or more sessions with attendance marked,
          and at least {formatPaise(def.minCollectedPaise)} collected through ClassStackr, both within {def.windowDays} days of signup.
          Collected counts every payment and wallet top-up recorded in ClassStackr; the online (Razorpay) share is shown separately.
        </p>
        <p className="mt-1">
          {report.rolledUpAt
            ? `Activation, the weekly loop and cohorts were last computed ${formatDate(report.rolledUpAt)}; the nightly job refreshes them. Rupees per month are live.`
            : "The nightly analytics job has not run yet, so activation, the weekly loop and cohorts are empty. Rupees per month are live."}
        </p>
      </div>

      <Section id="pa-monthly" title="Rupees collected per org per month" description="Payments and wallet top-ups recorded in ClassStackr, by month in each org's timezone.">
        <table className={TABLE}>
          <caption className="sr-only">Rupees collected per organization per month</caption>
          <thead className={THEAD}>
            <tr>
              <th scope="col" className={TH}>Organization</th>
              {report.monthlyCollected.months.map((m) => <th key={m} scope="col" className={TH}>{formatMonthKey(m)}</th>)}
              <th scope="col" className={TH}>Total</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--cs-border)]">
            {report.monthlyCollected.orgs.map((o) => (
              <tr key={o.organizationId}>
                <td className={TD_NAME}>{o.name}</td>
                {o.months.map((c) => (
                  <td key={c.month} className={TD}>
                    {c.collectedPaise > 0 ? formatPaise(c.collectedPaise) : "–"}
                    {c.onlinePaise > 0 && <span className="block text-xs">{formatPaise(c.onlinePaise)} online</span>}
                  </td>
                ))}
                <td className={`${TD} font-medium text-[var(--cs-text)]`}>{formatPaise(o.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </Section>

      <Section id="pa-activation" title="Activation by org" description={`Progress inside each org's first ${def.windowDays} days.`}>
        <table className={TABLE}>
          <caption className="sr-only">Activation status per organization</caption>
          <thead className={THEAD}>
            <tr>
              <th scope="col" className={TH}>Organization</th><th scope="col" className={TH}>Signed up</th>
              <th scope="col" className={TH}>Sessions with attendance</th><th scope="col" className={TH}>Collected</th><th scope="col" className={TH}>Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--cs-border)]">
            {report.activation.map((a) => {
              const status = activationStatus(a, now);
              return (
                <tr key={a.organizationId}>
                  <td className={TD_NAME}>{a.name}{a.status === "offboarded" && <span className="ml-2 text-xs font-normal text-[var(--cs-text-muted)]">offboarded</span>}</td>
                  <td className={TD}>{formatDate(a.signupAt)}</td>
                  <td className={TD}>{a.sessionsAttendedInWindow} of {def.minSessionsAttended}</td>
                  <td className={TD}>{formatPaise(a.collectedInWindowPaise)}{a.collectedOnlineInWindowPaise > 0 && ` (${formatPaise(a.collectedOnlineInWindowPaise)} online)`}</td>
                  <td className={TD}>
                    {status.kind === "activated" && <span className="font-medium text-[var(--cs-accent)]">Activated {formatDate(status.activatedAt)}</span>}
                    {status.kind === "in_window" && `In window, ${status.daysLeft} ${status.daysLeft === 1 ? "day" : "days"} left`}
                    {status.kind === "not_activated" && "Not activated"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </Section>

      <Section
        id="pa-funnel"
        title="Signup to activation funnel"
        description={report.onboardingFunnel.trackedSince
          ? `Everyone who started tutor onboarding since ${formatDate(report.onboardingFunnel.trackedSince)}, followed to activation.`
          : "Everyone who starts tutor onboarding, followed to activation. Nobody has started since tracking began."}
      >
        <FunnelTable steps={report.onboardingFunnel.steps} caption="Signup to activation funnel, per onboarding beat" />
      </Section>

      <Section id="pa-org-funnel" title="Every org, created to activated" description="Includes orgs created before onboarding was tracked.">
        <FunnelTable steps={report.orgFunnel} caption="Organization funnel from creation to activation" />
      </Section>

      <Section
        id="pa-loop"
        title="Weekly loop, last four weeks"
        description={`Weeks starting ${formatDate(report.loopLastFourWeeks.fromWeek)} to ${formatDate(report.loopLastFourWeeks.toWeek)}.`}
      >
        {report.loopLastFourWeeks.orgs.length === 0 ? (
          <EmptyState icon={BarChart3} title="No weekly loop yet" description="It fills in after the nightly analytics job runs." />
        ) : (
          <table className={TABLE}>
            <caption className="sr-only">Weekly loop per organization over the last four weeks</caption>
            <thead className={THEAD}>
              <tr>
                <th scope="col" className={TH}>Organization</th><th scope="col" className={TH}>Sessions scheduled</th>
                <th scope="col" className={TH}>Sessions with attendance</th><th scope="col" className={TH}>Invoices raised</th>
                <th scope="col" className={TH}>Messages delivered</th><th scope="col" className={TH}>Collected</th>
                <th scope="col" className={TH}>Parent portal opens</th><th scope="col" className={TH}>Parent payments started</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--cs-border)]">
              {report.loopLastFourWeeks.orgs.map((o) => (
                <tr key={o.organizationId}>
                  <td className={TD_NAME}>{o.name}</td>
                  <td className={TD}>{o.sessionsScheduled}</td>
                  <td className={TD}>{o.sessionsAttended}</td>
                  <td className={TD}>{o.invoicesRaised}</td>
                  <td className={TD}>{o.messagesDelivered}</td>
                  <td className={TD}>{formatPaise(o.collectedPaise)}</td>
                  <td className={TD}>{o.parentPortalOpens}</td>
                  <td className={TD}>{o.parentPaymentsStarted}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section id="pa-cohorts" title="Retention by signup week" description="Orgs that marked attendance on at least one session in each week after signup (week 0 is the signup week).">
        {report.cohorts.rows.length === 0 ? (
          <EmptyState icon={BarChart3} title="No cohorts yet" description="Nothing has signed up." />
        ) : (
          <table className={TABLE}>
            <caption className="sr-only">Retention cohorts by signup week</caption>
            <thead className={THEAD}>
              <tr>
                <th scope="col" className={TH}>Signup week</th><th scope="col" className={TH}>Orgs</th>
                {report.cohorts.rows[0].retained.map((_, k) => <th key={k} scope="col" className={TH}>Week {k}</th>)}
              </tr>
            </thead>
            <tbody className="divide-y divide-[var(--cs-border)]">
              {report.cohorts.rows.map((c) => (
                <tr key={c.cohortWeek}>
                  <td className={TD_NAME}>{formatDate(c.cohortWeek)}</td>
                  <td className={TD}>{c.size}</td>
                  {c.retained.map((r, k) => <td key={k} className={TD}>{formatCohortCell(r, c.size)}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>

      <Section id="pa-features" title="Feature usage, last 28 days" description="Workspace opens, counted once per person per workspace per day.">
        {report.featureUsage.length === 0 ? (
          <EmptyState icon={BarChart3} title="No feature usage recorded yet" description="Workspace opens are recorded from now on." />
        ) : (
          <table className={TABLE}>
            <caption className="sr-only">Feature usage over the last 28 days</caption>
            <thead className={THEAD}>
              <tr><th scope="col" className={TH}>Workspace</th><th scope="col" className={TH}>Opens</th><th scope="col" className={TH}>Orgs</th></tr>
            </thead>
            <tbody className="divide-y divide-[var(--cs-border)]">
              {report.featureUsage.map((f) => (
                <tr key={f.feature}>
                  <td className={TD_NAME}>{featureLabel(f.feature)}</td>
                  <td className={TD}>{f.opens}</td>
                  <td className={TD}>{f.orgs}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Section>
    </div>
  );
}
