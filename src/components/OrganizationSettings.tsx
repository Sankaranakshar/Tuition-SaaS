import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../supabase";
import { Save, AlertCircle, CheckCircle, Clock } from "lucide-react";
import { Button } from "./kit";
import { updateOrganizationTimezone } from "../lib/api";

// A curated, India-first list rather than the full ~400-zone IANA database
// (Intl.supportedValuesOf("timeZone") when available) — the entire current
// customer base is India (MASTER_PLAN.md §2), and a long unfiltered list
// makes the common case harder to find. "Other" reveals a free-text IANA
// name for the rare non-India org; the server validates it via Intl either way.
const COMMON_TIMEZONES = [
  { value: "Asia/Kolkata", label: "India (Asia/Kolkata, UTC+5:30)" },
  { value: "Asia/Dubai", label: "Gulf (Asia/Dubai, UTC+4:00)" },
  { value: "Asia/Singapore", label: "Singapore (Asia/Singapore, UTC+8:00)" },
  { value: "Europe/London", label: "UK (Europe/London)" },
  { value: "America/New_York", label: "US Eastern (America/New_York)" },
  { value: "UTC", label: "UTC" },
];

// Matches kit Input's skin for the native <input>/<select> elements this
// settings form doesn't route through the kit wrapper for (same recipe as
// People.tsx/Schedule.tsx's SELECT_CLASS).
const FIELD_CLASS =
  "mt-1 block w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface)] py-1.5 px-3 text-[13px] text-[var(--cs-text)] outline-none transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] focus:border-[var(--cs-focus)] focus:ring-2 focus:ring-[var(--cs-focus)]/30 disabled:opacity-50";
