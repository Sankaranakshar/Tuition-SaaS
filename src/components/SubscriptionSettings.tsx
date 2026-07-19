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
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 space-y-3">
        <Skeleton className="h-6 w-40" />
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-2/3" />
      </div>
    );
  }

  if (error || !subscription) {
    return (
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 p-6 text-sm text-gray-500">
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
    <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
      <div className="px-6 py-4 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900">Plan & Billing</h2>
        <p className="mt-1 text-sm text-gray-500">Your current plan and active-student usage.</p>
      </div>

      <div className="p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-indigo-50 rounded-lg">
              <CreditCard className="w-6 h-6 text-indigo-600" />
            </div>
            <div>
              <h3 className="text-sm font-medium text-gray-900">{plan.name} plan</h3>
              <p className="text-sm text-gray-500">{formatPlanPrice(subscription.pricePaise)} · {plan.tagline}</p>
            </div>
          </div>
          <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 capitalize">
            {subscription.status}
          </span>
        </div>

        <div>
          <div className="flex items-center justify-between text-sm mb-1">
            <span className="text-gray-600">Active students</span>
            <span className={over ? "text-red-600 font-medium" : near ? "text-amber-600 font-medium" : "text-gray-900"}>
              {subscription.activeStudentCount}
              {subscription.studentLimit !== null ? ` / ${subscription.studentLimit}` : " (unlimited)"}
            </span>
          </div>
          {subscription.studentLimit !== null && (
            <div className="h-2 rounded-full bg-gray-100 overflow-hidden">
              <div
                className={`h-full rounded-full ${over ? "bg-red-500" : near ? "bg-amber-500" : "bg-indigo-500"}`}
                style={{ width: `${percent}%` }}
              />
            </div>
          )}
          {over && (
            <p className="mt-2 text-sm text-red-600 flex items-center gap-1.5">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              You're at your plan's limit — adding a new student will be blocked until you upgrade.
            </p>
          )}
          {!over && near && (
            <p className="mt-2 text-sm text-amber-600">You're close to your plan's student limit.</p>
          )}
        </div>

        {options.length > 0 && (
          <div className="border-t border-gray-100 pt-4">
            <h4 className="text-sm font-medium text-gray-900 mb-3">Upgrade</h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {options.map((planId) => {
                const def = PLAN_CATALOG[planId];
                return (
                  <div key={planId} className="border border-gray-200 rounded-lg p-4 flex flex-col justify-between">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{def.name}</p>
                      <p className="text-sm text-gray-500">{def.tagline}</p>
                      <p className="mt-1 text-sm font-medium text-gray-700">{formatPlanPrice(def.pricePaise)}</p>
                    </div>
                    <button
                      onClick={() => handleUpgrade(planId)}
                      disabled={upgrading !== null}
                      className="mt-3 inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
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
