import { useState } from "react";
import { toast } from "sonner";
import { CreditCard, AlertTriangle } from "lucide-react";
import { useSubscription } from "../hooks/useSubscription";
import {
  PLAN_CATALOG,
  usagePercent,
  isNearLimit,
  isOverLimit,
  formatPlanPrice,
  upgradeOptions,
} from "../lib/subscription";
import { Skeleton } from "./kit";

// Stage 3 SaaS subscription billing panel (DEV_PLAN §5). Upgrade is built to
// completion but degrades to a manual-contact message until a platform
// Razorpay account is connected (HANDOFF §17.1) — see useSubscription.upgrade
// / server/routes/subscription.ts's checkout route.
export default function SubscriptionSettings() {
  const { subscription, loading, error, upgrade } = useSubscription();
  const [upgrading, setUpgrading] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="bg-[var(--cs-surface)] rounded-[10px] shadow-sm border border-[var(--cs-border)] p-6 space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (error || !subscription) {
    return (
      <div className="bg-[var(--cs-surface)] rounded-[10px] shadow-sm border border-[var(--cs-border)] p-6 text-sm text-[var(--cs-text-muted)]">
        {error || "Couldn't load your plan."}
      </div>
    );
  }

  const plan = PLAN_CATALOG[subscription.plan];
  const percent = usagePercent(subscription.activeStudentCount, subscription.studentLimit);
  const near = isNearLimit(subscription.activeStudentCount, subscription.studentLimit);
  const over = isOverLimit(subscription.activeStudentCount, subscription.studentLimit);
  const options = upgradeOptions(subscription.plan);

  const handleUpgrade = async (planId: (typeof options)[number]) => {
    setUpgrading(planId);
    try {
      const result = await upgrade(planId);
      if ("shortUrl" in result) {
        window.location.href = result.shortUrl;
      } else {
        toast.info(result.message);
      }
    } catch (err: any) {
      toast.error(err?.message || "Couldn't start the upgrade");
    } finally {
      setUpgrading(null);
    }
  };

  return (
    <div className="bg-[var(--cs-surface)] rounded-[10px] shadow-sm border border-[var(--cs-border)] overflow-hidden">
      <div className="px-6 py-4 border-b border-[var(--cs-border)]">
        <h2 className="text-lg font-semibold text-[var(--cs-text)]">Plan & Billing</h2>
        <p className="mt-1 text-sm text-[var(--cs-text-muted)]">Your current plan and active-student usage.</p>
      </div>

      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-[var(--cs-accent-soft)] rounded-[6px]">
              <CreditCard className="w-6 h-6 text-[var(--cs-accent)]" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-[var(--cs-text)]">{plan.name} plan</h3>
              <p className="text-sm text-[var(--cs-text-muted)]">{formatPlanPrice(subscription.pricePaise)} · {plan.tagline}</p>
            </div>
          </div>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-[var(--cs-ok)] capitalize">
            {subscription.status}
          </span>
        </div>

        <div>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-[var(--cs-text-muted)]">Active students</span>
            <span className={over ? "text-[var(--cs-danger)] font-medium" : near ? "text-[var(--cs-warn)] font-medium" : "text-[var(--cs-text)]"}>
              {subscription.activeStudentCount}
              {subscription.studentLimit !== null ? ` / ${subscription.studentLimit}` : " (unlimited)"}
            </span>
          </div>
          {subscription.studentLimit !== null && (
            <div className="h-2 rounded-full bg-[var(--cs-bg)] overflow-hidden">
              <div
                className={`h-full rounded-full ${over ? "bg-[var(--cs-danger)]" : near ? "bg-[var(--cs-warn)]" : "bg-[var(--cs-accent)]"}`}
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
          {over && (
            <p className="mt-2 text-sm text-[var(--cs-danger)] flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              You're at your plan's limit — adding a new student will be blocked until you upgrade.
            </p>
          )}
          {!over && near && (
            <p className="mt-2 text-sm text-[var(--cs-warn)]">You're close to your plan's student limit.</p>
          )}
        </div>

        {options.length > 0 && (
          <div className="border-t border-[var(--cs-border)] pt-4">
            <h4 className="text-sm font-medium text-[var(--cs-text)] mb-3">Upgrade</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {options.map((planId) => {
                const def = PLAN_CATALOG[planId];
                return (
                  <div key={planId} className="border border-[var(--cs-border)] rounded-[6px] p-4 flex flex-col justify-between">
                    <div>
                      <p className="text-sm font-medium text-[var(--cs-text)]">{def.name}</p>
                      <p className="text-sm text-[var(--cs-text-muted)]">{def.tagline}</p>
                      <p className="mt-1 text-sm font-medium text-[var(--cs-text-muted)]">{formatPlanPrice(def.pricePaise)}</p>
                    </div>
                    <button
                      onClick={() => handleUpgrade(planId)}
                      disabled={upgrading !== null}
                      className="mt-3 inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-[6px] text-white bg-[var(--cs-accent)] hover:opacity-90 disabled:opacity-50"
                    >
                      {upgrading === planId ? "Starting..." : `Upgrade to ${def.name}`}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