const CHECKBOX_CLASS = "h-4 w-4 rounded border-[var(--cs-border-strong)] text-[var(--cs-accent)] focus:ring-[var(--cs-focus)]";

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
    cancellation: { freeHours: 24, lateFeePercent: 50, noShowForfeitPercent: 100 },
    creditExpiry: { enabled: false, windowDays: 0 },
    erasure: { walletPolicy: 'block' },
    payouts: { tdsPercent: 0 }
  });

  // C-01 (EXECUTION_PLAN.md Step 25): a real `organizations.timezone`
  // column, not part of the `settings` jsonb blob above, so it's fetched
  // and saved separately — saving it also rematerializes future sessions
  // server-side (see handleTimezoneSave), which the generic "Save changes"
  // button for the rest of this page deliberately doesn't do for anything else.
  const [timezone, setTimezone] = useState("Asia/Kolkata");
  const [timezoneInput, setTimezoneInput] = useState("Asia/Kolkata");
  const [timezoneCustom, setTimezoneCustom] = useState(false);
  const [timezoneSaving, setTimezoneSaving] = useState(false);
  const [timezoneError, setTimezoneError] = useState("");
  const [timezoneSuccess, setTimezoneSuccess] = useState("");

  useEffect(() => {
    if (!user?.organizationId) return;

    const fetchSettings = async () => {
      try {
        const { data, error } = await supabase.from("organizations").select("settings, timezone").eq("id", user.organizationId!).maybeSingle();
        if (error) throw error;
        if (data?.settings) {
          setSettings({ ...settings, ...data.settings });
        }
        if (data?.timezone) {
          setTimezone(data.timezone);
          setTimezoneInput(data.timezone);
          setTimezoneCustom(!COMMON_TIMEZONES.some((tz) => tz.value === data.timezone));
        }
      } catch (err) {
        console.error("Error fetching organization settings:", err);
      }
    };
    fetchSettings();
  }, [user?.organizationId]);

  const handleTimezoneSave = async () => {
    setTimezoneSaving(true);
    setTimezoneError("");
    setTimezoneSuccess("");
    try {
      const result = await updateOrganizationTimezone({ timezone: timezoneInput });
      setTimezone(result.timezone);
      setTimezoneSuccess(
        `Timezone changed to ${result.timezone}. ${result.created.length} future session${result.created.length === 1 ? "" : "s"} rematerialized` +
          (result.conflicts.length > 0 ? `, ${result.conflicts.length} could not be (already booked at the new time — check Schedule).` : ".")
      );
    } catch (err: any) {
      setTimezoneError(err.message || "Failed to change timezone.");
    } finally {
      setTimezoneSaving(false);
    }
  };

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
        <div className="flex items-center rounded-[var(--cs-radius-control)] bg-[var(--cs-danger-soft)] px-4 py-3 text-sm text-[var(--cs-danger)]">
          <AlertCircle className="mr-2 h-5 w-5" strokeWidth={1.75} />
          {error}
        </div>
      )}

      {success && (
        <div className="flex items-center rounded-[var(--cs-radius-control)] bg-[var(--cs-accent-soft)] px-4 py-3 text-sm text-[var(--cs-accent)]">
          <CheckCircle className="mr-2 h-5 w-5" strokeWidth={1.75} />
          {success}
        </div>
      )}

      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <div className="flex items-center justify-between border-b border-[var(--cs-border)] px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-[var(--cs-text)]">Organization settings</h2>
            <p className="text-xs text-[var(--cs-text-muted)]">Configure global rules for your tuition center.</p>
          </div>
          <Button onClick={handleSave} disabled={loading} icon={Save}>
            {loading ? "Saving…" : "Save changes"}
          </Button>
        </div>

        <div className="p-6 space-y-8">
          {/* Dashboard Settings */}
          <section>
            <h3 className="mb-4 border-b border-[var(--cs-border)] pb-2 text-sm font-semibold text-[var(--cs-text)]">1. Dashboard & Alerts</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Low Balance Threshold (Credits)</label>
                <p className="text-xs text-[var(--cs-text-muted)] mb-1">Warn tutors when student credits drop below this number.</p>
                <input
                  type="number"
                  value={settings.dashboard.lowBalanceThreshold}
                  onChange={(e) => updateSetting('dashboard', 'lowBalanceThreshold', parseInt(e.target.value))}
                  className={FIELD_CLASS}
                />
              </div>
            </div>
          </section>

          {/* Students Settings */}
          <section>
            <h3 className="mb-4 border-b border-[var(--cs-border)] pb-2 text-sm font-semibold text-[var(--cs-text)]">2. Students & Enrollments</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Default Wallet Initialization</label>
                <p className="text-xs text-[var(--cs-text-muted)] mb-1">How new students are billed by default.</p>
                <select
                  value={settings.students.defaultWalletInit}
                  onChange={(e) => updateSetting('students', 'defaultWalletInit', e.target.value)}
                  className={FIELD_CLASS}
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
                  className={CHECKBOX_CLASS}
                />
                <label htmlFor="enforceCapacity" className="ml-2 block text-sm text-[var(--cs-text)]">
                  Enforce Capacity Guardrails (Prevent over-enrollment)
                </label>
              </div>
            </div>
          </section>

          {/* Calendar Settings */}
          <section>
            <h3 className="mb-4 border-b border-[var(--cs-border)] pb-2 text-sm font-semibold text-[var(--cs-text)]">3. Calendar & Scheduling</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="preventConflicts"
                  checked={settings.calendar.preventConflicts}
                  onChange={(e) => updateSetting('calendar', 'preventConflicts', e.target.checked)}
                  className={CHECKBOX_CLASS}
                />
                <label htmlFor="preventConflicts" className="ml-2 block text-sm text-[var(--cs-text)]">
                  Global Conflict Detection (Prevent overlapping sessions)
                </label>
              </div>
            </div>
          </section>

          {/* Documents Settings */}
          <section>
            <h3 className="mb-4 border-b border-[var(--cs-border)] pb-2 text-sm font-semibold text-[var(--cs-text)]">4. Documents & Storage</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Max File Size (MB)</label>
                <input
                  type="number"
                  value={settings.documents.maxFileSizeMB}
                  onChange={(e) => updateSetting('documents', 'maxFileSizeMB', parseInt(e.target.value))}
                  className={FIELD_CLASS}
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Allowed Extensions (comma separated)</label>
                <input
                  type="text"
                  value={settings.documents.allowedExtensions.join(', ')}
                  onChange={(e) => updateSetting('documents', 'allowedExtensions', e.target.value.split(',').map(s => s.trim()))}
                  className={FIELD_CLASS}
                />
              </div>
            </div>
          </section>

          {/* Messaging Settings */}
          <section>
            <h3 className="mb-4 border-b border-[var(--cs-border)] pb-2 text-sm font-semibold text-[var(--cs-text)]">5. Messaging & Notifications</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex flex-col space-y-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="autoCreateChannels"
                    checked={settings.messaging.autoCreateBatchChannels}
                    onChange={(e) => updateSetting('messaging', 'autoCreateBatchChannels', e.target.checked)}
                    className={CHECKBOX_CLASS}
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
                    className={CHECKBOX_CLASS}
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
                    className={CHECKBOX_CLASS}
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
            <h3 className="mb-4 border-b border-[var(--cs-border)] pb-2 text-sm font-semibold text-[var(--cs-text)]">6. Cancellation Policy</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Free Cancellation Window (Hours)</label>
                <p className="text-xs text-[var(--cs-text-muted)] mb-1">Cancel this many hours before a session with no fee.</p>
                <input
                  type="number"
                  min={0}
                  value={settings.cancellation.freeHours}
                  onChange={(e) => updateSetting('cancellation', 'freeHours', Math.max(0, parseInt(e.target.value) || 0))}
                  className={FIELD_CLASS}
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
                  className={FIELD_CLASS}
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
                  className={FIELD_CLASS}
                />
              </div>
            </div>
          </section>

          {/* Credit Expiry */}
          <section>
            <h3 className="mb-4 border-b border-[var(--cs-border)] pb-2 text-sm font-semibold text-[var(--cs-text)]">7. Credit Expiry</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="flex items-center">
                <input
                  type="checkbox"
                  id="creditExpiryEnabled"
                  checked={settings.creditExpiry.enabled}
                  onChange={(e) => updateSetting('creditExpiry', 'enabled', e.target.checked)}
                  className={CHECKBOX_CLASS}
                />
                <label htmlFor="creditExpiryEnabled" className="ml-2 block text-sm text-[var(--cs-text)]">
                  Expire unused prepaid credit after a fixed window
                </label>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Expiry Window (Days)</label>
                <p className="text-xs text-[var(--cs-text-muted)] mb-1">
                  {settings.creditExpiry.enabled
                    ? 'Counted from each top-up date. Unused credit older than this is written off, with 30-day and 7-day warnings first.'
                    : 'Off — prepaid credit never expires for this center.'}
                </p>
                <input
                  type="number"
                  min={0}
                  disabled={!settings.creditExpiry.enabled}
                  value={settings.creditExpiry.windowDays}
                  onChange={(e) => updateSetting('creditExpiry', 'windowDays', Math.max(0, parseInt(e.target.value) || 0))}
                  className={FIELD_CLASS}
                />
              </div>
            </div>
          </section>

          {/* Data Erasure (DPDP) */}
          <section>
            <h3 className="mb-4 border-b border-[var(--cs-border)] pb-2 text-sm font-semibold text-[var(--cs-text)]">8. Data Erasure (DPDP)</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Leftover wallet balance on erasure</label>
                <p className="text-xs text-[var(--cs-text-muted)] mb-1">
                  When an owner or admin erases a student who still has unused prepaid credit.
                </p>
                <select
                  value={settings.erasure.walletPolicy}
                  onChange={(e) => updateSetting('erasure', 'walletPolicy', e.target.value)}
                  className={FIELD_CLASS}
                >
                  <option value="block">Block erasure until the balance is refunded or adjusted to zero</option>
                  <option value="writeoff">Write the remaining balance off automatically</option>
                </select>
                <p className="text-xs text-[var(--cs-text-muted)] mt-2">
                  Erasure permanently removes a student's personal and academic data. Invoices, payments and wallet
                  history are kept as anonymised records for the 8-year retention period and are never deleted.
                </p>
              </div>
            </div>
          </section>

          {/* Tutor Payouts */}
          <section>
            <h3 className="mb-4 border-b border-[var(--cs-border)] pb-2 text-sm font-semibold text-[var(--cs-text)]">9. Tutor Payouts</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">TDS Deduction (%)</label>
                <p className="text-xs text-[var(--cs-text-muted)] mb-1">
                  Withheld from a tutor's gross earnings when running a payout. 0% until you set this — payouts are never taxed by a number this center hasn't configured.
                </p>
                <input
                  type="number"
                  min={0}
                  max={100}
                  value={settings.payouts.tdsPercent}
                  onChange={(e) => updateSetting('payouts', 'tdsPercent', clampPercent(parseInt(e.target.value) || 0))}
                  className={FIELD_CLASS}
                />
              </div>
            </div>
          </section>

          {/* Timezone (C-01) */}
          <section>
            <h3 className="mb-4 border-b border-[var(--cs-border)] pb-2 text-sm font-semibold text-[var(--cs-text)]">10. Timezone</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Center's timezone</label>
                <p className="text-xs text-[var(--cs-text-muted)] mb-1">
                  The wall-clock time your recurring classes are scheduled at. Changing this rematerializes every
                  future recurring session at the new zone — sessions already marked or completed are untouched.
                </p>
                {timezoneCustom ? (
                  <input
                    type="text"
                    value={timezoneInput}
                    onChange={(e) => setTimezoneInput(e.target.value)}
                    placeholder="e.g. Asia/Kolkata"
                    className={FIELD_CLASS}
                  />
                ) : (
                  <select value={timezoneInput} onChange={(e) => setTimezoneInput(e.target.value)} className={FIELD_CLASS}>
                    {COMMON_TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                )}
                <button
                  type="button"
                  onClick={() => {
                    setTimezoneCustom((prev) => !prev);
                    setTimezoneInput(timezoneCustom ? "Asia/Kolkata" : timezoneInput);
                  }}
                  className="mt-1 text-xs text-[var(--cs-accent)] hover:underline"
                >
                  {timezoneCustom ? "Choose from common list instead" : "Use a different IANA timezone…"}
                </button>
              </div>
              <div className="flex flex-col justify-end">
                <Button
                  onClick={handleTimezoneSave}
                  disabled={timezoneSaving || timezoneInput === timezone}
                  icon={Clock}
                >
                  {timezoneSaving ? "Changing…" : "Change timezone"}
                </Button>
                {timezoneError && <p className="mt-2 text-xs text-[var(--cs-danger)]">{timezoneError}</p>}
                {timezoneSuccess && <p className="mt-2 text-xs text-[var(--cs-accent)]">{timezoneSuccess}</p>}
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
