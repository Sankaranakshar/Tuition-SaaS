// C-07 (EXECUTION_PLAN.md Step 32): the product-event catalogue and its
// payload rule. Zod-free on purpose: src/lib/api.ts imports the client
// event names from here, and a Zod import would drag Zod into the browser
// bundle (HANDOFF §6).
//
// THE PAYLOAD RULE. An event's properties may hold only:
//   - ids of records (a session, an invoice), never of a person;
//   - non-negative integer counts and paise amounts;
//   - booleans;
//   - a value from a fixed list declared below.
// Never a name, phone, email, message text or any other free text, and
// never a student or parent id. Every event lists the exact keys it may
// carry; an unknown event, an unknown key, or a value of the wrong kind is
// refused by validateEventProperties() and the event is not written. Since
// the only strings that can pass are uuids and the fixed values below, no
// minor's personal data can reach product_events by construction.
// server/utils/analytics.ts runs this check before every insert.

type PropSpec =
  | { kind: "uuid" }
  | { kind: "int"; min?: number; max?: number }
  | { kind: "bool" }
  | { kind: "enum"; values: readonly string[] };

interface EventSpec {
  /** Accepted from the browser via POST /api/v1/analytics/events. Everything else is server-emitted only. */
  client?: true;
  props: Record<string, PropSpec>;
  required?: readonly string[];
}

const uuid = { kind: "uuid" } as const;
const count = { kind: "int", min: 0, max: 1_000_000 } as const;
const paise = { kind: "int", min: 0, max: 100_000_000_00 } as const;

export const PAYMENT_METHODS = ["cash", "upi", "bank_transfer", "cheque", "other"] as const;

/** Workspaces whose opening is counted as feature usage (MASTER_PLAN.md §11 item 5). */
export const FEATURE_KEYS = [
  "today", "people", "student_story", "money", "inbox", "schedule",
  "settings", "audit_log", "documents", "courses", "preferences", "profile",
] as const;
export type FeatureKey = (typeof FEATURE_KEYS)[number];

export const EVENT_SPECS = {
  // 1. Signup-to-activation funnel.
  "onboarding.beat_viewed": {
    client: true,
    props: { beat: { kind: "int", min: 1, max: 3 }, mode: { kind: "enum", values: ["solo", "center"] } },
    required: ["beat"],
  },
  "org.created": { props: {} },
  "sessions.materialized": { props: { sessionsCreated: count }, required: ["sessionsCreated"] },
  "org.activated": {
    props: { sessionsAttended: count, collectedPaise: paise, daysToActivate: { kind: "int", min: 0, max: 14 } },
    required: ["sessionsAttended", "collectedPaise", "daysToActivate"],
  },
  // 2. The weekly loop.
  "attendance.marked": {
    props: { sessionId: uuid, present: count, absent: count, billed: count, invoiced: count },
    required: ["sessionId"],
  },
  "attendance.reversed": {
    props: { sessionId: uuid, reason: { kind: "enum", values: ["cancellation", "no_show"] } },
    required: ["sessionId"],
  },
  // Invoices raised by hand. Invoices accrued by marking attendance are
  // counted on attendance.marked's `invoiced`; the weekly loop itself counts
  // both from the invoices table.
  "invoice.raised": { props: { invoiceId: uuid, totalPaise: paise }, required: ["invoiceId"] },
  "payment.recorded": {
    props: {
      invoiceId: uuid,
      amountPaise: paise,
      channel: { kind: "enum", values: ["manual", "gateway"] },
      method: { kind: "enum", values: PAYMENT_METHODS },
    },
    required: ["amountPaise", "channel"],
  },
  "wallet.topped_up": {
    props: { amountPaise: paise, channel: { kind: "enum", values: ["manual", "gateway"] } },
    required: ["amountPaise", "channel"],
  },
  // 4. Parent-side engagement.
  "parent.portal_opened": { client: true, props: {} },
  "parent.payment_started": { props: { invoiceId: uuid }, required: ["invoiceId"] },
  // 5. Feature usage.
  "feature.opened": {
    client: true,
    props: { feature: { kind: "enum", values: FEATURE_KEYS } },
    required: ["feature"],
  },
} as const satisfies Record<string, EventSpec>;

export type ProductEventName = keyof typeof EVENT_SPECS;

export const CLIENT_EVENT_NAMES = (Object.keys(EVENT_SPECS) as ProductEventName[]).filter(
  (n) => (EVENT_SPECS[n] as EventSpec).client === true
);
export type ClientEventName = "onboarding.beat_viewed" | "parent.portal_opened" | "feature.opened";

export type EventProperties = Record<string, string | number | boolean>;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isProductEventName(name: string): name is ProductEventName {
  return Object.prototype.hasOwnProperty.call(EVENT_SPECS, name);
}

/** The payload rule, as a function. Returns null when `props` may be stored for `name`, or the reason it may not. */
export function validateEventProperties(name: string, props: unknown): string | null {
  if (!isProductEventName(name)) return `unknown event "${name}"`;
  if (props === null || typeof props !== "object" || Array.isArray(props)) return "properties must be an object";
  const spec = EVENT_SPECS[name] as EventSpec;
  const entries = Object.entries(props as Record<string, unknown>);
  for (const [key, value] of entries) {
    const prop = spec.props[key];
    if (!prop) return `"${key}" is not an allowed property of ${name}`;
    switch (prop.kind) {
      case "uuid":
        if (typeof value !== "string" || !UUID_RE.test(value)) return `"${key}" must be a record id`;
        break;
      case "int":
        if (typeof value !== "number" || !Number.isSafeInteger(value)) return `"${key}" must be an integer`;
        if (value < (prop.min ?? 0) || (prop.max !== undefined && value > prop.max)) return `"${key}" is out of range`;
        break;
      case "bool":
        if (typeof value !== "boolean") return `"${key}" must be true or false`;
        break;
      case "enum":
        if (typeof value !== "string" || !prop.values.includes(value)) return `"${key}" must be one of ${prop.values.join(", ")}`;
        break;
    }
  }
  for (const key of spec.required ?? []) {
    if (!(key in (props as object))) return `"${key}" is required for ${name}`;
  }
  return null;
}

/** Maps an /app path to the workspace it opens, or null for paths not counted as feature usage. */
export function featureForPath(pathname: string): FeatureKey | null {
  const seg = pathname.replace(/^\/app\/?/, "").split("/")[0] ?? "";
  const map: Record<string, FeatureKey> = {
    "": "today", people: "people", students: "student_story", "my-story": "student_story", money: "money",
    inbox: "inbox", schedule: "schedule", "my-schedule": "schedule", settings: "settings", "audit-log": "audit_log",
    documents: "documents", courses: "courses", preferences: "preferences", profile: "profile",
  };
  if (!pathname.startsWith("/app")) return null;
  return map[seg] ?? null;
}
