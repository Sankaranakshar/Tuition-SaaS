// B-11 / EXECUTION_PLAN.md Step 10: per-org policy for what a per-student
// erasure does with a leftover wallet balance.
//
// Zod-free (same rule as shared/creditExpiry.ts / shared/money.ts) so the
// Settings UI and the erasure route resolve the same default without pulling
// Zod into the client bundle.
//
// Founder decision (2026-09-05): make this a per-center choice rather than a
// fixed platform behaviour. A family may have unused prepaid credit when an
// erasure request lands; whether the system refuses until the center clears
// it, or writes it off automatically, is the center's call.
//
//   - "block"    (default): erasure 409s while balance_credits or
//                balance_currency is non-zero. Staff refund / adjust to zero
//                through the existing Money surfaces, then retry. The system
//                never decides what happens to the money.
//   - "writeoff": erasure writes a negative wallet_ledger row
//                (reason 'erasure_writeoff'), zeroes the wallet, writes an
//                audit event, then proceeds. Keeps B-03's
//                `balance == ledger sum` invariant intact automatically.

export type ErasureWalletPolicy = "block" | "writeoff";

export interface ErasurePolicy {
  walletPolicy: ErasureWalletPolicy;
}

// Default is the conservative one: never move a family's money without a
// deliberate center action.
export const DEFAULT_ERASURE_POLICY: ErasurePolicy = { walletPolicy: "block" };

/** Resolve a possibly-missing / possibly-partial `settings.erasure` blob. */
export function resolveErasurePolicy(raw: unknown): ErasurePolicy {
  const obj = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return { walletPolicy: obj.walletPolicy === "writeoff" ? "writeoff" : "block" };
}
