import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { useTranslation } from "react-i18next";
import { CalendarClock, Wallet as WalletIcon, Receipt, Share2, ExternalLink, Users, Download, Settings as SettingsIcon } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { EmptyState, Skeleton, SkeletonText, StatChip, StatusChip, Button, Field, Input, type ChipTone } from "../components/kit";
import StudentPaymentPermissions from "../components/StudentPaymentPermissions";
import { formatPaise, formatINR, formatDate, formatTime, formatRelativeDays } from "../lib/format";
import { rupeesToPaise } from "../../shared/money";
import { cancellationCutoff, DEFAULT_CANCELLATION_POLICY, type CancellationPolicy } from "../../shared/cancellationPolicy";
import { getOrgCancellationPolicy } from "../lib/cancellationPolicy";
import { payInvoiceAsParent, downloadInvoicePdf, topUpWalletAsParent } from "../lib/api";
import { debounce } from "../lib/debounce";

// Epic 10 (parent portal v1, mobile-web-first). One page, three tabs, no new
// routes: a parent's whole world is "which of my kids, what do I owe, what
// happened." All reads are Supabase selects + realtime refetch-on-change,
// gated by RLS (`parent_links_select`, `is_parent_of()` on the money
// tables); the only write path is the two server calls in src/lib/api.ts
// (invite redemption happened in Onboarding).
//
// Note: `payments_select` RLS only grants staff read access (see
// supabase/migrations/0002_rls.sql) — parents currently get an empty result
// from the payments query below, not an error. That's an RLS-policy gap,
// not something this read-side pass is scoped to fix.

type Tab = "overview" | "invoices" | "wallet" | "settings";

interface Child {
  studentId: string;
  name: string;
  grade?: string;
}

interface Invoice {
  id: string;
  status: string;
  totalPaise: number;
  paidPaise: number;
  totalAmount?: number;
  dueDate?: string;
  invoiceNumber?: string;
  items?: { description: string }[];
}

interface PaymentRecord {
  id: string;
  amountPaise: number;
  method: string;
  at: any;
}

interface UpcomingSession {
  id: string;
  title?: string;
  startTime: any;
  isOnline?: boolean;
  studentIds?: string[];
}

const PAYABLE_STATUSES = new Set(["draft", "sent", "unpaid", "partially_paid"]);

const STATUS_TONE: Record<string, ChipTone> = {
  draft: "neutral",
  sent: "accent",
  unpaid: "warn",
  partially_paid: "warn",
  paid: "positive",
  void: "neutral",
};

function toDate(v: any): Date {
  if (!v) return new Date(0);
  if (typeof v?.toDate === "function") return v.toDate();
  return new Date(v);
}

