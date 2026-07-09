import React, { useState, useEffect } from "react";
import { CreditCard, DollarSign, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../supabase";
import LoadingSpinner from "../components/LoadingSpinner";
import { formatPaise } from "../lib/format";

export default function Transactions() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");
  const [topUpError, setTopUpError] = useState("");

  // The old Firestore `transactions` collection (organizationId/studentId/
  // type/amount/date/method/description fields) doesn't exist in that shape
  // on Supabase — `transactions` there is a generic event log (kind, jsonb
  // payload, no student_id column at all, staff-only RLS). Per-student
  // payment/credit history now lives in `wallet_ledger`, which does carry
  // student_id and has parent/student-self RLS read access — that's what
  // this page reads from now.
  useEffect(() => {
    if (!user?.organizationId || !user?.id) return;
    let cancelled = false;

    const load = async () => {
      const { data: studentRow, error: studentErr } = await supabase
        .from("students")
        .select("id")
        .eq("student_user_id", user.id)
        .maybeSingle();
      if (cancelled) return;
      if (studentErr || !studentRow) {
        setTransactions([]);
        setLoading(false);
        return;
      }
      const { data, error } = await supabase
        .from("wallet_ledger")
        .select("*")
        .eq("organization_id", user.organizationId)
        .eq("student_id", studentRow.id)
        .order("at", { ascending: false })
        .limit(50);
      if (cancelled) return;
      if (!error && data) setTransactions(data);
      setLoading(false);
    };

    load();
    const channel = supabase
      .channel(`wallet-ledger-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "wallet_ledger", filter: `organization_id=eq.${user.organizationId}` }, load)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [user]);

  // This page is always a self-view (it resolves the *logged-in user's own*
  // student row) — but the server's top-up route is deliberately staff-only
  // (POST /api/v1/billing/wallets/topup), same trust boundary as manual
  // payments: instantly crediting your own wallet from the client, with no
  // real payment behind it, is a fraud vector. The old Firestore version
  // "worked" only because it wrote straight to the client SDK with a fake
  // "Credit Card" method and no verification at all — that was never a real
  // payment path either. Rather than wire this button to an endpoint it will
  // always get a 403 from, be honest that self-serve top-up isn't supported:
  // top-ups are staff-recorded after a real payment is received in person.
  const handleTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    setTopUpError("Wallet top-ups are recorded by your tutoring center after payment is received — please contact them directly.");
  };

  if (loading) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Transactions</h1>
        <button 
          onClick={() => setIsTopUpModalOpen(true)}
          className="flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
        >
          <CreditCard className="w-4 h-4 mr-2" />
          Top-up Wallet
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            <DollarSign className="w-5 h-5 mr-2 text-indigo-500" />
            Payment History
          </h2>
        </div>
        
        {transactions.length > 0 ? (
          <ul className="divide-y divide-gray-100">
            {transactions.map((tx) => {
              const isCredit = (tx.paise || 0) > 0 || (tx.credits || 0) > 0;
              const label = tx.type === 'credit_currency' ? 'Wallet Top-up' : tx.type === 'debit_credit' ? 'Session Deduction' : tx.type === 'debit_currency' ? 'Wallet Debit' : tx.type;
              const amountLabel = tx.paise ? formatPaise(Math.abs(tx.paise)) : `${Math.abs(tx.credits || 0)} credits`;
              return (
                <li key={tx.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div className="flex items-center">
                    <div className={`p-2 rounded-lg mr-4 ${isCredit ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                      {isCredit ? <ArrowUpRight className="w-6 h-6" /> : <ArrowDownRight className="w-6 h-6" />}
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900 capitalize">{label}</p>
                      <p className="text-xs text-gray-500 mt-1">
                        {tx.at ? new Date(tx.at).toLocaleString() : ''} • {tx.reason}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className={`text-sm font-bold ${isCredit ? 'text-green-600' : 'text-gray-900'}`}>
                      {isCredit ? '+' : '-'}{amountLabel}
                    </span>
                  </div>
                </li>
              );
            })}
          </ul>
        ) : (
          <div className="p-8 text-center">
            <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
              <DollarSign className="w-8 h-8 text-gray-400" />
            </div>
            <h3 className="text-sm font-medium text-gray-900">No transactions yet</h3>
            <p className="text-sm text-gray-500 mt-1">Your payment history will appear here.</p>
          </div>
        )}
      </div>

      {/* Top-up Modal */}
      {isTopUpModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
            <h2 className="text-xl font-bold text-gray-900 mb-4">Top-up Wallet</h2>
            {topUpError && (
              <div className="mb-4 bg-amber-50 border border-amber-200 text-amber-800 px-3 py-2 rounded-md text-sm">
                {topUpError}
              </div>
            )}
            <form onSubmit={handleTopUp}>
              <div className="mb-4">
                <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹)</label>
                <input
                  type="number"
                  min="1"
                  step="0.01"
                  required
                  value={topUpAmount}
                  onChange={(e) => setTopUpAmount(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Enter amount"
                />
              </div>
              <div className="flex justify-end space-x-3">
                <button
                  type="button"
                  onClick={() => { setIsTopUpModalOpen(false); setTopUpError(""); }}
                  className="px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50 border border-gray-300 rounded-md transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 rounded-md transition-colors"
                >
                  Confirm Top-up
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
