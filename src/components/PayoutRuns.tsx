import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../supabase";
import { toast } from "sonner";
import {
  getEarningsForTutor, runPayout, listPayoutRuns, markPayoutPaid, downloadPayoutStatement,
  type PayoutRun as PayoutRunRow,
} from "../lib/api";
import { Button } from "./kit";

const FIELD_CLASS =
  "mt-1 block w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface)] py-1.5 px-3 text-[13px] text-[var(--cs-text)] outline-none transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] focus:border-[var(--cs-focus)] focus:ring-2 focus:ring-[var(--cs-focus)]/30";

const inr = new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 });
function formatPaise(paise: number): string {
  return `₹${inr.format(paise / 100)}`;
}
function formatDate(d: string): string {
  return new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

interface TutorOption {
  userId: string;
  name: string;
}

function defaultPeriod(): { start: string; end: string } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), 1);
  const end = new Date(now.getFullYear(), now.getMonth() + 1, 1);
  return { start: start.toISOString().slice(0, 10), end: end.toISOString().slice(0, 10) };
}

// B-08 (EXECUTION_PLAN.md Step 21): the staff-side payout-run screen —
// owner/admin/accountant only. Runs a payout for one tutor over one period,
// aggregating their unpaid tutor_earnings_ledger rows (accrued automatically
// by billing.ts's attendance-mark transaction) into a TDS-deducted payout.
export default function PayoutRuns() {
  const { user } = useAuth();
  const [tutors, setTutors] = useState<TutorOption[]>([]);
  const [tutorId, setTutorId] = useState("");
  const period = defaultPeriod();
  const [periodStart, setPeriodStart] = useState(period.start);
  const [periodEnd, setPeriodEnd] = useState(period.end);
  const [unpaidPaise, setUnpaidPaise] = useState<number | null>(null);
  const [runs, setRuns] = useState<PayoutRunRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);

  const canManage =
    user?.organizationRole === "owner" || user?.organizationRole === "admin" || user?.organizationRole === "accountant";

  useEffect(() => {
    if (!canManage || !user?.organizationId) return;
    // No direct FK from organization_members to profiles for PostgREST to
    // embed on, so this is two queries + a client-side merge — same
    // approach TeamSettings.tsx's loadMembers() already uses.
    (async () => {
      const { data: rows } = await supabase
        .from("organization_members")
        .select("user_id")
        .eq("organization_id", user.organizationId!)
        .eq("role", "tutor");
      const userIds = (rows || []).map((r: any) => r.user_id);
      const { data: profiles } = userIds.length
        ? await supabase.from("profiles").select("id, name").in("id", userIds)
        : { data: [] as any[] };
      const nameById = new Map((profiles || []).map((p: any) => [p.id, p.name]));
      const opts = userIds.map((id: string) => ({ userId: id, name: nameById.get(id) || "Unnamed" }));
      setTutors(opts);
      if (opts.length > 0) setTutorId((prev) => prev || opts[0].userId);
    })();
  }, [canManage, user?.organizationId]);

  const loadForTutor = useCallback(async () => {
    if (!tutorId) return;
    setLoading(true);
    try {
      const [earningsRes, runsRes] = await Promise.all([
        getEarningsForTutor(tutorId, periodStart, periodEnd),
        listPayoutRuns(tutorId),
      ]);
      setUnpaidPaise(earningsRes.earnings.filter((e) => !e.payoutId).reduce((sum, e) => sum + e.amountPaise, 0));
      setRuns(runsRes.payouts);
    } catch (err: any) {
      toast.error("Could not load earnings", { description: err.message });
    } finally {
      setLoading(false);
    }
  }, [tutorId, periodStart, periodEnd]);

  useEffect(() => {
    loadForTutor();
  }, [loadForTutor]);

  const handleRun = async () => {
    if (!tutorId) return;
    setRunning(true);
    try {
      await runPayout(tutorId, periodStart, periodEnd);
      toast.success("Payout run created");
      await loadForTutor();
    } catch (err: any) {
      if (err.code === "nothing_to_pay") {
        toast.error("No unpaid earnings in this period");
      } else {
        toast.error("Could not run payout", { description: err.message });
      }
    } finally {
      setRunning(false);
    }
  };

  const handleMarkPaid = async (payoutId: string) => {
    try {
      await markPayoutPaid(payoutId);
      toast.success("Marked paid");
      await loadForTutor();
    } catch (err: any) {
      toast.error("Could not mark paid", { description: err.message });
    }
  };

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

  if (!canManage) {
    return <div className="p-4 text-sm text-[var(--cs-text-muted)]">You do not have permission to manage payouts.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <div className="border-b border-[var(--cs-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--cs-text)]">Run a payout</h2>
          <p className="mt-1 text-xs text-[var(--cs-text-muted)]">
            Aggregates a tutor's unpaid earnings for the selected period into one TDS-deducted payout. Set each tutor's
            hourly rate and your center's TDS % in Team and Organization settings first — a tutor with no rate set accrues
            no earnings to pay out.
          </p>
        </div>
        <div className="p-4 space-y-4">
          {tutors.length === 0 ? (
            <p className="text-sm text-[var(--cs-text-muted)]">No tutors in this organization yet.</p>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Tutor</label>
                <select value={tutorId} onChange={(e) => setTutorId(e.target.value)} className={FIELD_CLASS}>
                  {tutors.map((t) => (
                    <option key={t.userId} value={t.userId}>{t.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Period start</label>
                <input type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} className={FIELD_CLASS} />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Period end</label>
                <input type="date" value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} className={FIELD_CLASS} />
              </div>
            </div>
          )}

          {tutorId && (
            <div className="flex items-center justify-between rounded-[var(--cs-radius-control)] bg-[var(--cs-surface-2)] px-4 py-3">
              <span className="text-sm text-[var(--cs-text)]">
                Unpaid earnings in this period: <span className="font-medium">{loading ? "…" : formatPaise(unpaidPaise || 0)}</span>
              </span>
              <Button onClick={handleRun} disabled={running || loading || !unpaidPaise}>
                {running ? "Running…" : "Run payout"}
              </Button>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <div className="border-b border-[var(--cs-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--cs-text)]">Payout history for this tutor</h2>
        </div>
        <div className="p-4">
          {runs.length === 0 ? (
            <p className="text-sm text-[var(--cs-text-muted)]">No payouts run yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--cs-border)]">
              {runs.map((p) => (
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
                    {p.status !== "paid" && (
                      <Button variant="ghost" onClick={() => handleMarkPaid(p.id)}>Mark paid</Button>
                    )}
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
