import { useState, useEffect } from "react";
import { DollarSign, Receipt, Download, CreditCard } from "lucide-react";
import { collection, query, where, onSnapshot, limit } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";
import { format, parseISO } from "date-fns";
import { Link } from "react-router-dom";
import LoadingSpinner from "../components/LoadingSpinner";
import { formatINR, formatPaise } from "../lib/format";

export default function Wallet() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [walletBalance, setWalletBalance] = useState<number>(0);

  useEffect(() => {
    if (!user) return;

    const qInvoices = query(
      collection(db, "invoices"),
      where("studentId", "==", user.id),
      limit(50)
    );
    
    const unsubInvoices = onSnapshot(qInvoices, (snapshot) => {
      const data = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as any));
      setInvoices(data.sort((a, b) => new Date(b.issueDate).getTime() - new Date(a.issueDate).getTime()));
      setLoading(false);
    });

    const qWallet = query(
      collection(db, "wallets"),
      where("studentId", "==", user.id),
      limit(1)
    );

    const unsubWallet = onSnapshot(qWallet, (snapshot) => {
      if (!snapshot.empty) {
        setWalletBalance(snapshot.docs[0].data().balanceCredits || 0);
      } else {
        setWalletBalance(0);
      }
    });

    return () => {
      unsubInvoices();
      unsubWallet();
    };
  }, [user]);

  if (loading) return <LoadingSpinner />;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Wallet & Billing</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Wallet Balance */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100 flex flex-col items-center justify-center text-center">
          <div className="w-16 h-16 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 mb-4">
            <DollarSign className="w-8 h-8" />
          </div>
          <h2 className="text-lg font-medium text-gray-500">Available Balance</h2>
          <p className="text-4xl font-bold text-gray-900 mt-2">{formatINR(walletBalance)}</p>
          <div className="mt-6 w-full space-y-3">
            <Link to="/app/transactions" className="w-full flex justify-center items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700">
              <CreditCard className="w-4 h-4 mr-2" />
              Top-up Wallet
            </Link>
          </div>
        </div>

        {/* Invoices */}
        <div className="lg:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <Receipt className="w-5 h-5 mr-2 text-indigo-500" />
              Recent Invoices
            </h2>
          </div>
          
          {invoices.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                    <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Action</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {invoices.map((invoice) => (
                    <tr key={invoice.id} className="hover:bg-gray-50 transition-colors duration-150">
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">INV-{invoice.id.substring(0, 6).toUpperCase()}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {invoice.issueDate ? format(parseISO(invoice.issueDate), 'MMM d, yyyy') : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                        {formatPaise(invoice.totalPaise ?? Math.round((invoice.amount || 0) * 100))}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2.5 py-1 inline-flex text-xs leading-5 font-semibold rounded-full ${
                          invoice.status === 'paid' ? 'bg-green-100 text-green-800' : 
                          invoice.status === 'pending' ? 'bg-yellow-100 text-yellow-800' : 'bg-red-100 text-red-800'
                        }`}>
                          {invoice.status ? invoice.status.charAt(0).toUpperCase() + invoice.status.slice(1) : 'Unknown'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button className="text-indigo-600 hover:text-indigo-900 flex items-center justify-end w-full">
                          <Download className="w-4 h-4 mr-1" /> PDF
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <div className="px-6 py-12 text-center">
              <Receipt className="mx-auto h-12 w-12 text-gray-300" />
              <h3 className="mt-2 text-sm font-medium text-gray-900">No invoices</h3>
              <p className="mt-1 text-sm text-gray-500">You don't have any invoices yet.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
