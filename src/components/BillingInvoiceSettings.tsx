import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { doc, getDoc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import { Save, AlertCircle, CheckCircle, Plus, Trash2, IndianRupee } from "lucide-react";

export default function BillingInvoiceSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  const [settings, setSettings] = useState<any>({
    currency: 'INR',
    services: [],
    walletPolicy: 'prioritize_credits',
    insufficientFundsAction: 'generate_invoice',
    taxPercentage: 0,
    defaultDueDays: 7,
    rolloverArrears: false,
    statusMapping: 'manual',
    invoiceSchema: ['tutorId', 'courseId', 'studentId'],
    pdfTemplate: { logoUrl: '', address: '', footerText: '' },
    excelExportFields: ['Invoice ID', 'Student Name', 'Amount', 'Status', 'Issue Date', 'Due Date', 'Services']
  });

  useEffect(() => {
    if (!user?.organizationId) return;
    
    const fetchSettings = async () => {
      try {
        const orgDoc = await getDoc(doc(db, "organizations", user.organizationId!));
        if (orgDoc.exists() && orgDoc.data().settings?.billing) {
          setSettings({ ...settings, ...orgDoc.data().settings.billing });
        } else if (orgDoc.exists() && orgDoc.data().settings?.invoices) {
          // Migrate old invoices settings if they exist
          const oldInvoices = orgDoc.data().settings.invoices;
          setSettings({
            ...settings,
            services: oldInvoices.services || [],
            taxPercentage: oldInvoices.taxPercentage || 0,
          });
        }
      } catch (err) {
        console.error("Error fetching billing settings:", err);
      }
    };
    fetchSettings();
  }, [user?.organizationId]);

  const handleSave = async () => {
    if (!user?.organizationId) return;
    setLoading(true);
    setError("");
    setSuccess("");
    try {
      const orgRef = doc(db, "organizations", user.organizationId);
      const orgDoc = await getDoc(orgRef);
      const currentSettings = orgDoc.exists() ? orgDoc.data().settings || {} : {};
      
      await updateDoc(orgRef, {
        settings: {
          ...currentSettings,
          billing: settings
        }
      });
      setSuccess("Billing & Invoice settings saved successfully.");
    } catch (err: any) {
      setError(err.message || "Failed to save settings.");
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = (field: string, value: any) => {
    setSettings((prev: any) => ({
      ...prev,
      [field]: value
    }));
  };

  const updatePdfTemplate = (field: string, value: string) => {
    setSettings((prev: any) => ({
      ...prev,
      pdfTemplate: {
        ...prev.pdfTemplate,
        [field]: value
      }
    }));
  };

  const handleExcelFieldToggle = (field: string) => {
    const currentFields = settings.excelExportFields || [];
    if (currentFields.includes(field)) {
      updateSetting('excelExportFields', currentFields.filter((f: string) => f !== field));
    } else {
      updateSetting('excelExportFields', [...currentFields, field]);
    }
  };

  if (!user || (user.role !== 'admin' && user.role !== 'tutor')) {
    return <div className="p-4 text-gray-500">You do not have permission to view billing settings.</div>;
  }

  const availableExcelFields = ['Invoice ID', 'Student Name', 'Amount', 'Status', 'Issue Date', 'Due Date', 'Services', 'Tax', 'Discount'];

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm flex items-center">
          <AlertCircle className="w-5 h-5 mr-2" />
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-green-600 px-4 py-3 rounded-md text-sm flex items-center">
          <CheckCircle className="w-5 h-5 mr-2" />
          {success}
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center bg-gray-50">
          <div>
            <h2 className="text-lg font-semibold text-gray-900">Billing & Invoice Settings</h2>
            <p className="text-sm text-gray-500">Configure payment models, invoices, and financial rules.</p>
          </div>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 disabled:opacity-50"
          >
            <Save className="w-4 h-4 mr-2" />
            {loading ? "Saving..." : "Save Changes"}
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* 1. Currency & Localization */}
          <section>
            <h3 className="text-md font-semibold text-gray-800 mb-4 border-b pb-2">1. Currency & Localization</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Default Currency</label>
                <div className="mt-1 flex rounded-md shadow-sm">
                  <span className="inline-flex items-center px-3 rounded-l-md border border-r-0 border-gray-300 bg-gray-50 text-gray-500 sm:text-sm">
                    <IndianRupee className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    disabled
                    value="Rupees (₹)"
                    className="flex-1 min-w-0 block w-full px-3 py-2 rounded-none rounded-r-md border border-gray-300 bg-gray-50 text-gray-500 sm:text-sm"
                  />
                </div>
                <p className="mt-1 text-xs text-gray-500">All dashboard summaries and invoices reflect this denomination.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Organization ID</label>
                <input
                  type="text"
                  disabled
                  value={user.organizationId || ""}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 bg-gray-50 text-gray-500 sm:text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">Financial data is isolated to this specific tuition center.</p>
              </div>
            </div>
          </section>

          {/* 2. Service Catalog (Master List) */}
          <section>
            <h3 className="text-md font-semibold text-gray-800 mb-4 border-b pb-2">2. Service Catalog (Master List)</h3>
            <p className="text-sm text-gray-500 mb-4">Pre-configure your offerings to be used during invoice generation.</p>
            
            <div className="space-y-3">
              {(settings.services || []).map((service: any, index: number) => (
                <div key={index} className="flex flex-wrap md:flex-nowrap items-center gap-3 bg-gray-50 p-3 rounded-md border border-gray-200">
                  <div className="flex-1 min-w-[200px]">
                    <input
                      type="text"
                      value={service.name}
                      onChange={(e) => {
                        const newServices = [...(settings.services || [])];
                        newServices[index].name = e.target.value;
                        updateSetting('services', newServices);
                      }}
                      placeholder="Service Name (e.g., Premium 1:1 Math)"
                      className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>
                  <div className="w-full md:w-40">
                    <input
                      type="text"
                      value={service.category || ''}
                      onChange={(e) => {
                        const newServices = [...(settings.services || [])];
                        newServices[index].category = e.target.value;
                        updateSetting('services', newServices);
                      }}
                      placeholder="Category"
                      className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>
                  <div className="w-full md:w-32">
                    <input
                      type="number"
                      value={service.defaultPrice}
                      onChange={(e) => {
                        const newServices = [...(settings.services || [])];
                        newServices[index].defaultPrice = parseFloat(e.target.value);
                        updateSetting('services', newServices);
                      }}
                      placeholder="Price (₹)"
                      className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    />
                  </div>
                  <div className="w-full md:w-40">
                    <select
                      value={service.pricingModel || 'per_session'}
                      onChange={(e) => {
                        const newServices = [...(settings.services || [])];
                        newServices[index].pricingModel = e.target.value;
                        updateSetting('services', newServices);
                      }}
                      className="block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                    >
                      <option value="monthly">Monthly</option>
                      <option value="per_session">Per-Session</option>
                      <option value="package">Package</option>
                      <option value="flat_fee">Flat Fee</option>
                    </select>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      const newServices = [...(settings.services || [])];
                      newServices.splice(index, 1);
                      updateSetting('services', newServices);
                    }}
                    className="text-red-500 hover:text-red-700 p-2"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              
              <button
                type="button"
                onClick={() => {
                  const newServices = [...(settings.services || [])];
                  newServices.push({ id: Date.now().toString(), name: '', category: '', defaultPrice: 0, pricingModel: 'per_session' });
                  updateSetting('services', newServices);
                }}
                className="flex items-center text-sm text-indigo-600 hover:text-indigo-800 font-medium"
              >
                <Plus className="w-4 h-4 mr-1" /> Add Service
              </button>
            </div>
          </section>

          {/* 3. Financial Logic & Guardrails */}
          <section>
            <h3 className="text-md font-semibold text-gray-800 mb-4 border-b pb-2">3. Financial Logic & Guardrails</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Wallet Policy (Per-Session Deductions)</label>
                <select
                  value={settings.walletPolicy}
                  onChange={(e) => updateSetting('walletPolicy', e.target.value)}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                  <option value="prioritize_credits">Prioritize Credits (Prepaid Bundles)</option>
                  <option value="prioritize_currency">Prioritize Currency (Pay-as-you-go)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Insufficient Funds Action</label>
                <select
                  value={settings.insufficientFundsAction}
                  onChange={(e) => updateSetting('insufficientFundsAction', e.target.value)}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                  <option value="allow_attendance">Allow Attendance (Negative Balance)</option>
                  <option value="generate_invoice">Generate Unpaid Invoice</option>
                  <option value="block_attendance">Block Attendance</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Global Tax Configuration (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={settings.taxPercentage}
                  onChange={(e) => updateSetting('taxPercentage', parseFloat(e.target.value) || 0)}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">Automatically calculated in JSON invoice objects.</p>
              </div>
            </div>
          </section>

          {/* 4. Invoicing Dashboard Settings */}
          <section>
            <h3 className="text-md font-semibold text-gray-800 mb-4 border-b pb-2">4. Invoicing Dashboard Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Automatic Due Dates (Days)</label>
                <input
                  type="number"
                  min="0"
                  value={settings.defaultDueDays}
                  onChange={(e) => updateSetting('defaultDueDays', parseInt(e.target.value) || 0)}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
                <p className="mt-1 text-xs text-gray-500">Default days after generation for the dueDate field.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Status Mapping Trigger</label>
                <select
                  value={settings.statusMapping}
                  onChange={(e) => updateSetting('statusMapping', e.target.value)}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                  <option value="manual">Manual (Mark Paid button)</option>
                  <option value="auto_on_payment">Auto on Payment Gateway Success</option>
                </select>
              </div>
              <div className="flex items-center mt-6">
                <input
                  type="checkbox"
                  id="rolloverArrears"
                  checked={settings.rolloverArrears}
                  onChange={(e) => updateSetting('rolloverArrears', e.target.checked)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor="rolloverArrears" className="ml-2 block text-sm text-gray-900">
                  Rollover Arrears (Add unpaid invoices to next month's billing cycle)
                </label>
              </div>
            </div>
          </section>

          {/* 5. Document & Export Settings */}
          <section>
            <h3 className="text-md font-semibold text-gray-800 mb-4 border-b pb-2">5. Document & Export Settings</h3>
            
            <div className="space-y-6">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">PDF Template Customization</label>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-gray-50 p-4 rounded-md border border-gray-200">
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Logo URL</label>
                    <input
                      type="text"
                      value={settings.pdfTemplate?.logoUrl || ''}
                      onChange={(e) => updatePdfTemplate('logoUrl', e.target.value)}
                      placeholder="https://example.com/logo.png"
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 sm:text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-700">Footer Text</label>
                    <input
                      type="text"
                      value={settings.pdfTemplate?.footerText || ''}
                      onChange={(e) => updatePdfTemplate('footerText', e.target.value)}
                      placeholder="Thank you for your business!"
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 sm:text-sm"
                    />
                  </div>
                  <div className="md:col-span-2">
                    <label className="block text-xs font-medium text-gray-700">Tuition Center Address</label>
                    <textarea
                      value={settings.pdfTemplate?.address || ''}
                      onChange={(e) => updatePdfTemplate('address', e.target.value)}
                      rows={2}
                      className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 sm:text-sm"
                      placeholder="123 Education St, Knowledge City"
                    />
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Excel Export Fields</label>
                <div className="flex flex-wrap gap-2">
                  {availableExcelFields.map(field => (
                    <label key={field} className="inline-flex items-center bg-gray-50 px-3 py-2 rounded-md border border-gray-200 cursor-pointer hover:bg-gray-100">
                      <input
                        type="checkbox"
                        checked={(settings.excelExportFields || []).includes(field)}
                        onChange={() => handleExcelFieldToggle(field)}
                        className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                      />
                      <span className="ml-2 text-sm text-gray-700">{field}</span>
                    </label>
                  ))}
                </div>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