export default function ParentPortal() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [children, setChildren] = useState<Child[]>([]);
  const [loadingChildren, setLoadingChildren] = useState(true);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("overview");

  const [sessions, setSessions] = useState<UpcomingSession[]>([]);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [wallet, setWallet] = useState<{ balanceCredits: number; balanceCurrency: number } | null>(null);
  const [payingId, setPayingId] = useState<string | null>(null);
  const [topupAmount, setTopupAmount] = useState("");
  const [toppingUp, setToppingUp] = useState(false);
  // Step 3 (EXECUTION_PLAN.md): D-08's per-org policy, read once per org
  // (not per selected child — cancellation policy is org-wide). Seeded with
  // the coded defaults so the disclosure renders immediately, same pattern
  // as OrganizationSettings.tsx's initial state, then corrected on fetch.
  const [cancellationPolicy, setCancellationPolicy] = useState<CancellationPolicy>(DEFAULT_CANCELLATION_POLICY);

  useEffect(() => {
    if (!user?.organizationId) return;
    let cancelled = false;
    getOrgCancellationPolicy(user.organizationId)
      .then((policy) => { if (!cancelled) setCancellationPolicy(policy); })
      .catch(() => {}); // disclosure just keeps showing the coded defaults
    return () => { cancelled = true; };
  }, [user?.organizationId]);

  // Resolve linked children from parent_links, then hydrate each student row.
  useEffect(() => {
    if (!user?.id) return;
    let cancelled = false;

    const load = async () => {
      const { data: links, error: linksErr } = await supabase
        .from("parent_links")
        .select("student_id")
        .eq("parent_user_id", user.id)
        .limit(50);
      if (cancelled || linksErr || !links) return;

      const studentIds = links.map((l) => l.student_id as string);
      if (studentIds.length === 0) {
        setChildren([]);
        setLoadingChildren(false);
        setSelectedId(null);
        return;
      }

      const { data: rows, error: studentsErr } = await supabase
        .from("students")
        .select("id, name, grade")
        .in("id", studentIds);
      if (cancelled || studentsErr || !rows) return;

      const kids: Child[] = rows.map((s) => ({ studentId: s.id as string, name: (s.name as string) || t("parentPortal.studentFallback"), grade: s.grade as string | undefined }));
      setChildren(kids);
      setLoadingChildren(false);
      setSelectedId((prev) => (prev && kids.some((k) => k.studentId === prev) ? prev : kids[0]?.studentId || null));
    };

    load();
    const channel = supabase
      .channel(`parent-links-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "parent_links", filter: `parent_user_id=eq.${user.id}` }, debounce(load, 200))
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !selectedId) { setSessions([]); setInvoices([]); setPayments([]); setWallet(null); return; }
    let cancelled = false;

    const loadSessions = async () => {
      const { data, error } = await supabase
        .from("class_sessions")
        .select("id, start_time, is_online, student_ids")
        .contains("parent_user_ids", [user.id])
        .limit(50);
      if (cancelled || error || !data) return;
      const upcoming = data
        .map((d) => ({ id: d.id, startTime: d.start_time, isOnline: d.is_online, studentIds: d.student_ids } as UpcomingSession))
        .filter((s) => (!s.studentIds || s.studentIds.includes(selectedId)) && toDate(s.startTime).getTime() >= Date.now() - 3600_000)
        .sort((a, b) => toDate(a.startTime).getTime() - toDate(b.startTime).getTime())
        .slice(0, 5);
      setSessions(upcoming);
    };

    const loadInvoices = async () => {
      const { data, error } = await supabase
        .from("invoices")
        .select("id, status, total_paise, paid_paise, total_amount, due_date, invoice_number, items")
        .eq("student_id", selectedId)
        .limit(50);
      if (cancelled || error || !data) return;
      const list = data
        .map((d) => ({
          id: d.id,
          status: d.status,
          totalPaise: d.total_paise,
          paidPaise: d.paid_paise,
          totalAmount: d.total_amount ?? undefined,
          dueDate: d.due_date ?? undefined,
          invoiceNumber: d.invoice_number ?? undefined,
          items: d.items as { description: string }[] | undefined,
        } as Invoice))
        .sort((a, b) => toDate(b.dueDate).getTime() - toDate(a.dueDate).getTime());
      setInvoices(list);
    };

    // payments_select RLS is staff-only today, so this returns empty for a
    // parent session; kept as a direct translation of the old query.
    const loadPayments = async () => {
      const { data, error } = await supabase
        .from("payments")
        .select("id, amount_paise, method, at")
        .eq("student_id", selectedId)
        .limit(50);
      if (cancelled || error || !data) return;
      const list = data
        .map((d) => ({ id: d.id, amountPaise: d.amount_paise, method: d.method, at: d.at } as PaymentRecord))
        .sort((a, b) => toDate(b.at).getTime() - toDate(a.at).getTime());
      setPayments(list);
    };

    const loadWallet = async () => {
      const { data, error } = await supabase
        .from("wallets")
        .select("balance_credits, balance_currency")
        .eq("student_id", selectedId)
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      if (error || !data) { setWallet(null); return; }
      setWallet({ balanceCredits: data.balance_credits || 0, balanceCurrency: data.balance_currency || 0 });
    };

    loadSessions();
    loadInvoices();
    loadPayments();
    loadWallet();

    const channel = supabase
      .channel(`parent-portal-${selectedId}`)
      // postgres_changes filters only support a single `column=eq.value`
      // condition, and membership here is an array-contains check, so this
      // listens broadly and re-applies the real filter inside loadSessions().
      .on("postgres_changes", { event: "*", schema: "public", table: "class_sessions" }, debounce(loadSessions, 200))
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices", filter: `student_id=eq.${selectedId}` }, debounce(loadInvoices, 200))
      .on("postgres_changes", { event: "*", schema: "public", table: "payments", filter: `student_id=eq.${selectedId}` }, debounce(loadPayments, 200))
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `student_id=eq.${selectedId}` }, debounce(loadWallet, 200))
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [user?.id, selectedId]);

  const outstandingPaise = useMemo(
    () => invoices.filter((i) => PAYABLE_STATUSES.has(i.status)).reduce((sum, i) => sum + ((i.totalPaise ?? rupeesToPaise(i.totalAmount || 0)) - (i.paidPaise || 0)), 0),
    [invoices]
  );

  async function handlePay(invoiceId: string) {
    setPayingId(invoiceId);
    try {
      const { shortUrl } = await payInvoiceAsParent(invoiceId);
      window.location.href = shortUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("parentPortal.payFailed"));
    } finally {
      setPayingId(null);
    }
  }

  async function handleDownload(invoiceId: string) {
    try {
      await downloadInvoicePdf(invoiceId);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("parentPortal.downloadFailed"));
    }
  }

  async function handleShare(invoiceId: string) {
    try {
      const { shortUrl } = await payInvoiceAsParent(invoiceId);
      const text = `Tuition payment link: ${shortUrl}\n\n— sent via ClassStackr, fee-collection software for tuition centers: ${window.location.origin}/`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("parentPortal.shareFailed"));
    }
  }

  // B-05 self-serve parent top-up (EXECUTION_PLAN.md Step 7). No manual/cash
  // variant — always a real Razorpay charge, same reason recordManualPayment
  // has no parent-facing equivalent either.
  async function handleTopup() {
    if (!selectedId) return;
    const rupees = Number(topupAmount);
    if (!rupees || rupees <= 0) {
      toast.error(t("parentPortal.topupInvalidAmount"));
      return;
    }
    setToppingUp(true);
    try {
      const { shortUrl } = await topUpWalletAsParent(selectedId, rupeesToPaise(rupees));
      window.location.href = shortUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("parentPortal.topupFailed"));
    } finally {
      setToppingUp(false);
    }
  }

  if (loadingChildren) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-1">
        <Skeleton className="h-10 w-full" />
        <SkeletonText lines={4} />
      </div>
    );
  }

  if (children.length === 0) {
    return (
      <EmptyState
        icon={Users}
        title={t("parentPortal.noChildrenTitle")}
        description={t("parentPortal.noChildrenDescription")}
        className="mx-auto max-w-md"
      />
    );
  }

  const selected = children.find((c) => c.studentId === selectedId) || children[0];

  return (
    <div className="mx-auto max-w-md space-y-4 pb-8">
      {children.length > 1 && (
        <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
          {children.map((c) => (
            <button
              key={c.studentId}
              onClick={() => setSelectedId(c.studentId)}
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] ${
                c.studentId === selectedId
                  ? "border-[var(--cs-accent)] bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]"
                  : "border-[var(--cs-border)] text-[var(--cs-text-muted)] hover:bg-[var(--cs-surface-2)]"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <StatChip label={t("parentPortal.outstanding")} value={formatPaise(outstandingPaise)} tone={outstandingPaise > 0 ? "warn" : "positive"} />
        <StatChip label={t("parentPortal.credits")} value={wallet?.balanceCredits ?? 0} />
        <StatChip label={t("parentPortal.nextClass")} value={sessions[0] ? formatRelativeDays(toDate(sessions[0].startTime)) : "—"} />
      </div>

      <div className="flex gap-1 rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-1">
        {([
          ["overview", t("parentPortal.tabOverview"), CalendarClock],
          ["invoices", t("parentPortal.tabInvoices"), Receipt],
          ["wallet", t("parentPortal.tabWallet"), WalletIcon],
          ["settings", t("parentPortal.tabSettings"), SettingsIcon],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-[var(--cs-radius-control)] py-2 text-sm font-medium transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] ${
              tab === id ? "bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]" : "text-[var(--cs-text-muted)]"
            }`}
          >
            <Icon className="h-4 w-4" strokeWidth={1.75} />
            {label}
          </button>
        ))}
      </div>

      {tab === "overview" && (
        <div className="space-y-3">
          <h2 className="px-1 text-sm font-semibold text-[var(--cs-text)]">{t("parentPortal.upcomingFor", { name: selected.name })}</h2>
          {sessions.length === 0 ? (
            <EmptyState icon={CalendarClock} title={t("parentPortal.noUpcomingTitle")} description={t("parentPortal.noUpcomingDescription")} />
          ) : (
            <div className="divide-y divide-[var(--cs-border)] rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
              {sessions.map((s) => {
                const cutoff = cancellationCutoff(toDate(s.startTime), cancellationPolicy.freeHours);
                return (
                  <div key={s.id} className="px-3 py-2.5">
                    <div className="flex items-center justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--cs-text)]">{s.title || t("parentPortal.classSession")}</p>
                        <p className="text-xs text-[var(--cs-text-muted)]">{formatDate(toDate(s.startTime))} · {formatRelativeDays(toDate(s.startTime))}</p>
                      </div>
                      <StatusChip label={s.isOnline ? t("parentPortal.online") : t("parentPortal.inPerson")} tone="neutral" />
                    </div>
                    <p className="mt-1 text-xs text-[var(--cs-text-muted)]">
                      {t("schedule.cancellationDisclosure", {
                        cutoff: `${formatDate(cutoff)}, ${formatTime(cutoff)}`,
                        feePercent: cancellationPolicy.lateFeePercent,
                      })}
                    </p>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "invoices" && (
        <div className="space-y-3">
          {invoices.length === 0 ? (
            <EmptyState icon={Receipt} title={t("parentPortal.noInvoicesTitle")} description={t("parentPortal.noInvoicesDescription", { name: selected.name })} />
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => {
                const total = inv.totalPaise ?? rupeesToPaise(inv.totalAmount || 0);
                const due = total - (inv.paidPaise || 0);
                const payable = PAYABLE_STATUSES.has(inv.status);
                return (
                  <div key={inv.id} className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-3">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--cs-text)]">
                          {inv.invoiceNumber || inv.items?.[0]?.description || t("parentPortal.invoice")}
                        </p>
                        {inv.dueDate && <p className="text-xs text-[var(--cs-text-muted)]">{t("parentPortal.due", { date: formatDate(inv.dueDate) })}</p>}
                      </div>
                      <StatusChip label={inv.status.replace("_", " ")} tone={STATUS_TONE[inv.status] || "neutral"} />
                    </div>
                    <p className="mt-2 text-lg font-semibold tabular-nums text-[var(--cs-text)]">{formatPaise(total)}</p>
                    <div className="mt-2 flex gap-2">
                      {payable && due > 0 && (
                        <>
                          <Button
                            onClick={() => handlePay(inv.id)}
                            disabled={payingId === inv.id}
                            icon={ExternalLink}
                            className="flex-1"
                          >
                            {payingId === inv.id ? t("parentPortal.opening") : t("parentPortal.pay", { amount: formatPaise(due) })}
                          </Button>
                          <Button
                            variant="ghost"
                            onClick={() => handleShare(inv.id)}
                            title={t("parentPortal.shareViaWhatsapp")}
                            aria-label={t("parentPortal.shareViaWhatsapp")}
                            icon={Share2}
                          />
                        </>
                      )}
                      <Button
                        variant="ghost"
                        onClick={() => handleDownload(inv.id)}
                        title={t("parentPortal.downloadPdf")}
                        aria-label={t("parentPortal.downloadPdf")}
                        icon={Download}
                        className={payable && due > 0 ? "" : "flex-1"}
                      >
                        {(!payable || due <= 0) && t("parentPortal.downloadPdf")}
                      </Button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "wallet" && (
        <div className="space-y-4">
          <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4 text-center">
            <p className="text-xs font-medium text-[var(--cs-text-muted)]">{t("parentPortal.walletBalance")}</p>
            <p className="mt-1 text-[28px] font-semibold tabular-nums text-[var(--cs-text)]">
              {t("parentPortal.creditsCount", { count: wallet?.balanceCredits || 0 })}
            </p>
            <p className="text-sm text-[var(--cs-text-muted)]">{formatINR(wallet?.balanceCurrency || 0)}</p>
          </div>

          <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4">
            <p className="mb-2 text-sm font-medium text-[var(--cs-text)]">{t("parentPortal.topupTitle")}</p>
            <div className="flex items-end gap-2">
              <Field
                label={t("parentPortal.topupAmountLabel")}
                className="flex-1"
                renderControl={(id) => (
                  <div className="relative">
                    <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm text-[var(--cs-text-muted)]">₹</span>
                    <Input
                      id={id}
                      type="number"
                      min="1"
                      inputMode="decimal"
                      value={topupAmount}
                      onChange={(e) => setTopupAmount(e.target.value)}
                      className="pl-7"
                    />
                  </div>
                )}
              />
              <Button onClick={handleTopup} disabled={toppingUp || !topupAmount} className="shrink-0">
                {toppingUp ? t("parentPortal.topupOpening") : t("parentPortal.topupButton")}
              </Button>
            </div>
          </div>

          <h2 className="px-1 text-sm font-semibold text-[var(--cs-text)]">{t("parentPortal.paymentHistory")}</h2>
          {payments.length === 0 ? (
            <EmptyState icon={Receipt} title={t("parentPortal.noPaymentsTitle")} />
          ) : (
            <div className="divide-y divide-[var(--cs-border)] rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
              {payments.map((p) => (
                <div key={p.id} className="flex items-center justify-between px-3 py-2.5">
                  <div>
                    <p className="text-sm font-medium capitalize text-[var(--cs-text)]">{p.method.replace("_", " ")}</p>
                    <p className="text-xs text-[var(--cs-text-muted)]">{formatDate(toDate(p.at))}</p>
                  </div>
                  <p className="text-sm font-semibold tabular-nums text-[var(--cs-text)]">{formatPaise(p.amountPaise)}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "settings" && (
        <StudentPaymentPermissions studentId={selected.studentId} studentName={selected.name} />
      )}
    </div>
  );
}
