import React, { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Plus, Receipt, Download, Share2, Wallet as WalletIcon, TrendingUp,
  CheckCircle, XCircle, IndianRupee, Trash2, X,
} from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import {
  createInvoice, recordManualPayment, downloadInvoicePdf, createInvoicePaymentLink,
  topUpWallet, voidInvoice,
} from "../lib/api";
import { useStudentsList } from "../hooks/usePeople";
import {
  useMoneyInvoices, useMoneyWallets, useMoneyPayments, useAvgSessionFeePaise, useSelfMoney,
  type MoneyInvoiceRow,
} from "../hooks/useMoney";
import {
  groupOutstandingByPayer, selectionTotal, rankWalletsByDepletion,
  revenueTrend, collectionRate, revenueByLineItem, agingBucket,
} from "../lib/money";
import { formatPaise, formatDate } from "../lib/format";
import { EmptyState, SkeletonRow, AgedBadge, StatChip, Popover, StatusChip, type ChipTone } from "../components/kit";

type Segment = "outstanding" | "wallets" | "insights";
const SEGMENTS: { key: Segment; labelKey: string; icon: typeof Receipt }[] = [
  { key: "outstanding", labelKey: "money.segOutstanding", icon: Receipt },
  { key: "wallets", labelKey: "money.segWallets", icon: WalletIcon },
  { key: "insights", labelKey: "money.segInsights", icon: TrendingUp },
];

const PAYMENT_METHODS = ["cash", "upi", "bank_transfer", "cheque", "other"] as const;

function statusTone(status: string): ChipTone {
  switch (status) {
    case "paid":
      return "positive";
    case "overdue":
      return "danger";
    case "void":
      return "neutral";
    case "draft":
      return "neutral";
    default:
      return "warn";
  }
}

export default function Money() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const isStaff = user?.role !== "parent" && user?.role !== "student";

  if (!isStaff) return <SelfMoneyView />;
  return <StaffMoneyView />;
}

// ------------------------------------------------------------------- Staff

