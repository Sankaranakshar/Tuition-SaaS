import { useEffect, useState, useCallback } from "react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { useRealtimeList } from "./useRealtimeList";
import type { MoneyInvoice, MoneyWallet, MoneyPayment } from "../lib/money";

// One hook per Money data need (REDESIGN §6.4), mirroring the usePeople.ts
// pattern: each owns its query, bounding, Realtime subscription, and error
// state. Every subscribed table must already be in the supabase_realtime
// publication (HANDOFF §16.2); invoices, payments, wallets, students are.

export interface MoneyInvoiceRow extends MoneyInvoice {
  invoiceNumber?: string | null;
  paymentLink?: { shortUrl?: string; status?: string } | null;
  createdAt?: string;
  finalizedAt?: string | null;
  voidedAt?: string | null;
  tutorId?: string | null;
}

export function useMoneyInvoices() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const load = useCallback(async (): Promise<MoneyInvoiceRow[]> => {
    if (!orgId) return [];
    let q = supabase
      .from("invoices")
      .select("*")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(500);
    // tutor_id is null for invoices created by an account whose org-membership
    // role isn't literally "tutor" (e.g. the owner who bootstrapped the org —
    // DEV_PLAN Tech Debt #25's role_type/org-role split). Scoping strictly to
    // `tutor_id = user.id` would hide those invoices from their own creator;
    // include untagged ones too so a solo owner-tutor still sees their invoices.
    if (user!.role === "tutor") q = q.or(`tutor_id.eq.${user!.id},tutor_id.is.null`);
    const { data, error } = await q;
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      studentId: row.student_id,
      status: row.status,
      dueDate: row.due_date,
      totalPaise: row.total_paise,
      paidPaise: row.paid_paise,
      items: row.items,
      invoiceNumber: row.invoice_number,
      paymentLink: row.payment_link,
      createdAt: row.created_at,
      lastPaymentAt: row.last_payment_at,
      finalizedAt: row.finalized_at,
      voidedAt: row.voided_at,
      tutorId: row.tutor_id,
    }));
  }, [orgId, user?.role, user?.id]);
  return useRealtimeList<MoneyInvoiceRow>("money", "invoices", orgId, load);
}

export function useMoneyWallets() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const load = useCallback(async (): Promise<MoneyWallet[]> => {
    if (!orgId) return [];
    const [{ data: wallets, error: wErr }, { data: students, error: sErr }] = await Promise.all([
      supabase.from("wallets").select("*").eq("organization_id", orgId).limit(500),
      supabase.from("students").select("id, name").eq("organization_id", orgId).limit(500),
    ]);
    if (wErr) throw wErr;
    if (sErr) throw sErr;
    const nameOf = new Map((students || []).map((s: any) => [s.id, s.name]));
    return (wallets || []).map((row: any) => ({
      studentId: row.student_id,
      studentName: nameOf.get(row.student_id) || "Unknown student",
      balanceCredits: row.balance_credits || 0,
      balanceCurrencyPaise: Math.round((row.balance_currency || 0) * 100),
    }));
  }, [orgId]);
  return useRealtimeList<MoneyWallet>("money", "wallets", orgId, load);
}

export function useMoneyPayments() {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const load = useCallback(async (): Promise<(MoneyPayment & { id: string; invoiceId: string | null })[]> => {
    if (!orgId) return [];
    const { data, error } = await supabase
      .from("payments")
      .select("id, invoice_id, amount_paise, method, at")
      .eq("organization_id", orgId)
      .order("at", { ascending: false })
      .limit(1000);
    if (error) throw error;
    return (data || []).map((row: any) => ({
      id: row.id,
      invoiceId: row.invoice_id,
      amountPaise: row.amount_paise,
      at: row.at,
      method: row.method,
    }));
  }, [orgId]);
  return useRealtimeList<MoneyPayment & { id: string; invoiceId: string | null; method?: string | null }>(
    "money",
    "payments",
    orgId,
    load
  );
}

