import { useState, useEffect, useMemo } from "react";
import { collection, query, where, onSnapshot, doc, getDoc } from "firebase/firestore";
import { toast } from "sonner";
import { CalendarClock, Wallet as WalletIcon, Receipt, Share2, ExternalLink, Users } from "lucide-react";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { EmptyState, Skeleton, SkeletonText, StatChip, StatusChip, type ChipTone } from "../components/kit";
import { formatPaise, formatINR, formatDate, formatRelativeDays } from "../lib/format";
import { payInvoiceAsParent } from "../lib/api";

// Epic 10 (parent portal v1, mobile-web-first). One page, three tabs, no new
// routes: a parent's whole world is "which of my kids, what do I owe, what
// happened." All reads are direct Firestore listeners gated by parent_links
// (firestore.rules `isParentOf`); the only write path is the two server
// calls in src/lib/api.ts (invite redemption happened in Onboarding).

type Tab = "overview" | "invoices" | "wallet";

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

  // Resolve linked children from parent_links, then hydrate each student doc.
  useEffect(() => {
    if (!user?.id) return;
    const q = query(collection(db, "parent_links"), where("parentUserId", "==", user.id));
    const unsub = onSnapshot(q, async (snap) => {
      const links = snap.docs.map((d) => d.data() as { studentId: string });
      const resolved = await Promise.all(
        links.map(async (l): Promise<Child | null> => {
          const sSnap = await getDoc(doc(db, "students", l.studentId));
          return sSnap.exists()
            ? { studentId: l.studentId, name: sSnap.data().name || "Student", grade: sSnap.data().grade }
            : null;
        })
      );
      const kids = resolved.filter((c): c is Child => c !== null);
      setChildren(kids);
      setLoadingChildren(false);
      setSelectedId((prev) => prev && kids.some((k) => k.studentId === prev) ? prev : kids[0]?.studentId || null);
    });
    return () => unsub();
  }, [user?.id]);

  useEffect(() => {
    if (!user?.id || !selectedId) { setSessions([]); setInvoices([]); setPayments([]); setWallet(null); return; }

    const qSessions = query(collection(db, "class_sessions"), where("parentUserIds", "array-contains", user.id));
    const unsubSessions = onSnapshot(qSessions, (snap) => {
      const upcoming = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as UpcomingSession))
        .filter((s) => (!s.studentIds || s.studentIds.includes(selectedId)) && toDate(s.startTime).getTime() >= Date.now() - 3600_000)
        .sort((a, b) => toDate(a.startTime).getTime() - toDate(b.startTime).getTime())
        .slice(0, 5);
      setSessions(upcoming);
    });

    const qInvoices = query(collection(db, "invoices"), where("studentId", "==", selectedId));
    const unsubInvoices = onSnapshot(qInvoices, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as Invoice))
        .sort((a, b) => toDate(b.dueDate).getTime() - toDate(a.dueDate).getTime());
      setInvoices(list);
    });

    const qPayments = query(collection(db, "payments"), where("studentId", "==", selectedId));
    const unsubPayments = onSnapshot(qPayments, (snap) => {
      const list = snap.docs
        .map((d) => ({ id: d.id, ...d.data() } as PaymentRecord))
        .sort((a, b) => toDate(b.at).getTime() - toDate(a.at).getTime());
      setPayments(list);
    });

    const qWallet = query(collection(db, "wallets"), where("studentId", "==", selectedId));
    const unsubWallet = onSnapshot(qWallet, (snap) => {
      if (snap.empty) { setWallet(null); return; }
      const w = snap.docs[0].data();
      setWallet({ balanceCredits: w.balanceCredits || 0, balanceCurrency: w.balanceCurrency || 0 });
    });

    return () => { unsubSessions(); unsubInvoices(); unsubPayments(); unsubWallet(); };
  }, [user?.id, selectedId]);

  const outstandingPaise = useMemo(
    () => invoices.filter((i) => PAYABLE_STATUSES.has(i.status)).reduce((sum, i) => sum + ((i.totalPaise ?? Math.round((i.totalAmount || 0) * 100)) - (i.paidPaise || 0)), 0),
    [invoices]
  );

  async function handlePay(invoiceId: string) {
    setPayingId(invoiceId);
    try {
      const { shortUrl } = await payInvoiceAsParent(invoiceId);
      window.location.href = shortUrl;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't start payment");
    } finally {
      setPayingId(null);
    }
  }

  async function handleShare(invoiceId: string) {
    try {
      const { shortUrl } = await payInvoiceAsParent(invoiceId);
      const text = `Tuition payment link: ${shortUrl}`;
      window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Couldn't create a link to share");
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
        title="No linked children yet"
        description="Ask your tutoring center for an invite link, then complete linking from your onboarding page."
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
              className={`shrink-0 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors ${
                c.studentId === selectedId
                  ? "border-[var(--cs-accent)] bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]"
                  : "border-[var(--cs-border)] text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)]"
              }`}
            >
              {c.name}
            </button>
          ))}
        </div>
      )}

      <div className="grid grid-cols-3 gap-2">
        <StatChip label="Outstanding" value={formatPaise(outstandingPaise)} tone={outstandingPaise > 0 ? "warn" : "positive"} />
        <StatChip label="Credits" value={wallet?.balanceCredits ?? 0} />
        <StatChip label="Next class" value={sessions[0] ? formatRelativeDays(toDate(sessions[0].startTime)) : "—"} />
      </div>

      <div className="flex gap-1 rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-1">
        {([
          ["overview", "Overview", CalendarClock],
          ["invoices", "Invoices", Receipt],
          ["wallet", "Wallet", WalletIcon],
        ] as const).map(([id, label, Icon]) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={`flex flex-1 items-center justify-center gap-1.5 rounded-[6px] py-2 text-sm font-medium transition-colors ${
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
          <h2 className="px-1 text-sm font-semibold text-[var(--cs-text)]">Upcoming for {selected.name}</h2>
          {sessions.length === 0 ? (
            <EmptyState icon={CalendarClock} title="No upcoming classes" description="Nothing scheduled right now." />
          ) : (
            <div className="divide-y divide-[var(--cs-border)] rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
              {sessions.map((s) => (
                <div key={s.id} className="flex items-center justify-between px-3 py-2.5">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-[var(--cs-text)]">{s.title || "Class session"}</p>
                    <p className="text-xs text-[var(--cs-text-muted)]">{formatDate(toDate(s.startTime))} · {formatRelativeDays(toDate(s.startTime))}</p>
                  </div>
                  <StatusChip label={s.isOnline ? "Online" : "In-person"} tone="neutral" />
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {tab === "invoices" && (
        <div className="space-y-3">
          {invoices.length === 0 ? (
            <EmptyState icon={Receipt} title="No invoices yet" description={`Nothing has been billed for ${selected.name} yet.`} />
          ) : (
            <div className="space-y-2">
              {invoices.map((inv) => {
                const total = inv.totalPaise ?? Math.round((inv.totalAmount || 0) * 100);
                const due = total - (inv.paidPaise || 0);
                const payable = PAYABLE_STATUSES.has(inv.status);
                return (
                  <div key={inv.id} className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-3">
                    <div className="flex items-start justify-between">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-[var(--cs-text)]">
                          {inv.invoiceNumber || inv.items?.[0]?.description || "Invoice"}
                        </p>
                        {inv.dueDate && <p className="text-xs text-[var(--cs-text-muted)]">Due {formatDate(inv.dueDate)}</p>}
                      </div>
                      <StatusChip label={inv.status.replace("_", " ")} tone={STATUS_TONE[inv.status] || "neutral"} />
                    </div>
                    <p className="mt-2 text-lg font-semibold tabular-nums text-[var(--cs-text)]">{formatPaise(total)}</p>
                    {payable && due > 0 && (
                      <div className="mt-2 flex gap-2">
                        <button
                          onClick={() => handlePay(inv.id)}
                          disabled={payingId === inv.id}
                          className="flex flex-1 items-center justify-center gap-1.5 rounded-[6px] bg-[var(--cs-accent)] px-3 py-2 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:opacity-50"
                        >
                          <ExternalLink className="h-3.5 w-3.5" strokeWidth={1.75} />
                          {payingId === inv.id ? "Opening…" : `Pay ${formatPaise(due)}`}
                        </button>
                        <button
                          onClick={() => handleShare(inv.id)}
                          title="Share via WhatsApp"
                          className="flex items-center justify-center rounded-[6px] border border-[var(--cs-border)] px-3 py-2 text-sm text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)]"
                        >
                          <Share2 className="h-4 w-4" strokeWidth={1.75} />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {tab === "wallet" && (
        <div className="space-y-4">
          <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4 text-center">
            <p className="text-xs font-medium text-[var(--cs-text-muted)]">Wallet balance</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-[var(--cs-text)]">
              {wallet?.balanceCredits || 0} credits
            </p>
            <p className="text-sm text-[var(--cs-text-muted)]">{formatINR(wallet?.balanceCurrency || 0)}</p>
          </div>

          <h2 className="px-1 text-sm font-semibold text-[var(--cs-text)]">Payment history</h2>
          {payments.length === 0 ? (
            <EmptyState icon={Receipt} title="No payments yet" />
          ) : (
            <div className="divide-y divide-[var(--cs-border)] rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
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
    </div>
  );
}