function StaffMoneyView() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const segment: Segment = (searchParams.get("segment") as Segment) || "outstanding";
  const setSegment = (s: Segment) => setSearchParams((prev) => { prev.set("segment", s); return prev; }, { replace: true });

  const { data: invoices, loading: invoicesLoading, refetch: refetchInvoices } = useMoneyInvoices();
  const { data: students } = useStudentsList();
  const { data: wallets, loading: walletsLoading } = useMoneyWallets();
  const { data: payments } = useMoneyPayments();
  const avgSessionFeePaise = useAvgSessionFeePaise();

  const [createOpen, setCreateOpen] = useState(false);
  const [prefillStudentId, setPrefillStudentId] = useState<string | undefined>(undefined);
  const [detailInvoiceId, setDetailInvoiceId] = useState<string | null>(null);

  React.useEffect(() => {
    if (searchParams.get("new") === "1") {
      setPrefillStudentId(searchParams.get("studentId") || undefined);
      setCreateOpen(true);
      setSearchParams({}, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const detailInvoice = invoices.find((inv) => inv.id === detailInvoiceId) || null;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--cs-text)]">{t("nav.money")}</h1>
        <button
          onClick={() => { setPrefillStudentId(undefined); setCreateOpen(true); }}
          className="flex items-center gap-1.5 rounded-[6px] bg-[var(--cs-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          <Plus className="h-4 w-4" /> {t("money.generateInvoice")}
        </button>
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--cs-border)]">
        {SEGMENTS.map(({ key, labelKey, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setSegment(key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              segment === key
                ? "border-[var(--cs-accent)] text-[var(--cs-accent)]"
                : "border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text)]"
            }`}
          >
            <Icon className="h-4 w-4" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      {segment === "outstanding" && (
        <OutstandingSegment
          invoices={invoices}
          students={students}
          loading={invoicesLoading}
          onViewInvoice={setDetailInvoiceId}
          onNewInvoice={(studentId) => { setPrefillStudentId(studentId); setCreateOpen(true); }}
        />
      )}
      {segment === "wallets" && (
        <WalletsSegment wallets={wallets} loading={walletsLoading} avgSessionFeePaise={avgSessionFeePaise} />
      )}
      {segment === "insights" && <InsightsSegment invoices={invoices} payments={payments} />}

      {createOpen && (
        <CreateInvoiceModal
          students={students}
          userOrgId={user?.organizationId}
          prefillStudentId={prefillStudentId}
          onClose={() => setCreateOpen(false)}
          onCreated={() => { setCreateOpen(false); refetchInvoices(); }}
        />
      )}
      {detailInvoice && (
        <InvoiceDetailModal
          invoice={detailInvoice}
          studentName={students.find((s) => s.id === detailInvoice.studentId)?.name || "Unknown student"}
          payments={payments.filter((p) => p.invoiceId === detailInvoice.id)}
          onClose={() => setDetailInvoiceId(null)}
          onChanged={refetchInvoices}
        />
      )}
    </div>
  );
}

// --------------------------------------------------------------- Outstanding

function OutstandingSegment({ invoices, students, loading, onViewInvoice, onNewInvoice }: any) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const groups = useMemo(() => groupOutstandingByPayer(invoices, students, new Date()), [invoices, students]);
  const totals = useMemo(() => selectionTotal(groups, selected), [groups, selected]);

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const remind = async (invoiceId: string, studentName: string) => {
    try {
      const { shortUrl } = await createInvoicePaymentLink(invoiceId);
      const text = `Hi, here's the payment link for ${studentName}'s tuition invoice: ${shortUrl}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast.error(t("money.reminderFailed"), { description: err.message });
    }
  };

  const bulkRemind = async () => {
    const lines: string[] = [];
    for (const group of groups) {
      const own = group.lines.filter((l: any) => selected.has(l.invoice.id));
      if (own.length === 0) continue;
      try {
        const links = await Promise.all(own.map((l: any) => createInvoicePaymentLink(l.invoice.id)));
        lines.push(
          `${group.studentName}: ` + links.map((r, i) => `₹${(own[i].outstandingPaise / 100).toFixed(0)} → ${r.shortUrl}`).join(", ")
        );
      } catch (err: any) {
        toast.error(t("money.reminderFailed"), { description: `${group.studentName}: ${err.message}` });
      }
    }
    if (lines.length === 0) return;
    const text = lines.join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("money.remindersCopied", { count: lines.length }));
    } catch {
      toast.success(t("money.remindersReady"));
    }
    setSelected(new Set());
  };

  if (loading) {
    return (
      <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] divide-y divide-[var(--cs-border)]">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    );
  }

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={CheckCircle}
        title={t("money.allSettled")}
        description={t("money.allSettledHint")}
      />
    );
  }

  return (
    <div className="space-y-4 pb-16">
      {groups.map((group) => (
        <div key={group.studentId} className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] overflow-hidden">
          <div className="flex items-center justify-between border-b border-[var(--cs-border)] bg-[var(--cs-bg)] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="text-sm font-semibold text-[var(--cs-text)]">{group.studentName}</span>
              <AgedBadge daysOverdue={group.maxDaysOverdue} />
            </div>
            <div className="flex items-center gap-3">
              <span className="text-sm font-semibold tabular-nums text-[var(--cs-text)]">{formatPaise(group.totalOutstandingPaise)}</span>
              <button
                onClick={() => onNewInvoice(group.studentId)}
                title={t("money.newInvoice")}
                className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-accent)]"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          </div>
          <div className="divide-y divide-[var(--cs-border)]">
            {group.lines.map((line: any) => (
              <div key={line.invoice.id} className="flex items-center gap-3 px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={selected.has(line.invoice.id)}
                  onChange={() => toggle(line.invoice.id)}
                  className="h-4 w-4"
                />
                <button onClick={() => onViewInvoice(line.invoice.id)} className="min-w-0 flex-1 text-left">
                  <div className="truncate text-sm text-[var(--cs-text)]">
                    {line.invoice.invoiceNumber || `INV-${line.invoice.id.slice(0, 6).toUpperCase()}`}
                    {" · "}
                    {(line.invoice.items || [])[0]?.description || t("money.generalTuition")}
                  </div>
                  <div className="text-xs text-[var(--cs-text-muted)]">{t("money.due")} {formatDate(line.invoice.dueDate)}</div>
                </button>
                <AgedBadge daysOverdue={line.daysOverdue} />
                <span className="w-24 text-right text-sm font-medium tabular-nums text-[var(--cs-text)]">
                  {formatPaise(line.outstandingPaise)}
                </span>
                <RecordPaymentPopover invoiceId={line.invoice.id} outstandingPaise={line.outstandingPaise} />
                <button
                  onClick={() => remind(line.invoice.id, group.studentName)}
                  title={t("money.remind")}
                  className="p-1.5 text-[var(--cs-text-muted)] hover:text-green-600"
                >
                  <Share2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>
      ))}

      {totals.count > 0 && (
        <div className="fixed inset-x-0 bottom-0 z-10 flex items-center justify-between border-t border-[var(--cs-border)] bg-[var(--cs-surface)] px-6 py-3 shadow-lg md:left-64">
          <span className="text-sm text-[var(--cs-text)]">
            {t("money.selectionTotal", { amount: formatPaise(totals.totalPaise), count: totals.count })}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={() => setSelected(new Set())} className="rounded-[6px] px-3 py-1.5 text-sm text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)]">
              {t("money.clearSelection")}
            </button>
            <button onClick={bulkRemind} className="rounded-[6px] bg-[var(--cs-accent)] px-3.5 py-1.5 text-sm font-medium text-white hover:opacity-90">
              {t("money.copyReminders")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function RecordPaymentPopover({ invoiceId, outstandingPaise }: { invoiceId: string; outstandingPaise: number }) {
  const { t } = useTranslation();
  return (
    <Popover
      align="right"
      trigger={
        <button title={t("money.recordPayment")} className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-accent)]">
          <IndianRupee className="h-4 w-4" />
        </button>
      }
    >
      {(close) => <RecordPaymentForm invoiceId={invoiceId} outstandingPaise={outstandingPaise} onDone={close} />}
    </Popover>
  );
}

function RecordPaymentForm({ invoiceId, outstandingPaise, onDone }: { invoiceId: string; outstandingPaise: number; onDone: () => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState((outstandingPaise / 100).toFixed(2));
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("cash");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const amountPaise = Math.round(parseFloat(amount) * 100);
    if (!amountPaise || amountPaise <= 0) {
      setError(t("money.amountRequired"));
      return;
    }
    setSaving(true);
    try {
      await recordManualPayment({ invoiceId, amountPaise, method });
      toast.success(t("money.paymentRecorded"));
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 w-56">
      <label className="text-xs font-medium text-[var(--cs-text-muted)]">{t("money.amount")}</label>
      <input
        autoFocus
        type="number"
        min="0"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--cs-accent)]"
      />
      <label className="text-xs font-medium text-[var(--cs-text-muted)]">{t("money.method")}</label>
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value as any)}
        className="w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--cs-accent)]"
      >
        {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
      </select>
      {error && <p className="text-xs text-[var(--cs-danger)]">{error}</p>}
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <button type="button" onClick={onDone} className="rounded-[6px] px-2.5 py-1.5 text-sm text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)]">
          {t("money.cancel")}
        </button>
        <button type="submit" disabled={saving} className="rounded-[6px] bg-[var(--cs-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
          {saving ? t("money.saving") : t("money.recordPayment")}
        </button>
      </div>
    </form>
  );
}

