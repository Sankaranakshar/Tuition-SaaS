// B-17 (EXECUTION_PLAN.md Step 27): templates as data, not string literals
// (the plan's own implementation-scope point 1), because WhatsApp template
// approval will constrain the exact wording later and every send must be
// traceable to a named template key, not an inline string built at the call
// site. Delivered in the plan's stated order of value: invoice raised,
// fee due reminder, payment received, invite link, session reminder,
// absence alert.
//
// Every template here is transactional, not marketing: each one is sent to a
// parent/student about their own child/account under an existing
// relationship (attendance, an invoice, an invite they were offered by
// staff), never a cold or promotional message. That distinction belongs
// here, in the registry, per the plan's implementation-scope point 4 --
// `category` records it so a future consent-posture read (DPDP, WhatsApp
// Business policy) has one place to check rather than re-deriving it from
// each producer.
export type TemplateKey =
  | "invoice_raised"
  | "fee_due_reminder"
  | "payment_received"
  | "invite_link"
  | "session_reminder"
  | "absence_alert";

export type TemplateCategory = "transactional";

interface TemplateDefinition<P> {
  key: TemplateKey;
  category: TemplateCategory;
  // Plain text, used verbatim as the SMS body and as the pre-approval
  // WhatsApp body (an approved WhatsApp template's exact copy and param
  // slots are chosen at onboarding time, once a vendor exists to approve
  // one against -- see server/utils/messaging/provider.ts's header comment).
  render: (payload: P) => string;
}

function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

export interface InvoiceRaisedPayload {
  studentName: string;
  amountPaise: number;
  dueDate: string | null;
  portalUrl: string;
}
export interface FeeDueReminderPayload {
  studentName: string;
  outstandingPaise: number;
  portalUrl: string;
}
export interface PaymentReceivedPayload {
  studentName: string;
  amountPaise: number;
  portalUrl: string;
}
export interface InviteLinkPayload {
  studentName: string;
  inviteUrl: string;
  role: "parent" | "student";
}
export interface SessionReminderPayload {
  studentName: string;
  startTimeLocal: string;
  subject: string | null;
}
export interface AbsenceAlertPayload {
  studentName: string;
  sessionDateLocal: string;
}

export const TEMPLATES = {
  invoice_raised: {
    key: "invoice_raised",
    category: "transactional",
    render: (p: InvoiceRaisedPayload) =>
      `A new invoice of ${inr(p.amountPaise)} for ${p.studentName} is due` +
      (p.dueDate ? ` on ${p.dueDate}` : "") +
      `. View and pay: ${p.portalUrl}`,
  } satisfies TemplateDefinition<InvoiceRaisedPayload>,

  fee_due_reminder: {
    key: "fee_due_reminder",
    category: "transactional",
    render: (p: FeeDueReminderPayload) =>
      `Reminder: ${inr(p.outstandingPaise)} is outstanding for ${p.studentName}'s tuition. ` +
      `Pay here: ${p.portalUrl}`,
  } satisfies TemplateDefinition<FeeDueReminderPayload>,

  payment_received: {
    key: "payment_received",
    category: "transactional",
    render: (p: PaymentReceivedPayload) =>
      `Payment of ${inr(p.amountPaise)} received for ${p.studentName}. Thank you! ` +
      `View receipt: ${p.portalUrl}`,
  } satisfies TemplateDefinition<PaymentReceivedPayload>,

  invite_link: {
    key: "invite_link",
    category: "transactional",
    render: (p: InviteLinkPayload) =>
      p.role === "parent"
        ? `You've been invited to follow ${p.studentName}'s tuition on ClassStackr. Join here: ${p.inviteUrl}`
        : `You've been invited to join ClassStackr as ${p.studentName}. Join here: ${p.inviteUrl}`,
  } satisfies TemplateDefinition<InviteLinkPayload>,

  session_reminder: {
    key: "session_reminder",
    category: "transactional",
    render: (p: SessionReminderPayload) =>
      `Reminder: ${p.studentName} has ${p.subject ? `${p.subject} ` : ""}class at ${p.startTimeLocal}.`,
  } satisfies TemplateDefinition<SessionReminderPayload>,

  absence_alert: {
    key: "absence_alert",
    category: "transactional",
    render: (p: AbsenceAlertPayload) =>
      `${p.studentName} was marked absent for the class on ${p.sessionDateLocal}.`,
  } satisfies TemplateDefinition<AbsenceAlertPayload>,
} as const;

export function renderTemplate(key: TemplateKey, payload: Record<string, unknown>): string {
  const def = TEMPLATES[key];
  if (!def) throw new Error(`Unknown messaging template: ${key}`);
  // Payload shape is enforced by each producer's own TypeScript call site
  // (each enqueueMessage caller passes the concrete payload type its
  // producer built), not re-validated with Zod here -- this function's only
  // caller within the process is the delivery sweep, reading back whatever
  // shape the producer stored as jsonb.
  return (def.render as (p: any) => string)(payload);
}
