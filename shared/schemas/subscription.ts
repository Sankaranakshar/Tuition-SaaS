import { z } from "zod";
import { PLAN_IDS } from "../plans";

// Stage 3 SaaS subscription billing (DEV_PLAN §5) request/response
// contracts for server/routes/subscription.ts. The plan catalog itself
// (PLAN_CATALOG, pricing, display names) lives in shared/plans.ts, which is
// deliberately zod-free — see that file's header for why the split matters
// for client bundle size.

export const subscriptionResponseSchema = z.object({
  plan: z.enum(PLAN_IDS),
  status: z.string(),
  studentLimit: z.number().int().nullable(),
  activeStudentCount: z.number().int(),
  pricePaise: z.number().int(),
  trialEndsAt: z.string().nullable(),
  currentPeriodEnd: z.string().nullable(),
  razorpayConnected: z.boolean(),
});
export type SubscriptionResponse = z.infer<typeof subscriptionResponseSchema>;

export const checkoutRequestSchema = z.object({
  plan: z.enum(PLAN_IDS),
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

// Live wiring deferred (HANDOFF §17.1): without a platform Razorpay
// subscription plan id configured, checkout degrades to a manual-contact
// response instead of a hosted payment page. Same degradation shape used by
// the per-org gateway/invoice flows elsewhere in the app.
export const checkoutResponseSchema = z.union([
  z.object({ degraded: z.literal(true), message: z.string() }),
  z.object({ degraded: z.literal(false), shortUrl: z.string() }),
]);
// Hand-written rather than z.infer'd: a union inferred through z.union() of
// two object schemas doesn't reliably narrow under TS control-flow analysis
// once passed through a generic (api<T>()) — this shape narrows correctly.
export type CheckoutResponse =
  | { degraded: true; message: string }
  | { degraded: false; shortUrl: string };