// -------------------------------------------------------------------- Wallets

function WalletsSegment({ wallets, loading, avgSessionFeePaise }: any) {
  const { t } = useTranslation();
  const ranked = useMemo(() => rankWalletsByDepletion(wallets, avgSessionFeePaise), [wallets, avgSessionFeePaise]);

  if (loading) {
    return (
      <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] divide-y divide-[var(--cs-border)]">
        {Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    );
  }

  if (ranked.length === 0) {
    return <EmptyState icon={WalletIcon} title={t("money.noWallets")} description={t("money.noWalletsHint")} />;
  }

  return (
    <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] divide-y divide-[var(--cs-border)]">
      {ranked.map(({ wallet, sessionsCovered, isLow }) => (
        <div key={wallet.studentId} className="flex items-center justify-between px-4 py-3">
          <div>
            <div className="text-sm font-medium text-[var(--cs-text)]">{wallet.studentName}</div>
            <div className="text-xs text-[var(--cs-text-muted)]">
              {wallet.balanceCredits > 0
                ? t("money.creditsBalance", { count: wallet.balanceCredits })
                : formatPaise(wallet.balanceCurrencyPaise)}
              {sessionsCovered !== null && ` · ${t("money.sessionsCovered", { count: sessionsCovered })}`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {isLow && <StatusChip label={t("money.lowBalance")} tone="danger" />}
            <TopUpPopover studentId={wallet.studentId} />
          </div>
        </div>
      ))}
    </div>
  );
}

