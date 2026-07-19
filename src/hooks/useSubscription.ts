import { useCallback, useEffect, useState } from "react";
import { getSubscription, checkoutSubscription } from "../lib/api";
import type { SubscriptionResponse } from "../../shared/schemas/subscription";
import type { PlanId } from "../lib/subscription";

// No Realtime subscription: plan changes only happen via checkout (this
// session) or the platform webhook (inert until live wiring, HANDOFF §17.1),
// neither of which needs a live-updating view — refetch after a checkout
// action is enough.
export function useSubscription() {
  const [data, setData] = useState<SubscriptionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refetch = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getSubscription();
      setData(res);
    } catch (err: any) {
      setError(err?.message || "Failed to load subscription");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refetch();
  }, [refetch]);

  const upgrade = useCallback(async (plan: PlanId) => {
    const result = await checkoutSubscription(plan);
    await refetch();
    return result;
  }, [refetch]);

  return { subscription: data, loading, error, refetch, upgrade };
}
