import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";
import { getMyEarnings, downloadPayoutStatement, type EarningsLedgerRow, type PayoutRun } from "../lib/api";
import { Button } from "./kit";

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
function formatPaise(paise: number): string {
  return `₹${inr.format(paise / 100)}`;
}
function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

// B-08 (EXECUTION_PLAN.md Step 21): a tutor's own view of what they've
// earned and been paid. Deliberately gated to organizationRole === 'tutor'
// only (not owner/admin too, unlike TutorProfileSettings/availability) — an
// independent tutor (D-01's org-of-one, bootstrapped as 'owner') has no
// separate payroll counterparty to be paid by, so this tab has nothing
// meaningful to show them.
export default function TutorEarnings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(true);
  const [earnings, setEarnings] = useState<EarningsLedgerRow[]>([]);
  const [payouts, setPayouts] = useState<PayoutRun[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getMyEarnings();
      setEarnings(res.earnings);
      setPayouts(res.payouts);
    } catch (err: any) {
      toast.error("Could not load earnings", { description: err.message });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleDownload = async (payoutId: string) => {
    setDownloadingId(payoutId);
    try {
      await downloadPayoutStatement(payoutId);
    } catch (err: any) {
      toast.error("Could not download statement", { description: err.message });
    } finally {
      setDownloadingId(null);
    }
  };

  if (!user || user.organizationRole !== "tutor") {
    return <div className="p-4 text-sm text-[var(--cs-text-muted)]">You do not have permission to view earnings.</div>;
  }

  const unpaidTotal = earnings.filter((e) => !e.payoutId).reduce((sum, e) => sum + e.amountPaise, 0);

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <div className="border-b border-[var(--cs-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--cs-text)]">My earnings</h2>
          <p className="mt-1 text-xs text-[var(--cs-text-muted)]">
            Accrues automatically when you mark attendance for a session, at the hourly rate your organization has set for you.
            {" "}Not yet included in a payout: <span className="font-medium text-[var(--cs-text)]">{formatPaise(unpaidTotal)}</span>.
          </p>
        </div>
        <div className="p-4">
          {loading ? (
            <p className="text-sm text-[var(--cs-text-muted)]">Loading…</p>
          ) : earnings.length === 0 ? (
            <p className="text-sm text-[var(--cs-text-muted)]">No earnings recorded yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--cs-border)]">
              {earnings.map((e) => (
                <li key={e.id} className="flex items-center justify-between py-2 text-sm">
                  <span className="text-[var(--cs-text)]">{formatDate(e.sessionStart)} — {e.durationMinutes} min</span>
                  <span className="flex items-center gap-2">
                    <span className="font-medium text-[var(--cs-text)]">{formatPaise(e.amountPaise)}</span>
                    {!e.payoutId && (
                      <span className="rounded-full bg-[var(--cs-surface-2)] px-2 py-0.5 text-xs text-[var(--cs-text-muted)]">Unpaid</span>
                    )}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <div className="border-b border-[var(--cs-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--cs-text)]">Payout history</h2>
        </div>
        <div className="p-4">
          {payouts.length === 0 ? (
            <p className="text-sm text-[var(--cs-text-muted)]">No payouts yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--cs-border)]">
              {payouts.map((p) => (
                <li key={p.id} className="flex items-center justify-between py-3 text-sm">
                  <div>
                    <div className="text-[var(--cs-text)]">{formatDate(p.periodStart)} – {formatDate(p.periodEnd)}</div>
                    <div className="text-xs text-[var(--cs-text-muted)]">
                      Gross {formatPaise(p.grossPaise)} · TDS {p.tdsPercent}% · Net {formatPaise(p.netPaise)}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="rounded-full bg-[var(--cs-surface-2)] px-2.5 py-0.5 text-xs font-medium capitalize text-[var(--cs-text-muted)]">
                      {p.status}
                    </span>
                    <Button variant="ghost" onClick={() => handleDownload(p.id)} disabled={downloadingId === p.id}>
                      {downloadingId === p.id ? "Downloading…" : "Statement"}
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
