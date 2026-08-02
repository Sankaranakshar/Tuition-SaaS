import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../supabase";
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
  });

  useEffect(() => {
    if (!user?.organizationId) return;
    
    const fetchSettings = async () => {
      try {
        const { data, error } = await supabase.from("organizations").select("settings").eq("id", user.organizationId!).maybeSingle();
        if (error) throw error;
        if (data?.settings?.billing) {
          setSettings({ ...settings, ...data.settings.billing });
        } else if (data?.settings?.invoices) {
          // Migrate old invoices settings if they exist
          const oldInvoices = data.settings.invoices;
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
      const { data: orgRow, error: readErr } = await supabase.from("organizations").select("settings").eq("id", user.organizationId).maybeSingle();
      if (readErr) throw readErr;
      const currentSettings = orgRow?.settings || {};

      const { error } = await supabase.from("organizations").update({
        settings: { ...currentSettings, billing: settings },
      }).eq("id", user.organizationId);
      if (error) throw error;
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

  if (!user || (user.role !== 'admin' && user.role !== 'tutor')) {
    return <div className="p-4 text-[var(--cs-text-muted)]">You do not have permission to view billing settings.</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-[var(--cs-danger)] px-4 py-3 rounded-[6px] text-sm flex items-center">
          <AlertCircle className="w-5 h-5 mr-2" />
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-[var(--cs-ok)] px-4 py-3 rounded-[6px] text-sm flex items-center">
          <CheckCircle className="w-5 h-5 mr-2" />
          {success}
        </div>
      )}

      <div className="bg-[var(--cs-surface)] rounded-[10px] border border-[var(--cs-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--cs-border)] flex justify-between items-center bg-[var(--cs-bg)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--cs-text)]">Billing & Invoice Settings</h2>
            <p className="text-sm text-[var(--cs-text-muted)]">Configure payment models, invoices, and financial rules.</p>
          </div>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center rounded-[6px] bg-[var(--cs-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            <Save className="w-4 h-4 mr-2" />
            {loading ? "Saving..." : "Save Changes"}
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* 1. Currency & Localization */}
          <section>
            <h3 className="text-md font-semibold text-[var(--cs-text)] mb-4 border-b border-[var(--cs-border)] pb-2">1. Currency & Localization</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Default Currency</label>
                <div className="mt-1 flex rounded-[6px]">
                  <span className="inline-flex items-center px-3 rounded-l-[6px] border border-r-0 border-[var(--cs-border)] bg-[var(--cs-bg)] text-[var(--cs-text-muted)] text-sm">
                    <IndianRupee className="w-4 h-4" />
                  </span>
                  <input
                    type="text"
                    disabled
                    value="Rupees (₹)"
                    className="flex-1 min-w-0 block w-full px-3 py-2 rounded-none rounded-r-[6px] border border-[var(--cs-border)] bg-[var(--cs-bg)] text-[var(--cs-text-muted)] text-sm"
                  />
                </div>
                <p className="mt-1 text-xs text-[var(--cs-text-muted)]">All dashboard summaries and invoices reflect this denomination.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Organization ID</label>
                <input
                  type="text"
                  disabled
                  value={user.organizationId || ""}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-bg)] py-2 px-3 text-sm text-[var(--cs-text-muted)]"
                />
                <p className="mt-1 text-xs text-[var(--cs-text-muted)]">Financial data is isolated to this specific tuition center.</p>
              </div>
            </div>
          </section>

          {/* 2. Service Catalog (Master List) */}
          <section>
            <h3 className="text-md font-semibold text-[var(--cs-text)] mb-4 border-b border-[var(--cs-border)] pb-2">2. Service Catalog (Master List)</h3>
            <p className="text-sm text-[var(--cs-text-muted)] mb-4">Pre-configure your offerings to be used during invoice generation.</p>
            
            <div className="space-y-3">
              {(settings.services || []).map((service: any, index: number) => (
                <div key={index} className="flex flex-wrap md:flex-nowrap items-center gap-3 bg-[var(--cs-bg)] p-3 rounded-[6px] border border-[var(--cs-border)]">
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
                      className="block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
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
                      className="block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
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
                      className="block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
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
                      className="block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
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
                    className="text-[var(--cs-danger)] hover:opacity-80 p-2"
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
                className="flex items-center text-sm text-[var(--cs-accent)] hover:opacity-80 font-medium"
              >
                <Plus className="w-4 h-4 mr-1" /> Add Service
              </button>
            </div>
          </section>

          {/* 3. Financial Logic & Guardrails */}
          <section>
            <h3 className="text-md font-semibold text-[var(--cs-text)] mb-4 border-b border-[var(--cs-border)] pb-2">3. Financial Logic & Guardrails</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Wallet Policy (Per-Session Deductions)</label>
                <select
                  value={settings.walletPolicy}
                  onChange={(e) => updateSetting('walletPolicy', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                >
                  <option value="prioritize_credits">Prioritize Credits (Prepaid Bundles)</option>
                  <option value="prioritize_currency">Prioritize Currency (Pay-as-you-go)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Insufficient Funds Action</label>
                <select
                  value={settings.insufficientFundsAction}
                  onChange={(e) => updateSetting('insufficientFundsAction', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                >
                  <option value="allow_attendance">Allow Attendance (Negative Balance)</option>
                  <option value="generate_invoice">Generate Unpaid Invoice</option>
                  <option value="block_attendance">Block Attendance</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Global Tax Configuration (%)</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  value={settings.taxPercentage}
                  onChange={(e) => updateSetting('taxPercentage', parseFloat(e.target.value) || 0)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                />
                <p className="mt-1 text-xs text-[var(--cs-text-muted)]">Automatically calculated in JSON invoice objects.</p>
              </div>
            </div>
          </section>

          {/* 4. Invoicing Dashboard Settings */}
          <section>
            <h3 className="text-md font-semibold text-[var(--cs-text)] mb-4 border-b border-[var(--cs-border)] pb-2">4. Invoicing Dashboard Settings</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Automatic Due Dates (Days)</label>
                <input
                  type="number"
                  min="0"
                  value={settings.defaultDueDays}
                  onChange={(e) => updateSetting('defaultDueDays', parseInt(e.target.value) || 0)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                />
                <p className="mt-1 text-xs text-[var(--cs-text-muted)]">Default days after generation for the dueDate field.</p>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Status Mapping Trigger</label>
                <select
                  value={settings.statusMapping}
                  onChange={(e) => updateSetting('statusMapping', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
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
                  className="h-4 w-4 text-[var(--cs-accent)] focus:ring-[var(--cs-accent)] border-[var(--cs-border)] rounded"
                />
                <label htmlFor="rolloverArrears" className="ml-2 block text-sm text-[var(--cs-text)]">
                  Rollover Arrears (Add unpaid invoices to next month's billing cycle)
                </label>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
