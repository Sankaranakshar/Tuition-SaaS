// Canonical rupee<->paise conversion (DEV_PLAN Tech Debt #3). Money is
// integer paise everywhere (HANDOFF invariant #4); rupee values only exist at
// the edges — the legacy display-mirror columns (invoices.total_amount/
// subtotal, wallets.balance_currency) and user-typed form inputs. Before this,
// every read/write site hand-rolled its own `Math.round(x * 100)` / `x / 100`
// — the actual "two sources of truth" drift risk described in that tech debt
// item is duplicated conversion logic, not the numeric(10,2) column itself
// (Postgres numeric is exact-decimal). No zod here, so this stays importable
// from the client bundle without pulling zod in (see HANDOFF rule on
// shared/ files that build zod schemas).
export function rupeesToPaise(rupees: number): number {
  return Math.round(rupees * 100);
}

export function paiseToRupees(paise: number): number {
  return paise / 100;
}
