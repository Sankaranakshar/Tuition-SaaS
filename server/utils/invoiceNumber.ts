import type { PoolClient } from "pg";

// Sequential, gap-free per-org invoice numbers: INV-{ORG}-{YYYY}-{seq}
// (blueprint 5.2/8.2).

/** Pure formatter, unit-tested independently of the database. */
export function formatInvoiceNumber(orgSlug: string, year: number, seq: number): string {
  const slug = (orgSlug || "ORG").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8) || "ORG";
  return `INV-${slug}-${year}-${String(seq).padStart(4, "0")}`;
}

/**
 * Allocate the next invoice number for an org within a transaction. Pass the
 * active `client` (already inside BEGIN/COMMIT via withTransaction) so number
 * assignment commits atomically with the invoice update. The upsert itself is
 * atomic even without an explicit row lock — Postgres serializes concurrent
 * `INSERT ... ON CONFLICT ... DO UPDATE` on the same key.
 */
export async function allocateInvoiceNumber(
  client: PoolClient,
  orgId: string,
  orgSlug: string,
  when: Date = new Date()
): Promise<{ number: string; seq: number; year: number }> {
  const year = when.getFullYear();
  const res = await client.query(
    `insert into invoice_counters (organization_id, year, seq)
     values ($1, $2, 1)
     on conflict (organization_id, year)
     do update set seq = invoice_counters.seq + 1
     returning seq`,
    [orgId, year]
  );
  const seq = res.rows[0].seq as number;
  return { number: formatInvoiceNumber(orgSlug, year, seq), seq, year };
}