/** Average PER_SESSION template fee, in paise — the wallets segment's depletion estimate for currency-only balances. */
export function useAvgSessionFeePaise(): number {
  const { user } = useAuth();
  const orgId = user?.organizationId;
  const [avgPaise, setAvgPaise] = useState(0);

  useEffect(() => {
    if (!orgId) return;
    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("class_templates")
        .select("fee_amount")
        .eq("organization_id", orgId)
        .eq("pricing_model", "PER_SESSION")
        .limit(200);
      if (cancelled || error || !data || data.length === 0) return;
      const rupees = data.reduce((sum: number, row: any) => sum + (row.fee_amount || 0), 0) / data.length;
      setAvgPaise(Math.round(rupees * 100));
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  return avgPaise;
}

// ---- Student self-view (replaces Wallet.tsx / Transactions.tsx) ------------

export interface WalletLedgerEntry {
  id: string;
  type: string;
  credits: number;
  paise: number;
  reason: string;
  at: string;
}

export interface SelfMoney {
  studentId: string | null;
  invoices: MoneyInvoiceRow[];
  wallet: MoneyWallet | null;
  ledger: WalletLedgerEntry[];
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

/** A logged-in student's own invoices, wallet balance, and ledger history. */
export function useSelfMoney(): SelfMoney {
  const { user } = useAuth();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [invoices, setInvoices] = useState<MoneyInvoiceRow[]>([]);
  const [wallet, setWallet] = useState<MoneyWallet | null>(null);
  const [ledger, setLedger] = useState<WalletLedgerEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const refetch = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    (async () => {
      try {
        const { data: student, error: sErr } = await supabase
          .from("students")
          .select("id, name")
          .eq("student_user_id", user.id)
          .maybeSingle();
        if (sErr) throw sErr;
        if (!student) {
          if (!cancelled) {
            setStudentId(null);
            setLoading(false);
          }
          return;
        }
        if (cancelled) return;
        setStudentId(student.id);

        const [{ data: inv, error: iErr }, { data: w, error: wErr }, { data: led, error: lErr }] = await Promise.all([
          supabase.from("invoices").select("*").eq("student_id", student.id).order("created_at", { ascending: false }).limit(100),
          supabase.from("wallets").select("*").eq("student_id", student.id).maybeSingle(),
          supabase.from("wallet_ledger").select("*").eq("student_id", student.id).order("at", { ascending: false }).limit(100),
        ]);
        if (iErr) throw iErr;
        if (wErr) throw wErr;
        if (lErr) throw lErr;
        if (cancelled) return;

        setInvoices(
          (inv || []).map((row: any) => ({
            id: row.id,
            studentId: row.student_id,
            status: row.status,
            dueDate: row.due_date,
            totalPaise: row.total_paise,
            paidPaise: row.paid_paise,
            items: row.items,
            invoiceNumber: row.invoice_number,
            paymentLink: row.payment_link,
            createdAt: row.created_at,
            lastPaymentAt: row.last_payment_at,
          }))
        );
        setWallet(
          w
            ? {
                studentId: student.id,
                studentName: student.name,
                balanceCredits: w.balance_credits || 0,
                balanceCurrencyPaise: Math.round((w.balance_currency || 0) * 100),
              }
            : { studentId: student.id, studentName: student.name, balanceCredits: 0, balanceCurrencyPaise: 0 }
        );
        setLedger(
          (led || []).map((row: any) => ({
            id: row.id,
            type: row.type,
            credits: row.credits,
            paise: row.paise,
            reason: row.reason,
            at: row.at,
          }))
        );
        setError(null);
      } catch (err: any) {
        if (!cancelled) setError(err?.message || "Could not load your balance");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user, tick]);

  useEffect(() => {
    if (!studentId) return;
    const channel = supabase
      .channel(`money-self-${studentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices", filter: `student_id=eq.${studentId}` }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `student_id=eq.${studentId}` }, refetch)
      .on("postgres_changes", { event: "*", schema: "public", table: "wallet_ledger", filter: `student_id=eq.${studentId}` }, refetch)
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [studentId, refetch]);

  return { studentId, invoices, wallet, ledger, loading, error, refetch };
}
