import React, { useState, useEffect } from "react";
import { Plus, Receipt, CheckCircle, Download, FileSpreadsheet, AlertCircle, IndianRupee, Trash2 } from "lucide-react";
import { supabase } from "../supabase";
import { createInvoice, recordManualPayment, downloadInvoicePdf } from "../lib/api";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";

import LoadingSpinner from "../components/LoadingSpinner";

export default function Invoices() {
  const { user } = useAuth();
  const [invoices, setInvoices] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [wallets, setWallets] = useState<any[]>([]);
  const [masterServices, setMasterServices] = useState<any[]>([]);
  const [billingSettings, setBillingSettings] = useState<any>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form state
  const [studentId, setStudentId] = useState("");
  const [lineItems, setLineItems] = useState([{ description: "", amount: 0, quantity: 1 }]);
  const [issueDate, setIssueDate] = useState("");
  const [dueDate, setDueDate] = useState("");

  useEffect(() => {
    if (!user || !user.organizationId) return;
    const orgId = user.organizationId;
    let cancelled = false;

    const loadStudents = async () => {
      const { data, error } = await supabase.from("students").select("*").eq("organization_id", orgId).limit(100);
      if (!cancelled && !error) setStudents(data || []);
    };
    const loadTemplates = async () => {
      const { data, error } = await supabase.from("class_templates").select("*").eq("organization_id", orgId).limit(100);
      if (!cancelled && !error) setTemplates(data || []);
    };
    const loadWallets = async () => {
      const { data, error } = await supabase.from("wallets").select("*").eq("organization_id", orgId).limit(100);
      if (!cancelled && !error) setWallets(data || []);
    };
    // organizations.settings (billing/services config) is a plain jsonb
    // column on the org row itself, not a subcollection — no `settings`
    // field currently exists in 0001_schema.sql's `organizations` table.
    // Keeping this a no-op read (billingSettings stays {}) rather than
    // inventing a schema column for a display-only config blob.
    const loadOrgSettings = async () => {
      // organizations table has no `settings` jsonb column yet; nothing to load.
    };
    const loadInvoices = async () => {
      let q = supabase
        .from("invoices")
        .select("*")
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (user.role === "tutor") q = q.eq("tutor_id", user.id);
      const { data, error } = await q;
      if (!cancelled && !error) setInvoices(data || []);
      if (!cancelled) setLoading(false);
    };

    loadStudents();
    loadTemplates();
    loadWallets();
    loadOrgSettings();
    loadInvoices();

    const channel = supabase
      .channel(`invoices-page-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "students", filter: `organization_id=eq.${orgId}` }, loadStudents)
      .on("postgres_changes", { event: "*", schema: "public", table: "class_templates", filter: `organization_id=eq.${orgId}` }, loadTemplates)
      .on("postgres_changes", { event: "*", schema: "public", table: "wallets", filter: `organization_id=eq.${orgId}` }, loadWallets)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices", filter: `organization_id=eq.${orgId}` }, loadInvoices)
      .subscribe();

    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [user]);

  const handleAddLineItem = () => {
    setLineItems([...lineItems, { description: "", amount: 0, quantity: 1 }]);
  };

  const handleRemoveLineItem = (index: number) => {
    const newItems = [...lineItems];
    newItems.splice(index, 1);
    setLineItems(newItems);
  };

  const handleLineItemChange = (index: number, field: string, value: any) => {
    const newItems = [...lineItems];
    (newItems[index] as any)[field] = value;
    setLineItems(newItems);
  };

  const handleServiceSelect = (index: number, serviceName: string) => {
    const newItems = [...lineItems];
    newItems[index].description = serviceName;
    
    const masterService = masterServices.find(s => s.name === serviceName);
    if (masterService) {
      newItems[index].amount = masterService.defaultPrice;
    } else {
      const template = templates.find(t => `${t.type} - ${t.pricing_model}` === serviceName);
      if (template) {
        newItems[index].amount = template.fee_amount;
      }
    }
    
    setLineItems(newItems);
  };

  const totalAmount = lineItems.reduce((sum, item) => sum + (item.amount * item.quantity), 0);

  const handleOpenModal = () => {
    const today = new Date();
    setIssueDate(today.toISOString().split('T')[0]);
    
    if (billingSettings.defaultDueDays) {
      const due = new Date(today);
      due.setDate(today.getDate() + parseInt(billingSettings.defaultDueDays));
      setDueDate(due.toISOString().split('T')[0]);
    } else {
      setDueDate("");
    }
    
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user || !user.organizationId) return;

    const taxPercentage = billingSettings.taxPercentage || 0;

    try {
      await createInvoice({
        studentId,
        items: lineItems,
        taxPercentage,
        dueDate: dueDate || undefined,
      });
      setIsModalOpen(false);
      setStudentId("");
      setLineItems([{ description: "", amount: 0, quantity: 1 }]);
      setIssueDate("");
      setDueDate("");
    } catch (error: any) {
      console.error("Failed to create invoice:", error.message);
    }
  };

  // Records a manual payment for the full outstanding balance rather than
  // blindly flipping the status field — this keeps paid_paise/the payments
  // ledger accurate (a bare status flip would silently break reconciliation).
  const handleMarkPaid = async (invoice: any) => {
    const outstanding = (invoice.total_paise ?? Math.round((invoice.total_amount || 0) * 100)) - (invoice.paid_paise || 0);
    if (outstanding <= 0) return;
    try {
      await recordManualPayment({ invoiceId: invoice.id, amountPaise: outstanding, method: "cash" });
    } catch (error: any) {
      console.error("Failed to record payment:", error.message);
    }
  };

  const getStudentName = (id: string) => {
    const student = students.find(s => s.id === id);
    return student ? student.name : "Unknown Student";
  };

  // Canonical money columns are integer paise (total_paise, paid_paise,
  // subtotal_paise, tax_paise, discount_paise); total_amount/subtotal are
  // kept only as a legacy rupee mirror. Prefer paise, fall back to the
  // rupee mirror for older rows.
  const invoiceTotalRupees = (inv: any) => (inv.total_paise != null ? inv.total_paise / 100 : (inv.total_amount || inv.amount || 0));
  const invoiceTaxRupees = (inv: any) => (inv.tax_paise != null ? inv.tax_paise / 100 : (inv.tax || 0));
  const invoiceDiscountRupees = (inv: any) => (inv.discount_paise != null ? inv.discount_paise / 100 : (inv.discount || 0));

  // Tech Debt #2 (DEV_PLAN.md): this used to render its own jsPDF invoice
  // client-side, which could diverge from the server's GST-snapshot invoice
  // (server/utils/invoicePdf.ts) — a parent and an accountant could hold two
  // different PDFs for the same invoice. Now downloads the one canonical
  // artifact via GET /api/v1/billing/invoices/:id/pdf.
  const downloadPDF = async (invoice: any) => {
    try {
      await downloadInvoicePdf(invoice.id);
    } catch (error: any) {
      toast.error("Could not download invoice PDF", { description: error.message });
    }
  };

  const exportToExcel = async () => {
    const exportFields = billingSettings.excelExportFields || ['Invoice ID', 'Student Name', 'Amount', 'Status', 'Issue Date', 'Due Date', 'Services'];
    
    const data = invoices.map(inv => {
      const row: any = {};
      if (exportFields.includes('Invoice ID')) row['Invoice ID'] = `INV-${inv.id.substring(0, 6).toUpperCase()}`;
      if (exportFields.includes('Student Name')) row['Student Name'] = getStudentName(inv.student_id);
      if (exportFields.includes('Amount')) row['Amount (Rs.)'] = invoiceTotalRupees(inv);
      if (exportFields.includes('Status')) row['Status'] = inv.status.toUpperCase();
      if (exportFields.includes('Issue Date')) row['Issue Date'] = new Date(inv.created_at).toLocaleDateString();
      if (exportFields.includes('Due Date')) row['Due Date'] = inv.due_date || "N/A";
      if (exportFields.includes('Services')) row['Services'] = (inv.items || []).map((i: any) => i.description).join(", ");
      if (exportFields.includes('Tax')) row['Tax (Rs.)'] = invoiceTaxRupees(inv);
      if (exportFields.includes('Discount')) row['Discount (Rs.)'] = invoiceDiscountRupees(inv);
      return row;
    });

    // exceljs replaces the vulnerable xlsx package; loaded lazily so it
    // stays out of the main bundle.
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Invoices");
    if (data.length > 0) {
      sheet.columns = Object.keys(data[0]).map((key) => ({ header: key, key, width: 18 }));
      sheet.addRows(data);
      sheet.getRow(1).font = { bold: true };
    }
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
    const url = URL.createObjectURL(blob);
    const a = Object.assign(document.createElement("a"), { href: url, download: "Invoices_Export.xlsx" });
    a.click();
    URL.revokeObjectURL(url);
  };

  // Dashboard Calculations
  const totalRevenue = invoices.filter(i => i.status === 'paid').reduce((sum, i) => sum + invoiceTotalRupees(i), 0);
  const totalOutstanding = invoices.filter(i => i.status !== 'paid').reduce((sum, i) => sum + invoiceTotalRupees(i), 0);
  const totalInvoicesAmount = totalRevenue + totalOutstanding;
  const collectionRate = totalInvoicesAmount > 0 ? Math.round((totalRevenue / totalInvoicesAmount) * 100) : 0;

  const lowCreditStudents = wallets.filter(w => w.balance_credits < 2).length;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Billing & Wallet</h1>
        <div className="flex space-x-3">
          <button 
            onClick={exportToExcel}
            className="flex items-center px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 mr-2 text-green-600" />
            Export to Excel
          </button>
          <button 
            onClick={handleOpenModal}
            className="flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
          >
            <Plus className="w-4 h-4 mr-2" />
            Generate Invoice
          </button>
        </div>
      </div>

      {/* Dashboard Header */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Total Revenue</p>
              <p className="text-2xl font-bold text-gray-900 flex items-center mt-1">
                <IndianRupee className="w-5 h-5 mr-1 text-gray-400" />
                {totalRevenue.toLocaleString('en-IN')}
              </p>
            </div>
            <div className="p-3 bg-green-50 rounded-lg">
              <CheckCircle className="w-6 h-6 text-green-600" />
            </div>
          </div>
        </div>
        
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Outstanding</p>
              <p className="text-2xl font-bold text-gray-900 flex items-center mt-1">
                <IndianRupee className="w-5 h-5 mr-1 text-gray-400" />
                {totalOutstanding.toLocaleString('en-IN')}
              </p>
            </div>
            <div className="p-3 bg-yellow-50 rounded-lg">
              <Receipt className="w-6 h-6 text-yellow-600" />
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Collection Rate</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {collectionRate}%
              </p>
            </div>
            <div className="p-3 bg-blue-50 rounded-lg">
              <div className="w-6 h-6 rounded-full border-4 border-blue-600 border-t-transparent animate-spin-slow"></div>
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-gray-500">Low Credit Alerts</p>
              <p className="text-2xl font-bold text-gray-900 mt-1">
                {lowCreditStudents} Students
              </p>
            </div>
            <div className="p-3 bg-red-50 rounded-lg">
              <AlertCircle className="w-6 h-6 text-red-600" />
            </div>
          </div>
        </div>
      </div>

      {/* Data Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Invoice ID</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Student</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Services</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Due Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr><td colSpan={7} className="px-6 py-12"><LoadingSpinner message="Loading invoices..." /></td></tr>
              ) : invoices.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center">
                    <Receipt className="mx-auto h-12 w-12 text-gray-300" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No invoices found</h3>
                    <p className="mt-1 text-sm text-gray-500">Generate an invoice to get started.</p>
                  </td>
                </tr>
              ) : (
                invoices.map((invoice) => (
                  <tr key={invoice.id} className="hover:bg-gray-50 transition-colors duration-150">
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      INV-{invoice.id.substring(0, 6).toUpperCase()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {getStudentName(invoice.student_id)}
                    </td>
                    <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                      {(invoice.items || []).map((i: any) => i.description).join(", ") || "General Tuition"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">
                      ₹{invoiceTotalRupees(invoice).toFixed(2)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {invoice.due_date || "N/A"}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${
                        invoice.status === 'paid' ? 'bg-green-100 text-green-800' : 
                        invoice.status === 'overdue' ? 'bg-red-100 text-red-800' :
                        'bg-yellow-100 text-yellow-800'
                      }`}>
                        {invoice.status.toUpperCase()}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium flex justify-end space-x-3">
                      <button 
                        onClick={() => downloadPDF(invoice)}
                        className="text-gray-600 hover:text-indigo-600 flex items-center"
                        title="Download PDF"
                      >
                        <Download className="w-4 h-4" />
                      </button>
                      {invoice.status !== 'paid' && (
                        <button 
                          onClick={() => handleMarkPaid(invoice)}
                          className="text-indigo-600 hover:text-indigo-900 flex items-center"
                          title="Mark as Paid"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Generate Invoice Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75" onClick={() => setIsModalOpen(false)}></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-20 inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleSubmit}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Generate Invoice</h3>
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Student</label>
                      <select required value={studentId} onChange={e => setStudentId(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                        <option value="" disabled>Select a student</option>
                        {students.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-2">Line Items</label>
                      <div className="space-y-3">
                        {lineItems.map((item, index) => (
                          <div key={index} className="flex items-start space-x-2">
                            <div className="flex-1">
                              <input
                                type="text"
                                list="services-list"
                                required
                                value={item.description}
                                onChange={(e) => {
                                  handleLineItemChange(index, "description", e.target.value);
                                  const match = masterServices.find(s => s.name === e.target.value) || 
                                                templates.find(t => `${t.type} - ${t.pricing_model}` === e.target.value);
                                  if (match) {
                                    handleServiceSelect(index, e.target.value);
                                  }
                                }}
                                placeholder="Description (Select or type custom)"
                                className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                              />
                            </div>
                            <div className="w-20">
                              <input
                                type="number"
                                required
                                min="1"
                                value={item.quantity}
                                onChange={(e) => handleLineItemChange(index, "quantity", parseInt(e.target.value) || 1)}
                                placeholder="Qty"
                                className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                              />
                            </div>
                            <div className="w-28">
                              <input
                                type="number"
                                required
                                min="0"
                                step="0.01"
                                value={item.amount}
                                onChange={(e) => handleLineItemChange(index, "amount", parseFloat(e.target.value) || 0)}
                                placeholder="Price (₹)"
                                className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                              />
                            </div>
                            {lineItems.length > 1 && (
                              <button
                                type="button"
                                onClick={() => handleRemoveLineItem(index)}
                                className="mt-2 text-red-500 hover:text-red-700"
                              >
                                <Trash2 className="w-4 h-4" />
                              </button>
                            )}
                          </div>
                        ))}
                        <button
                          type="button"
                          onClick={handleAddLineItem}
                          className="text-sm text-indigo-600 hover:text-indigo-800 font-medium flex items-center"
                        >
                          <Plus className="w-4 h-4 mr-1" /> Add Line Item
                        </button>
                      </div>
                      
                      <datalist id="services-list">
                        {masterServices.map((s, i) => (
                          <option key={`ms-${i}`} value={s.name} />
                        ))}
                        {templates.map((t, i) => (
                          <option key={`t-${i}`} value={`${t.type} - ${t.pricing_model}`} />
                        ))}
                      </datalist>
                    </div>
                    
                    <div className="flex justify-end pt-2 border-t border-gray-100 flex-col items-end">
                      <p className="text-sm text-gray-500">Subtotal: ₹{totalAmount.toFixed(2)}</p>
                      {(billingSettings.taxPercentage > 0) && (
                        <p className="text-sm text-gray-500">Tax ({billingSettings.taxPercentage}%): ₹{((totalAmount * billingSettings.taxPercentage) / 100).toFixed(2)}</p>
                      )}
                      <p className="text-lg font-bold text-gray-900 mt-1">
                        Total: ₹{(totalAmount + ((totalAmount * (billingSettings.taxPercentage || 0)) / 100)).toFixed(2)}
                      </p>
                    </div>

                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Issue Date</label>
                        <input type="date" required value={issueDate} onChange={e => setIssueDate(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Due Date</label>
                        <input type="date" required value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button type="submit" className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm">
                    Generate
                  </button>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
