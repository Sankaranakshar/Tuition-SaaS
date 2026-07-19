import express from "express";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";
import { PLAN_CATALOG, isPlanId } from "../../shared/plans.ts";
import { checkoutRequestSchema, type SubscriptionResponse } from "../../shared/schemas/subscription.ts";

// Stage 3 SaaS subscription billing (DEV_PLAN §5). This is the platform's
// own billing (ClassStackr charging the org), distinct from
// server/routes/gateway.ts (the org's own Razorpay account, for collecting
// fees from its students). Live wiring — a real platform Razorpay account —
// is deferred per HANDOFF §17.1; checkout is built to completion and
// degrades to a manual-contact response until PLATFORM_RAZORPAY_KEY_ID is set.

const router = express.Router();
router.use(authenticateToken, requireOrg);

router.get("/", requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const { data: sub, error } = await supabaseAdmin
      .from("subscriptions")
      .select("plan, status, student_limit, price_paise, trial_ends_at, current_period_end")
      .eq("organization_id", orgId)
      .maybeSingle();
    if (error) throw error;

    const { count, error: countErr } = await supabaseAdmin
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("organization_id", orgId)
      .eq("is_deleted", false)
      .eq("status", "active");
    if (countErr) throw countErr;

    const plan = (sub?.plan && isPlanId(sub.plan) ? sub.plan : "free") as SubscriptionResponse["plan"];
    const body: SubscriptionResponse = {
      plan,
      status: sub?.status || "active",
      studentLimit: sub?.student_limit ?? PLAN_CATALOG[plan].studentLimit,
      activeStudentCount: count || 0,
      pricePaise: sub?.price_paise ?? PLAN_CATALOG[plan].pricePaise,
      trialEndsAt: sub?.trial_ends_at ?? null,
      currentPeriodEnd: sub?.current_period_end ?? null,
      razorpayConnected: Boolean(process.env.PLATFORM_RAZORPAY_KEY_ID),
    };
    res.json(body);
  } catch (err) { next(err); }
});

// Upgrade/downgrade. With no platform Razorpay account connected yet, this
// degrades to a clear manual-contact message rather than a broken checkout —
// the same degradation shape the per-org gateway/invoice flows already use
// elsewhere (see gateway.ts, ParentPortal's Pay Now).
router.post("/checkout", requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    const { plan } = checkoutRequestSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const target = PLAN_CATALOG[plan];

    if (!process.env.PLATFORM_RAZORPAY_KEY_ID || !process.env.PLATFORM_RAZORPAY_PLAN_IDS) {
      await writeAudit(orgId, req.user!.id, "subscription.checkout_requested_degraded", "subscriptions", orgId, { plan });
      return res.json({
        degraded: true,
        message: `Upgrading to ${target.name} isn't self-serve yet. Email us and we'll switch your plan by hand.`,
      });
    }

    // Live path: create/reuse a Razorpay Subscription against the platform
    // account and return its hosted short_url. Not reachable until
    // PLATFORM_RAZORPAY_KEY_ID/PLATFORM_RAZORPAY_PLAN_IDS are set — the code
    // is complete now so switching it on at go-to-market needs no rewrite.
    const planIds = JSON.parse(process.env.PLATFORM_RAZORPAY_PLAN_IDS) as Record<string, string>;
    const razorpayPlanId = planIds[plan];
    if (!razorpayPlanId) {
      return res.status(500).json({ error: { code: "plan_not_configured", message: `No Razorpay plan id configured for ${plan}` } });
    }
    const authHeader = "Basic " + Buffer.from(`${process.env.PLATFORM_RAZORPAY_KEY_ID}:${process.env.PLATFORM_RAZORPAY_KEY_SECRET}`).toString("base64");
    const rzpRes = await fetch("https://api.razorpay.com/v1/subscriptions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: authHeader },
      body: JSON.stringify({
        plan_id: razorpayPlanId,
        total_count: 120, // 10 years of monthly cycles; cancel/change anytime
        notes: { organizationId: orgId, targetPlan: plan },
      }),
    });
    const json = (await rzpRes.json().catch(() => ({}))) as any;
    if (!rzpRes.ok) {
      const message = json?.error?.description || `Razorpay error ${rzpRes.status}`;
      throw Object.assign(new Error(message), { status: 502, code: "gateway_error" });
    }
    await supabaseAdmin
      .from("subscriptions")
      .update({ razorpay_subscription_id: json.id, updated_at: new Date().toISOString() })
      .eq("organization_id", orgId);
    await writeAudit(orgId, req.user!.id, "subscription.checkout_created", "subscriptions", orgId, { plan, razorpaySubscriptionId: json.id });
    res.json({ degraded: false, shortUrl: json.short_url });
  } catch (err) { next(err); }
});

export default router;
