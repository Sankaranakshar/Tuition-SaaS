import express from "express";
import { authenticateToken, type AuthRequest } from "../middleware/auth.ts";
import { trackEvent, utcDayKey } from "../utils/analytics.ts";
import { CLIENT_EVENT_NAMES, validateEventProperties, type ClientEventName, type EventProperties } from "../../shared/analyticsEvents.ts";

// C-07 (EXECUTION_PLAN.md Step 32): the browser's only way to record a
// product event, for the three things no server route sees happen:
// onboarding beats (the three beats are client-side until the final
// submit), a parent opening their portal, and which workspace someone
// opens. The browser never writes product_events itself (that table has no
// client policy); it asks this route, and the route decides what lands:
//   - only the three client event names are accepted, each with the exact
//     payload shared/analyticsEvents.ts allows (the same payload rule every
//     server-side event obeys);
//   - the org and the actor come from the verified session, never from the
//     request body;
//   - each is deduplicated (one per beat per person; one portal open or
//     workspace open per person per day), so a reload loop cannot inflate
//     a count.
const router = express.Router();

router.post("/events", authenticateToken, async (req: AuthRequest, res, next) => {
  try {
    const body = (req.body ?? {}) as { name?: unknown; properties?: unknown };
    const name = typeof body.name === "string" ? body.name : "";
    if (!(CLIENT_EVENT_NAMES as string[]).includes(name)) {
      return res.status(400).json({ error: { code: "unknown_event", message: "Not a client event" } });
    }
    const properties = (body.properties ?? {}) as EventProperties;
    const problem = validateEventProperties(name, properties);
    if (problem) {
      return res.status(400).json({ error: { code: "invalid_properties", message: problem } });
    }

    const userId = req.user!.id;
    // An offboarded org is closed for use (requireOrg's rule), so it records nothing either.
    const orgId = req.user!.organizationStatus === "offboarded" ? null : (req.user!.organizationId ?? null);
    const day = utcDayKey();
    let recorded: Awaited<ReturnType<typeof trackEvent>>;

    switch (name as ClientEventName) {
      case "onboarding.beat_viewed":
        // Pre-org by definition: the org is created on onboarding's final
        // submit. Linked to it later through org.created's actor.
        recorded = await trackEvent({
          organizationId: null, actorUserId: userId, name: "onboarding.beat_viewed", properties,
          dedupeKey: `onboarding.beat_viewed:${userId}:${properties.beat}`,
        });
        break;
      case "parent.portal_opened":
        if (!orgId || req.user!.role !== "parent") {
          return res.status(403).json({ error: { code: "forbidden", message: "Only a parent in an organization can open the parent portal" } });
        }
        recorded = await trackEvent({
          organizationId: orgId, actorUserId: userId, name: "parent.portal_opened",
          dedupeKey: `parent.portal_opened:${orgId}:${userId}:${day}`,
        });
        break;
      case "feature.opened":
        if (!orgId) {
          return res.status(403).json({ error: { code: "no_organization", message: "User does not belong to an organization" } });
        }
        recorded = await trackEvent({
          organizationId: orgId, actorUserId: userId, name: "feature.opened", properties,
          dedupeKey: `feature.opened:${orgId}:${userId}:${properties.feature}:${day}`,
        });
        break;
    }
    res.status(202).json({ ok: true, recorded: recorded! === "recorded" });
  } catch (err) { next(err); }
});

export default router;
