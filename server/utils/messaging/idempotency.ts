// B-17 (EXECUTION_PLAN.md Step 27): pure key-derivation, split out of each
// producer's inline template literal so it is unit-testable without a
// database (HANDOFF §6's three-layer pattern: pure logic here, IO in
// outbox.ts/the route). Every key must be stable for a genuine retry of the
// same logical event (so a retried request or a replayed webhook resolves
// to the same message_outbox row) and distinct across genuinely different
// events (so two real invoices never collide).
export function invoiceRaisedKey(invoiceId: string): string {
  return `invoice_raised:${invoiceId}`;
}

export function paymentReceivedKey(source: "manual" | "rzp", paymentIdentifier: string): string {
  return `payment_received:${source}:${paymentIdentifier}`;
}

// Bucketed by day, not per-click: a manual reminder is a legitimate repeat
// action (a parent still hasn't paid tomorrow), but two rapid clicks on the
// same invoice today must not double-message. See message_outbox's own
// idempotency_key column comment.
export function feeDueReminderKey(invoiceId: string, dateBucket: string): string {
  return `fee_due_reminder:${invoiceId}:${dateBucket}`;
}

export function inviteLinkKey(role: "parent" | "student", token: string): string {
  return `invite_link:${role}:${token}`;
}

export function sessionReminderKey(sessionId: string, studentId: string): string {
  return `session_reminder:${sessionId}:${studentId}`;
}

export function absenceAlertKey(sessionId: string, studentId: string): string {
  return `absence_alert:${sessionId}:${studentId}`;
}