function TopUpPopover({ studentId }: { studentId: string }) {
  const { t } = useTranslation();
  return (
    <Popover
      align="right"
      trigger={
        <button className="rounded-[6px] border border-[var(--cs-border)] px-2.5 py-1.5 text-xs font-medium hover:bg-[var(--cs-bg)]">
          {t("money.topUp")}
        </button>
      }
    >
      {(close) => <TopUpForm studentId={studentId} onDone={close} />}
    </Popover>
  );
}

function TopUpForm({ studentId, onDone }: { studentId: string; onDone: () => void }) {
  const { t } = useTranslation();
  const [amount, setAmount] = useState("");
  const [method, setMethod] = useState<(typeof PAYMENT_METHODS)[number]>("cash");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    const amountPaise = Math.round(parseFloat(amount) * 100);
    if (!amountPaise || amountPaise <= 0) {
      setError(t("money.amountRequired"));
      return;
    }
    setSaving(true);
    try {
      await topUpWallet({ studentId, amountPaise, method });
      toast.success(t("money.topUpRecorded"));
      onDone();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-2 w-56">
      <label className="text-xs font-medium text-[var(--cs-text-muted)]">{t("money.amount")}</label>
      <input
        autoFocus
        type="number"
        min="0"
        step="0.01"
        value={amount}
        onChange={(e) => setAmount(e.target.value)}
        className="w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--cs-accent)]"
      />
      <label className="text-xs font-medium text-[var(--cs-text-muted)]">{t("money.method")}</label>
      <select
        value={method}
        onChange={(e) => setMethod(e.target.value as any)}
        className="w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-bg)] px-2.5 py-1.5 text-sm outline-none focus:border-[var(--cs-accent)]"
      >
        {PAYMENT_METHODS.map((m) => <option key={m} value={m}>{m.replace("_", " ")}</option>)}
      </select>
      {error && <p className="text-xs text-[var(--cs-danger)]">{error}</p>}
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <button type="button" onClick={onDone} className="rounded-[6px] px-2.5 py-1.5 text-sm text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)]">
          {t("money.cancel")}
        </button>
        <button type="submit" disabled={saving} className="rounded-[6px] bg-[var(--cs-accent)] px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-60">
          {saving ? t("money.saving") : t("money.topUp")}
        </button>
      </div>
    </form>
  );
}

// ------------------------------------------------------------------- Insights

