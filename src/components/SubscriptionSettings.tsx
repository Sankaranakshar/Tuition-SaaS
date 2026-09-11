import { useState } from "react";
import { toast } from "sonner";
import { CreditCard, AlertTriangle } from "lucide-react";
import { useSubscription } from "../hooks/useSubscription";
import {
  PLAN_CATALOG,
  isNearLimit,
  isOverLimit,
  formatPlanPrice,
  upgradeOptions,
} from "../lib/subscription";
import { Skeleton, StatusChip, CapacityMeter, Button } from "./kit";

// Stage 3 SaaS subscription billing panel (DEV_PLAN §5). Upgrade is built to
// completion but degrades to a manual-contact message until a platform
// Razorpay account is connected (HANDOFF §17.1) — see useSubscription.upgrade
// / server/routes/subscription.ts's checkout route.
export default function SubscriptionSettings() {
  const { subscription, loading, error, upgrade } = useSubscription();
  const [upgrading, setUpgrading] = useState<string | null>(null);

  if (loading) {
    return (
      <div className="space-y-3 rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-6">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (error || !subscription) {
    return (
      <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-6 text-sm text-[var(--cs-text-muted)]">
        {error || "Couldn't load your plan."}
      </div>
    );
  }

  const plan = PLAN_CATALOG[subscription.plan];
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
    <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
      <div className="border-b border-[var(--cs-border)] px-4 py-3">
        <h2 className="text-sm font-semibold text-[var(--cs-text)]">Plan & billing</h2>
        <p className="mt-1 text-xs text-[var(--cs-text-muted)]">Your current plan and active-student usage.</p>
      </div>

      <div className="space-y-6 p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="rounded-[var(--cs-radius-control)] bg-[var(--cs-accent-soft)] p-2">
              <CreditCard className="h-6 w-6 text-[var(--cs-accent)]" strokeWidth={1.75} />
            </div>
            <div>
              <h3 className="text-sm font-medium text-[var(--cs-text)]">{plan.name} plan</h3>
              <p className="text-sm text-[var(--cs-text-muted)]">{formatPlanPrice(subscription.pricePaise)} · {plan.tagline}</p>
            </div>
          </div>
          <StatusChip label={subscription.status} tone="positive" className="capitalize" />
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between text-sm">
            <span className="text-[var(--cs-text-muted)]">Active students</span>
            <span className={over ? "font-medium text-[var(--cs-danger)]" : "font-medium text-[var(--cs-text)]"}>
              {subscription.activeStudentCount}
              {subscription.studentLimit !== null ? ` / ${subscription.studentLimit}` : " (unlimited)"}
            </span>
          </div>
          {subscription.studentLimit !== null && (
            <CapacityMeter filled={subscription.activeStudentCount} capacity={subscription.studentLimit} compact />
          )}
          {over && (
            <p className="mt-2 flex items-center gap-1.5 text-sm text-[var(--cs-danger)]">
              <AlertTriangle className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              You're at your plan's limit. Adding a new student will be blocked until you upgrade.
            </p>
          )}
          {!over && near && (
            <p className="mt-2 text-sm text-[var(--cs-text-muted)]">You're close to your plan's student limit.</p>
          )}
        </div>

        {options.length > 0 && (
          <div className="border-t border-[var(--cs-border)] pt-4">
            <h4 className="mb-3 text-sm font-medium text-[var(--cs-text)]">Upgrade</h4>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {options.map((planId) => {
                const def = PLAN_CATALOG[planId];
                return (
                  <div key={planId} className="flex flex-col justify-between rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] p-4">
                    <div>
                      <p className="text-sm font-medium text-[var(--cs-text)]">{def.name}</p>
                      <p className="text-sm text-[var(--cs-text-muted)]">{def.tagline}</p>
                      <p className="mt-1 text-sm font-medium text-[var(--cs-text-muted)]">{formatPlanPrice(def.pricePaise)}</p>
                    </div>
                    <Button onClick={() => handleUpgrade(planId)} disabled={upgrading !== null} className="mt-3">
                      {upgrading === planId ? "Starting…" : `Upgrade to ${def.name}`}
                    </Button>
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
