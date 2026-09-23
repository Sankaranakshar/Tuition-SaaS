// B-17 (EXECUTION_PLAN.md Step 27): the provider side of the transport
// abstraction D-10 calls for. D-10 decided WhatsApp-first with SMS fallback
// via an aggregator, but left the specific vendor open -- this interface is
// what makes that vendor pick a later, isolated swap instead of a rewrite.
// Nothing here talks to a real network: WhatsApp Business API onboarding,
// template approval and SMS DLT registration are multi-week procurement that
// has not started (HANDOFF §7's external-integrations deferral), so there is
// no vendor to integrate against yet. `ConsoleMessagingProvider` is the
// concrete adapter for now -- it logs and marks every send successful,
// exactly like B-08's payouts have no live Razorpay payout integration and
// settle by bank transfer outside the product. Swapping in a real vendor
// later means writing one more class here and pointing `getMessagingProvider`
// at it; the outbox, retry/backoff, webhook and every producer stay
// unchanged.

export type MessagingChannel = "whatsapp" | "sms";

export interface OutboundMessage {
  channel: MessagingChannel;
  recipientPhone: string;
  templateKey: string;
  text: string;
}

export interface SendResult {
  ok: boolean;
  providerMessageId?: string;
  error?: string;
}

export interface MessagingProvider {
  send(message: OutboundMessage): Promise<SendResult>;
}

// Deliberately not a "real" mock (never fails, always returns instantly) --
// it logs at info level so the delivery-sweep's effect is visible in Vercel
// function logs the same way a real provider's send would be, and it is the
// literal-truth adapter for a product with no live transport yet: nothing
// was actually delivered to a phone, and this adapter never claims otherwise
// beyond "queued to a provider that doesn't exist." It always reports success
// so the outbox state machine (queued -> sent -> [delivered/read via
// webhook]) exercises its full path in tests and staging without a live
// vendor, and so a pre-launch send never falsely dead-letters.
export class ConsoleMessagingProvider implements MessagingProvider {
  async send(message: OutboundMessage): Promise<SendResult> {
    const providerMessageId = `console_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
    console.log(
      `[messaging:console] would send ${message.channel} to ${message.recipientPhone} ` +
      `(template=${message.templateKey}, id=${providerMessageId}): ${message.text}`
    );
    return { ok: true, providerMessageId };
  }
}

let cachedProvider: MessagingProvider | null = null;

// MESSAGING_PROVIDER selects the concrete adapter once a vendor is picked and
// its credentials exist (mirrors PLATFORM_RAZORPAY_KEY_ID's "unset = degraded
// path stays live" posture, not a dead branch to delete later). Unset or
// unrecognized both fall back to the console adapter rather than throwing --
// a missing/wrong env value should never crash the delivery sweep for every
// org.
export function getMessagingProvider(): MessagingProvider {
  if (!cachedProvider) {
    cachedProvider = new ConsoleMessagingProvider();
  }
  return cachedProvider;
}
