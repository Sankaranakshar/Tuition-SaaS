import type { Firestore } from "firebase-admin/firestore";

// Sequential, gap-free per-org invoice numbers: INV-{ORG}-{YYYY}-{seq}
// (blueprint 5.2/8.2). The sequence is a transactional counter so two
// concurrent finalizations never collide or skip a number.

/** Pure formatter, unit-tested independently of Firestore. */
export function formatInvoiceNumber(orgSlug: string, year: number, seq: number): string {
  const slug = (orgSlug || "ORG").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "ORG";
  return `INV-${slug}-${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * Allocate the next invoice number for an org within a transaction. Pass the
 * active `tx` so number assignment commits atomically with the invoice update.
 * Counter doc id is `${orgId}_invoice_${year}` in the server-only `counters`
 * collection (no client rules match → default deny).
 */
export async function allocateInvoiceNumber(
  db: Firestore,
  tx: FirebaseFirestore.Transaction,
  orgId: string,
  orgSlug: string,
  when: Date = new Date()
): Promise<{ number: string; seq: number; year: number }> {
  const year = when.getFullYear();
  const counterRef = db.collection("counters").doc(`${orgId}_invoice_${year}`);
  const snap = await tx.get(counterRef);
  const seq = (snap.exists ? (snap.data()!.seq as number) : 0) + 1;
  tx.set(counterRef, { organizationId: orgId, kind: "invoice", year, seq }, { merge: true });
  return { number: formatInvoiceNumber(orgSlug, year, seq), seq, year };
}
