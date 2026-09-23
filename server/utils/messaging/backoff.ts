// B-17: the delivery sweep's retry state machine, pulled out of
// server/routes/cron.ts so it is unit-testable without a database.
export const MAX_DELIVERY_ATTEMPTS = 5;

// Exponential, capped at 60 minutes -- Vercel Cron on the Hobby plan only
// fires this route once a day (see cron.ts's header comment), so the cap
// matters less for wall-clock spacing than for keeping next_attempt_at from
// drifting to an absurd value if attempts ever grew unbounded.
export function backoffMinutes(attempts: number): number {
  return Math.min(60, 2 ** attempts);
}

// D-10: WhatsApp-first with SMS fallback, as a channel transition rather
// than a second code path. The first failure on a whatsapp-channel message
// flips it to sms for the next attempt; every later attempt (whichever
// channel it's already on) just retries.
export function nextChannel(attempts: number, currentChannel: "whatsapp" | "sms"): "whatsapp" | "sms" {
  return attempts === 1 && currentChannel === "whatsapp" ? "sms" : currentChannel;
}

export function isDeadLetter(attempts: number): boolean {
  return attempts >= MAX_DELIVERY_ATTEMPTS;
}