function InsightsSegment({ invoices, payments }: any) {
  const { t } = useTranslation();
  const now = new Date();
  const trend = useMemo(() => revenueTrend(payments, now, 6), [payments]);
  const rate = useMemo(() => collectionRate(invoices), [invoices]);
  const byItem = useMemo(() => revenueByLineItem(invoices).slice(0, 8), [invoices]);
  const maxTrend = Math.max(1, ...trend.map((m) => m.totalPaise));
  const maxItem = Math.max(1, ...byItem.map((i) => i.totalPaise));
  const totalCollected = trend.reduce((s, m) => s + m.totalPaise, 0);

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StatChip label={t("money.collectedTrailing")} value={formatPaise(totalCollected)} icon={IndianRupee} />
        <StatChip label={t("money.collectionRate")} value={`${rate}%`} tone={rate >= 80 ? "positive" : rate >= 50 ? "warn" : "danger"} icon={TrendingUp} />
      </div>

      <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--cs-text)]">{t("money.revenueTrend")}</h3>
        <div className="flex gap-3" style={{ height: 140 }}>
          {trend.map((m) => (
            <div key={m.month} className="flex flex-1 flex-col items-center gap-1.5">
              <div className="flex w-full flex-1 items-end">
                <div
                  className="w-full rounded-t-[4px] bg-[var(--cs-accent)]"
                  style={{ height: `${Math.max(4, (m.totalPaise / maxTrend) * 100)}%` }}
                  title={formatPaise(m.totalPaise)}
                />
              </div>
              <span className="text-[10px] text-[var(--cs-text-muted)]">{m.month.slice(5)}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4">
        <h3 className="mb-3 text-sm font-semibold text-[var(--cs-text)]">{t("money.revenueByService")}</h3>
        {byItem.length === 0 ? (
          <p className="text-sm text-[var(--cs-text-muted)]">{t("money.noRevenueYet")}</p>
        ) : (
          <div className="space-y-2.5">
            {byItem.map((i) => (
              <div key={i.label} className="flex items-center gap-3">
                <span className="w-32 shrink-0 truncate text-xs text-[var(--cs-text-muted)]">{i.label}</span>
                <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--cs-bg)]">
                  <div className="h-full rounded-full bg-[var(--cs-accent)]" style={{ width: `${(i.totalPaise / maxItem) * 100}%` }} />
                </div>
                <span className="w-20 shrink-0 text-right text-xs font-medium tabular-nums text-[var(--cs-text)]">{formatPaise(i.totalPaise)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// -------------------------------------------------------------- Invoice detail

function InvoiceDetailModal({ invoice, studentName, payments, onClose, onChanged }: any) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const canVoid = (user?.role_type === "admin" || user?.role === "admin") && invoice.status !== "paid" && invoice.status !== "void";
  const outstandingPaise = Math.max(0, (invoice.totalPaise || 0) - (invoice.paidPaise || 0));

  const events = useMemo(() => {
    const list: { label: string; at: string; tone?: ChipTone }[] = [];
    if (invoice.createdAt) list.push({ label: t("money.eventCreated"), at: invoice.createdAt });
    if (invoice.finalizedAt) list.push({ label: t("money.eventFinalized"), at: invoice.finalizedAt });
    for (const p of payments) list.push({ label: t("money.eventPaid", { amount: formatPaise(p.amountPaise), method: p.method || "manual" }), at: p.at, tone: "positive" });
    if (invoice.voidedAt) list.push({ label: t("money.eventVoided"), at: invoice.voidedAt, tone: "danger" });
    return list.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());
  }, [invoice, payments, t]);

  const download = async () => {
    try {
      await downloadInvoicePdf(invoice.id);
    } catch (err: any) {
      toast.error(t("money.pdfFailed"), { description: err.message });
    }
  };

  const share = async () => {
    try {
      const { shortUrl } = await createInvoicePaymentLink(invoice.id);
      const text = `Hi, here's the payment link for ${studentName}'s tuition invoice: ${shortUrl}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast.error(t("money.reminderFailed"), { description: err.message });
    }
  };

  const doVoid = async () => {
    try {
      await voidInvoice(invoice.id);
      toast.success(t("money.voided"));
      onChanged();
      onClose();
    } catch (err: any) {
      toast.error(t("money.voidFailed"), { description: err.message });
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">
              {invoice.invoiceNumber || `INV-${invoice.id.slice(0, 6).toUpperCase()}`}
            </h2>
            <p className="text-sm text-gray-500">{studentName}</p>
          </div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        <div className="mb-4 grid grid-cols-3 gap-3 rounded-[10px] border border-gray-100 bg-gray-50 p-3 text-center">
          <div>
            <div className="text-xs text-gray-500">{t("money.total")}</div>
            <div className="text-sm font-semibold">{formatPaise(invoice.totalPaise)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">{t("money.paid")}</div>
            <div className="text-sm font-semibold">{formatPaise(invoice.paidPaise)}</div>
          </div>
          <div>
            <div className="text-xs text-gray-500">{t("money.outstanding")}</div>
            <div className="text-sm font-semibold">{formatPaise(outstandingPaise)}</div>
          </div>
        </div>

        <div className="mb-4 flex items-center justify-between">
          <StatusChip label={invoice.status} tone={statusTone(invoice.status)} />
          {invoice.dueDate && <AgedBadge daysOverdue={Math.floor((Date.now() - new Date(invoice.dueDate).getTime()) / 86400000)} />}
        </div>

        <div className="mb-4 space-y-1.5">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-gray-500">{t("money.activity")}</h3>
          {events.map((e, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className={e.tone === "danger" ? "text-red-700" : e.tone === "positive" ? "text-green-700" : "text-gray-700"}>{e.label}</span>
              <span className="text-xs text-gray-400">{formatDate(e.at)}</span>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 pt-4">
          <button onClick={download} className="flex items-center gap-1.5 rounded-[6px] border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
            <Download className="h-4 w-4" /> {t("money.downloadPdf")}
          </button>
          {outstandingPaise > 0 && (
            <button onClick={share} className="flex items-center gap-1.5 rounded-[6px] border border-gray-300 px-3 py-1.5 text-sm hover:bg-gray-50">
              <Share2 className="h-4 w-4" /> {t("money.remind")}
            </button>
          )}
          {outstandingPaise > 0 && <RecordPaymentPopover invoiceId={invoice.id} outstandingPaise={outstandingPaise} />}
          {canVoid && (
            <button onClick={doVoid} className="ml-auto flex items-center gap-1.5 rounded-[6px] px-3 py-1.5 text-sm text-red-600 hover:bg-red-50">
              <XCircle className="h-4 w-4" /> {t("money.void")}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------- Create invoice

function CreateInvoiceModal({ students, userOrgId, prefillStudentId, onClose, onCreated }: any) {
  const { t } = useTranslation();
  const [templates, setTemplates] = useState<any[]>([]);
  const [studentId, setStudentId] = useState(prefillStudentId || "");
  const [lineItems, setLineItems] = useState([{ description: "", amount: 0, quantity: 1 }]);
  const [taxPercentage, setTaxPercentage] = useState(0);
  const [dueDate, setDueDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 7);
    return d.toISOString().split("T")[0];
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  React.useEffect(() => {
    if (!userOrgId) return;
    supabase.from("class_templates").select("*").eq("organization_id", userOrgId).limit(100).then(({ data }) => setTemplates(data || []));
  }, [userOrgId]);

  const addLine = () => setLineItems([...lineItems, { description: "", amount: 0, quantity: 1 }]);
  const removeLine = (i: number) => setLineItems(lineItems.filter((_, idx) => idx !== i));
  const setLine = (i: number, field: string, value: any) => {
    const next = [...lineItems];
    (next[i] as any)[field] = value;
    setLineItems(next);
  };
  const selectTemplate = (i: number, label: string) => {
    const template = templates.find((tpl) => `${tpl.type} - ${tpl.pricing_model}` === label);
    setLine(i, "description", label);
    if (template) setLine(i, "amount", template.fee_amount || 0);
  };

  const subtotal = lineItems.reduce((sum, item) => sum + item.amount * item.quantity, 0);
  const taxAmount = (subtotal * taxPercentage) / 100;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!studentId) {
      setError(t("money.studentRequired"));
      return;
    }
    setSaving(true);
    try {
      await createInvoice({ studentId, items: lineItems, taxPercentage, dueDate: dueDate || undefined });
      onCreated();
    } catch (err: any) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4">
      <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">{t("money.generateInvoice")}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>
        <form onSubmit={submit} className="space-y-4">
          {error && <div className="rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</div>}
          <div>
            <label className="mb-1 block text-sm font-medium text-gray-700">{t("money.student")}</label>
            <select required value={studentId} onChange={(e) => setStudentId(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm">
              <option value="" disabled>{t("money.selectStudent")}</option>
              {students.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-gray-700">{t("money.lineItems")}</label>
            <div className="space-y-2">
              {lineItems.map((item, i) => (
                <div key={i} className="flex items-start gap-2">
                  <input
                    type="text"
                    list="money-services-list"
                    required
                    value={item.description}
                    onChange={(e) => {
                      setLine(i, "description", e.target.value);
                      if (templates.some((tpl) => `${tpl.type} - ${tpl.pricing_model}` === e.target.value)) selectTemplate(i, e.target.value);
                    }}
                    placeholder={t("money.description")}
                    className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                  <input
                    type="number" required min="1" value={item.quantity}
                    onChange={(e) => setLine(i, "quantity", parseInt(e.target.value) || 1)}
                    className="w-16 rounded-md border border-gray-300 px-2 py-2 text-sm"
                  />
                  <input
                    type="number" required min="0" step="0.01" value={item.amount}
                    onChange={(e) => setLine(i, "amount", parseFloat(e.target.value) || 0)}
                    placeholder="₹"
                    className="w-24 rounded-md border border-gray-300 px-2 py-2 text-sm"
                  />
                  {lineItems.length > 1 && (
                    <button type="button" onClick={() => removeLine(i)} className="mt-2 text-red-500 hover:text-red-700">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
              <datalist id="money-services-list">
                {templates.map((tpl, i) => <option key={i} value={`${tpl.type} - ${tpl.pricing_model}`} />)}
              </datalist>
              <button type="button" onClick={addLine} className="flex items-center text-sm font-medium text-indigo-600 hover:text-indigo-800">
                <Plus className="mr-1 h-4 w-4" /> {t("money.addLineItem")}
              </button>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t("money.taxPercent")}</label>
              <input type="number" min="0" max="100" step="0.1" value={taxPercentage} onChange={(e) => setTaxPercentage(parseFloat(e.target.value) || 0)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-gray-700">{t("money.dueDate")}</label>
              <input type="date" required value={dueDate} onChange={(e) => setDueDate(e.target.value)} className="w-full rounded-md border border-gray-300 px-3 py-2 text-sm" />
            </div>
          </div>

          <div className="flex flex-col items-end border-t border-gray-100 pt-2">
            <p className="text-sm text-gray-500">{t("money.subtotal")}: ₹{subtotal.toFixed(2)}</p>
            {taxPercentage > 0 && <p className="text-sm text-gray-500">{t("money.tax")} ({taxPercentage}%): ₹{taxAmount.toFixed(2)}</p>}
            <p className="mt-1 text-lg font-bold text-gray-900">{t("money.total")}: ₹{(subtotal + taxAmount).toFixed(2)}</p>
          </div>

          <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
            <button type="button" onClick={onClose} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              {t("money.cancel")}
            </button>
            <button type="submit" disabled={saving} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50">
              {saving ? t("money.saving") : t("money.generateInvoice")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// -------------------------------------------------------------- Self (student)

function SelfMoneyView() {
  const { t } = useTranslation();
  const { studentId, invoices, wallet, ledger, loading } = useSelfMoney();

  if (loading) {
    return (
      <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] divide-y divide-[var(--cs-border)]">
        {Array.from({ length: 3 }).map((_, i) => <SkeletonRow key={i} />)}
      </div>
    );
  }

  if (!studentId) {
    return <EmptyState icon={WalletIcon} title={t("money.noAccessTitle")} description={t("money.noAccessHint")} />;
  }

  const download = async (invoiceId: string) => {
    try {
      await downloadInvoicePdf(invoiceId);
    } catch (err: any) {
      toast.error(t("money.pdfFailed"), { description: err.message });
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-[var(--cs-text)]">{t("nav.money")}</h1>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <StatChip
          label={t("money.walletBalance")}
          value={wallet && wallet.balanceCredits > 0 ? t("money.creditsBalance", { count: wallet.balanceCredits }) : formatPaise(wallet?.balanceCurrencyPaise || 0)}
          icon={WalletIcon}
        />
        <StatChip
          label={t("money.outstandingTotal")}
          value={formatPaise(invoices.reduce((s: number, inv: MoneyInvoiceRow) => s + Math.max(0, (inv.totalPaise || 0) - (inv.paidPaise || 0)), 0))}
          icon={Receipt}
        />
      </div>

      <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <h3 className="border-b border-[var(--cs-border)] px-4 py-3 text-sm font-semibold text-[var(--cs-text)]">{t("money.invoices")}</h3>
        {invoices.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--cs-text-muted)]">{t("money.noInvoicesYet")}</p>
        ) : (
          <div className="divide-y divide-[var(--cs-border)]">
            {invoices.map((inv: MoneyInvoiceRow) => (
              <div key={inv.id} className="flex items-center justify-between px-4 py-3">
                <div>
                  <div className="text-sm text-[var(--cs-text)]">{inv.invoiceNumber || `INV-${inv.id.slice(0, 6).toUpperCase()}`}</div>
                  <div className="text-xs text-[var(--cs-text-muted)]">{t("money.due")} {formatDate(inv.dueDate || inv.createdAt || "")}</div>
                </div>
                <div className="flex items-center gap-3">
                  <StatusChip label={inv.status} tone={statusTone(inv.status)} />
                  <span className="text-sm font-medium tabular-nums">{formatPaise(inv.totalPaise)}</span>
                  <button onClick={() => download(inv.id)} title={t("money.downloadPdf")} className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-accent)]">
                    <Download className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <h3 className="border-b border-[var(--cs-border)] px-4 py-3 text-sm font-semibold text-[var(--cs-text)]">{t("money.ledger")}</h3>
        {ledger.length === 0 ? (
          <p className="px-4 py-8 text-center text-sm text-[var(--cs-text-muted)]">{t("money.noLedgerYet")}</p>
        ) : (
          <div className="divide-y divide-[var(--cs-border)]">
            {ledger.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between px-4 py-2.5 text-sm">
                <div>
                  <span className="text-[var(--cs-text)]">{entry.reason}</span>
                  <span className="ml-2 text-xs text-[var(--cs-text-muted)]">{formatDate(entry.at)}</span>
                </div>
                <span className={entry.paise > 0 || entry.credits > 0 ? "text-green-700" : "text-red-700"}>
                  {entry.credits !== 0 ? `${entry.credits > 0 ? "+" : ""}${entry.credits} ${t("money.creditsUnit")}` : `${entry.paise > 0 ? "+" : ""}${formatPaise(entry.paise)}`}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
      <p className="text-xs text-[var(--cs-text-muted)]">{t("money.selfTopUpUnsupported")}</p>
    </div>
  );
}
