// Plan catalog only — deliberately zero dependencies (no zod). Both the
// server and the client import PLAN_CATALOG as a real runtime value (to
// display pricing/limits), and unlike shared/schemas/*.ts (which the client
// only ever imports `type`s from, keeping zod's runtime out of the client
// bundle), this value needs to actually ship to the browser. Keeping it
// zod-free means importing it doesn't drag zod into the client bundle too.
// shared/schemas/subscription.ts imports PLAN_IDS from here to build its
// zod contracts; it stays the source of truth for those.

export const PLAN_IDS = ["free", "growth", "scale"] as const;
export type PlanId = (typeof PLAN_IDS)[number];

export interface PlanDefinition {
  id: PlanId;
  name: string;
  studentLimit: number | null; // null = unlimited
  pricePaise: number; // per month
  tagline: string;
}

// Pricing follows GO_TO_MARKET_BLUEPRINT.md's "free up to 15 students, then
// slab pricing" recommendation. Tune before go-to-market; nothing else in
// the codebase hardcodes these numbers.
export const PLAN_CATALOG: Record<PlanId, PlanDefinition> = {
  free: {
    id: "free",
    name: "Free",
    studentLimit: 15,
    pricePaise: 0,
    tagline: "Up to 15 active students",
  },
  growth: {
    id: "growth",
    name: "Growth",
    studentLimit: 60,
    pricePaise: 149900, // ₹1,499/mo
    tagline: "Up to 60 active students",
  },
  scale: {
    id: "scale",
    name: "Scale",
    studentLimit: null,
    pricePaise: 399900, // ₹3,999/mo
    tagline: "Unlimited students",
  },
};

export function isPlanId(value: string): value is PlanId {
  return (PLAN_IDS as readonly string[]).includes(value);
}
