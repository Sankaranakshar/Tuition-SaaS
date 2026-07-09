import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../supabase";
import { Save, AlertCircle, CheckCircle, Plus, Trash2 } from "lucide-react";

export default function OrganizationSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  const [settings, setSettings] = useState<any>({
    dashboard: { lowBalanceThreshold: 0 },
    students: { defaultWalletInit: 'currency', enforceCapacityGuardrails: true },
    calendar: { preventConflicts: true },
    documents: { maxFileSizeMB: 10, allowedExtensions: ['pdf', 'doc', 'docx'] },
    messaging: { autoCreateBatchChannels: true, notifyOnNewSession: true, notifyOnNewMessage: true }
  });

  useEffect(() => {
    if (!user?.organizationId) return;
    
    const fetchSettings = async () => {
      try {
        const { data, error } = await supabase.from("organizations").select("settings").eq("id", user.organizationId!).maybeSingle();
        if (error) throw error;
        if (data?.settings) {
          setSettings({ ...settings, ...data.settings });
        }
      } catch (err) {
        console.error("Error fetching organization settings:", err);
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
      const { error } = await supabase.from("organizations").update({ settings }).eq("id", user.organizationId);
      if (error) throw error;
      setSuccess("Organization settings saved successfully.");
    } catch (err: any) {
      setError(err.message || "Failed to save settings.");
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = (category: string, field: string, value: any) => {
    setSettings((prev: any) => ({
      ...prev,
      [category]: {
        ...prev[category],
        [field]: value
      }
    }));
  };

  if (!user || (user.role !== 'admin' && user.role !== 'tutor')) {
    return <div className="p-4 text-gray-500">You do not have permission to view organization settings.</div>;
  }

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
            <h2 className="text-lg font-semibold text-gray-900">Organization Settings</h2>
            <p className="text-sm text-gray-500">Configure global rules for your tuition center.</p>
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
          {/* Dashboard Settings */}
          <section>
            <h3 className="text-md font-semibold text-gray-800 mb-4 border-b pb-2">1. Dashboard & Alerts</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Low Balance Threshold (Credits)</label>
                <p className="text-xs text-gray-500 mb-1">Warn tutors when student credits drop below this number.</p>
                <input
                  type="number"
                  value={settings.dashboard.lowBalanceThreshold}
                  onChange={(e) => updateSetting('dashboard', 'lowBalanceThreshold', parseInt(e.target.value))}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
            </div>
          </section>

          {/* Students Settings */}
          <section>
            <h3 className="text-md font-semibold text-gray-800 mb-4 border-b pb-2">2. Students & Enrollments</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Default Wallet Initialization</label>
                <p className="text-xs text-gray-500 mb-1">How new students are billed by default.</p>
                <select
                  value={settings.students.defaultWalletInit}
                  onChange={(e) => updateSetting('students', 'defaultWalletInit', e.target.value)}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                >
                  <option value="currency">Prepaid Currency (e.g., $100)</option>
                  <option value="credits">Session Credits (e.g., 10 classes)</option>
                </select>
              </div>
              <div className="flex items-center mt-6">
                <input
                  type="checkbox"
                  id="enforceCapacity"
                  checked={settings.students.enforceCapacityGuardrails}
                  onChange={(e) => updateSetting('students', 'enforceCapacityGuardrails', e.target.checked)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor="enforceCapacity" className="ml-2 block text-sm text-gray-900">
                  Enforce Capacity Guardrails (Prevent over-enrollment)
                </label>
              </div>
            </div>
          </section>

          {/* Calendar Settings */}
          <section>
            <h3 className="text-md font-semibold text-gray-800 mb-4 border-b pb-2">3. Calendar & Scheduling</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="preventConflicts"
                  checked={settings.calendar.preventConflicts}
                  onChange={(e) => updateSetting('calendar', 'preventConflicts', e.target.checked)}
                  className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                />
                <label htmlFor="preventConflicts" className="ml-2 block text-sm text-gray-900">
                  Global Conflict Detection (Prevent overlapping sessions)
                </label>
              </div>
            </div>
          </section>

          {/* Documents Settings */}
          <section>
            <h3 className="text-md font-semibold text-gray-800 mb-4 border-b pb-2">4. Documents & Storage</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-gray-700">Max File Size (MB)</label>
                <input
                  type="number"
                  value={settings.documents.maxFileSizeMB}
                  onChange={(e) => updateSetting('documents', 'maxFileSizeMB', parseInt(e.target.value))}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Allowed Extensions (comma separated)</label>
                <input
                  type="text"
                  value={settings.documents.allowedExtensions.join(', ')}
                  onChange={(e) => updateSetting('documents', 'allowedExtensions', e.target.value.split(',').map(s => s.trim()))}
                  className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
                />
              </div>
            </div>
          </section>

          {/* Messaging Settings */}
          <section>
            <h3 className="text-md font-semibold text-gray-800 mb-4 border-b pb-2">5. Messaging & Notifications</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col space-y-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="autoCreateChannels"
                    checked={settings.messaging.autoCreateBatchChannels}
                    onChange={(e) => updateSetting('messaging', 'autoCreateBatchChannels', e.target.checked)}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                  />
                  <label htmlFor="autoCreateChannels" className="ml-2 block text-sm text-gray-900">
                    Auto-create Batch Channels for new Class Templates
                  </label>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="notifyNewSession"
                    checked={settings.messaging.notifyOnNewSession}
                    onChange={(e) => updateSetting('messaging', 'notifyOnNewSession', e.target.checked)}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                  />
                  <label htmlFor="notifyNewSession" className="ml-2 block text-sm text-gray-900">
                    Notify students when a new session is scheduled
                  </label>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="notifyNewMessage"
                    checked={settings.messaging.notifyOnNewMessage}
                    onChange={(e) => updateSetting('messaging', 'notifyOnNewMessage', e.target.checked)}
                    className="h-4 w-4 text-indigo-600 focus:ring-indigo-500 border-gray-300 rounded"
                  />
                  <label htmlFor="notifyNewMessage" className="ml-2 block text-sm text-gray-900">
                    Notify users on new messages
                  </label>
                </div>
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
