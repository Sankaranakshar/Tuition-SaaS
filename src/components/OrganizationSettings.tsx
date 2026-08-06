import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../supabase";
import { Save, AlertCircle, CheckCircle } from "lucide-react";

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
    messaging: { autoCreateBatchChannels: true, notifyOnNewSession: true, notifyOnNewMessage: true },
    cancellation: { freeHours: 24, lateFeePercent: 50, noShowForfeitPercent: 100 }
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

  const clampPercent = (value: number) => Math.min(100, Math.max(0, value));

  if (!user || (user.role !== 'admin' && user.role !== 'tutor')) {
    return <div className="p-4 text-[var(--cs-text-muted)]">You do not have permission to view organization settings.</div>;
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
            <h2 className="text-lg font-semibold text-[var(--cs-text)]">Organization Settings</h2>
            <p className="text-sm text-[var(--cs-text-muted)]">Configure global rules for your tuition center.</p>
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
          {/* Dashboard Settings */}
          <section>
            <h3 className="text-md font-semibold text-[var(--cs-text)] mb-4 border-b border-[var(--cs-border)] pb-2">1. Dashboard & Alerts</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Low Balance Threshold (Credits)</label>
                <p className="text-xs text-[var(--cs-text-muted)] mb-1">Warn tutors when student credits drop below this number.</p>
                <input
                  type="number"
                  value={settings.dashboard.lowBalanceThreshold}
                  onChange={(e) => updateSetting('dashboard', 'lowBalanceThreshold', parseInt(e.target.value))}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                />
              </div>
            </div>
          </section>

          {/* Students Settings */}
          <section>
            <h3 className="text-md font-semibold text-[var(--cs-text)] mb-4 border-b border-[var(--cs-border)] pb-2">2. Students & Enrollments</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Default Wallet Initialization</label>
                <p className="text-xs text-[var(--cs-text-muted)] mb-1">How new students are billed by default.</p>
                <select
                  value={settings.students.defaultWalletInit}
                  onChange={(e) => updateSetting('students', 'defaultWalletInit', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
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
                  className="h-4 w-4 text-[var(--cs-accent)] focus:ring-[var(--cs-accent)] border-[var(--cs-border)] rounded"
                />
                <label htmlFor="enforceCapacity" className="ml-2 block text-sm text-[var(--cs-text)]">
                  Enforce Capacity Guardrails (Prevent over-enrollment)
                </label>
              </div>
            </div>
          </section>

          {/* Calendar Settings */}
          <section>
            <h3 className="text-md font-semibold text-[var(--cs-text)] mb-4 border-b border-[var(--cs-border)] pb-2">3. Calendar & Scheduling</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="preventConflicts"
                  checked={settings.calendar.preventConflicts}
                  onChange={(e) => updateSetting('calendar', 'preventConflicts', e.target.checked)}
                  className="h-4 w-4 text-[var(--cs-accent)] focus:ring-[var(--cs-accent)] border-[var(--cs-border)] rounded"
                />
                <label htmlFor="preventConflicts" className="ml-2 block text-sm text-[var(--cs-text)]">
                  Global Conflict Detection (Prevent overlapping sessions)
                </label>
              </div>
            </div>
          </section>

          {/* Documents Settings */}
          <section>
            <h3 className="text-md font-semibold text-[var(--cs-text)] mb-4 border-b border-[var(--cs-border)] pb-2">4. Documents & Storage</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Max File Size (MB)</label>
                <input
                  type="number"
                  value={settings.documents.maxFileSizeMB}
                  onChange={(e) => updateSetting('documents', 'maxFileSizeMB', parseInt(e.target.value))}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Allowed Extensions (comma separated)</label>
                <input
                  type="text"
                  value={settings.documents.allowedExtensions.join(', ')}
                  onChange={(e) => updateSetting('documents', 'allowedExtensions', e.target.value.split(',').map(s => s.trim()))}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                />
              </div>
            </div>
          </section>

          {/* Messaging Settings */}
          <section>
            <h3 className="text-md font-semibold text-[var(--cs-text)] mb-4 border-b border-[var(--cs-border)] pb-2">5. Messaging & Notifications</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col space-y-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="autoCreateChannels"
                    checked={settings.messaging.autoCreateBatchChannels}
                    onChange={(e) => updateSetting('messaging', 'autoCreateBatchChannels', e.target.checked)}
                    className="h-4 w-4 text-[var(--cs-accent)] focus:ring-[var(--cs-accent)] border-[var(--cs-border)] rounded"
                  />
                  <label htmlFor="autoCreateChannels" className="ml-2 block text-sm text-[var(--cs-text)]">
                    Auto-create Batch Channels for new Class Templates
                  </label>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="notifyNewSession"
                    checked={settings.messaging.notifyOnNewSession}
                    onChange={(e) => updateSetting('messaging', 'notifyOnNewSession', e.target.checked)}
                    className="h-4 w-4 text-[var(--cs-accent)] focus:ring-[var(--cs-accent)] border-[var(--cs-border)] rounded"
                  />
                  <label htmlFor="notifyNewSession" className="ml-2 block text-sm text-[var(--cs-text)]">
                    Notify students when a new session is scheduled
                  </label>
                </div>
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="notifyNewMessage"
                    checked={settings.messaging.notifyOnNewMessage}
                    onChange={(e) => updateSetting('messaging', 'notifyOnNewMessage', e.target.checked)}
                    className="h-4 w-4 text-[var(--cs-accent)] focus:ring-[var(--cs-accent)] border-[var(--cs-border)] rounded"
                  />
                  <label htmlFor="notifyNewMessage" className="ml-2 block text-sm text-[var(--cs-text)]">
                    Notify users on new messages
                  </label>
                </div>
              </div>
            </div>
          </section>

          {/* Cancellation Policy */}
          <section>
            <h3 className="text-md font-semibold text-[var(--cs-text)] mb-4 border-b border-[var(--cs-border)] pb-2">6. Cancellation Policy</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Free Cancellation Window (Hours)</label>
                <p className="text-xs text-[var(--cs-text-muted)] mb-1">Cancel this many hours before a session with no fee.</p>
                <input
                  type="number"
                  min={0}
                  value={settings.cancellation.freeHours}
                  onChange={(e) => updateSetting('cancellation', 'freeHours', Math.max(0, parseInt(e.target.value) || 0))}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Late Cancellation Fee (%)</label>
                <p className="text-xs text-[var(--cs-text-muted)] mb-1">Fee charged when cancelling inside the free window.</p>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.cancellation.lateFeePercent}
                  onChange={(e) => updateSetting('cancellation', 'lateFeePercent', clampPercent(parseInt(e.target.value) || 0))}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">No-Show Forfeit (%)</label>
                <p className="text-xs text-[var(--cs-text-muted)] mb-1">Portion forfeited when a student doesn't show up.</p>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.cancellation.noShowForfeitPercent}
                  onChange={(e) => updateSetting('cancellation', 'noShowForfeitPercent', clampPercent(parseInt(e.target.value) || 0))}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                />
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
