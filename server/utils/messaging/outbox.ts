import type { Pool, PoolClient } from "pg";
import { TEMPLATES, type TemplateKey } from "./templates.ts";
import type { MessagingChannel } from "./provider.ts";

type Queryable = Pick<Pool | PoolClient, "query">;

export interface EnqueueParams {
  organizationId: string;
  recipientUserId?: string | null;
  recipientPhone?: string | null;
  templateKey: TemplateKey;
  payload: Record<string, unknown>;
  source: { kind: string; entityId: string };
  // Derived by the caller from the source event, not generated here --
  // enqueueMessage must stay a pure "insert if new" so a retried HTTP
  // request or a replayed webhook resolves to the same row instead of a
  // second message. See message_outbox's own idempotency_key comment for
  // how each producer derives it.
  idempotencyKey: string;
}

export interface EnqueueResult {
  enqueued: boolean;
  suppressed?: boolean;
  reason?: "no_phone" | "opted_out" | "duplicate";
  id?: string;
}

// D-10: WhatsApp-first. The delivery sweep falls back to SMS on a WhatsApp
// send failure (server/routes/cron.ts's deliverySweepHandler), so every
// message starts life on this channel regardless of which one eventually
// carries it.
const INITIAL_CHANNEL: MessagingChannel = "whatsapp";

// Inserts a queued message, or suppresses it, or no-ops on a duplicate. Takes
// a plain Queryable (pool or an in-transaction client) so producers that
// already hold a transaction (billing.ts's attendance-mark, which enqueues
// an absence alert and an invoice-raised message inside the same
// withTransaction as the money writes) can pass their client through and get
// the same all-or-nothing guarantee as the rest of that transaction.
export async function enqueueMessage(db: Queryable, params: EnqueueParams): Promise<EnqueueResult> {
  if (!TEMPLATES[params.templateKey]) {
    throw new Error(`Unknown messaging template: ${params.templateKey}`);
  }

  let recipientPhone = params.recipientPhone ?? null;
  if (!recipientPhone && params.recipientUserId) {
    const res = await db.query(`select phone from profiles where id = $1`, [params.recipientUserId]);
    recipientPhone = (res.rows[0]?.phone as string | null | undefined) ?? null;
  }
  if (!recipientPhone) return { enqueued: false, reason: "no_phone" };

  // Preference opt-out only applies to a recipient we actually have a
  // profile for -- a bare students.parent_phone fallback (no linked account
  // yet, see recipients.ts) has no preferences row to check and can't be
  // opted out of a message about their own child that nothing else notifies
  // them of.
  if (params.recipientUserId) {
    const prefRes = await db.query(`select preferences from profiles where id = $1`, [params.recipientUserId]);
    const prefs = (prefRes.rows[0]?.preferences ?? {}) as { notifications?: { smsNotifications?: boolean } };
    if (prefs.notifications?.smsNotifications === false) {
      const inserted = await insertRow(db, params, recipientPhone, "suppressed");
      if (!inserted) return { enqueued: false, reason: "duplicate" };
      return { enqueued: false, suppressed: true, id: inserted };
    }
  }

  const inserted = await insertRow(db, params, recipientPhone, "queued");
  if (!inserted) return { enqueued: false, reason: "duplicate" };
  return { enqueued: true, id: inserted };
}

async function insertRow(
  db: Queryable,
  params: EnqueueParams,
  recipientPhone: string,
  state: "queued" | "suppressed"
): Promise<string | null> {
  const res = await db.query(
    `insert into message_outbox
       (organization_id, recipient_user_id, recipient_phone, channel, template_key, payload, state, source, idempotency_key)
     values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8::jsonb, $9)
     on conflict (organization_id, idempotency_key) do nothing
     returning id`,
    [
      params.organizationId,
      params.recipientUserId ?? null,
      recipientPhone,
      INITIAL_CHANNEL,
      params.templateKey,
      JSON.stringify(params.payload),
      state,
      JSON.stringify(params.source),
      params.idempotencyKey,
    ]
  );
  return (res.rows[0]?.id as string | undefined) ?? null;
}
