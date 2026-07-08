import React, { useState, useEffect } from "react";
import { CreditCard, DollarSign, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, getDocs, updateDoc, doc, limit } from "firebase/firestore";
import { db } from "../firebase";
import LoadingSpinner from "../components/LoadingSpinner";
import { formatINR } from "../lib/format";

export default function Transactions() {
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isTopUpModalOpen, setIsTopUpModalOpen] = useState(false);
  const [topUpAmount, setTopUpAmount] = useState("");

  useEffect(() => {
    if (!user?.organizationId || !user?.id) return;

    const q = query(
      collection(db, "transactions"),
      where("organizationId", "==", user.organizationId),
      where("studentId", "==", user.id),
      orderBy("date", "desc"),
      limit(50)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const txData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setTransactions(txData);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching transactions:", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleTopUp = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.organizationId || !user?.id || !topUpAmount) return;

    try {
      const amount = parseFloat(topUpAmount);
      
      // Add transaction record
      await addDoc(collection(db, "transactions"), {
        organizationId: user.organizationId,
        studentId: user.id,
        type: 'topup',
        amount: amount,
        date: new Date().toISOString(),
        method: 'Credit Card', // Mock method
        description: 'Wallet Top-up',
        createdAt: serverTimestamp()
      });

      // Update wallet balance
      const walletQuery = query(
        collection(db, "wallets"),
        where("studentId", "==", user.id)
      );
      const walletSnapshot = await getDocs(walletQuery);
      
      if (!walletSnapshot.empty) {
        const walletDoc = walletSnapshot.docs[0];
        const currentBalance = walletDoc.data().balanceCredits || 0;
        await updateDoc(doc(db, "wallets", walletDoc.id), {
          balanceCredits: currentBalance + amount,
          updatedAt: serverTimestamp()
        });
      } else {
        // Create wallet if it doesn't exist
        await addDoc(collection(db, "wallets"), {
          organizationId: user.organizationId,
          studentId: user.id,
          balanceCredits: amount,
          balanceCurrency: 'USD',
          updatedAt: serverTimestamp()
        });
      }

      setIsTopUpModalOpen(false);
      setTopUpAmount("");
    } catch (error) {
      console.error("Error adding top-up:", error);
    }
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
            {transactions.map((tx) => (
              <li key={tx.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                <div className="flex items-center">
                  <div className={`p-2 rounded-lg mr-4 ${tx.type === 'topup' ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600'}`}>
                    {tx.type === 'topup' ? <ArrowUpRight className="w-6 h-6" /> : <ArrowDownRight className="w-6 h-6" />}
                  </div>
                  <div>
                    <p className="text-sm font-medium text-gray-900 capitalize">{tx.type === 'topup' ? 'Wallet Top-up' : 'Session Deduction'}</p>
                    <p className="text-xs text-gray-500 mt-1">
                      {new Date(tx.date).toLocaleString()} • {tx.type === 'topup' ? tx.method : tx.description}
                    </p>
                  </div>
                </div>
                <div className="flex items-center space-x-3">
                  <span className={`text-sm font-bold ${tx.type === 'topup' ? 'text-green-600' : 'text-gray-900'}`}>
                    {tx.type === 'topup' ? '+' : '-'}{formatINR(tx.amount)}
                  </span>
                </div>
              </li>
            ))}
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
                  onClick={() => setIsTopUpModalOpen(false)}
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
