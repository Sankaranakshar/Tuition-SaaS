import { useState } from "react";
import { Bell, Mail, Smartphone, Save } from "lucide-react";

export default function Preferences() {
  const [preferences, setPreferences] = useState({
    emailNotifications: true,
    smsNotifications: false,
    pushAlerts: true,
    classReminders: true,
    assignmentUpdates: true,
    marketingEmails: false,
  });

  const handleToggle = (key: keyof typeof preferences) => {
    setPreferences(prev => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-[var(--cs-text)]">Preferences</h1>
        <button className="flex items-center rounded-[6px] bg-[var(--cs-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity">
          <Save className="w-4 h-4 mr-2" />
          Save Preferences
        </button>
      </div>

      <div className="bg-[var(--cs-surface)] rounded-[10px] border border-[var(--cs-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--cs-border)] flex justify-between items-center">
          <h2 className="text-lg font-semibold text-[var(--cs-text)] flex items-center">
            <Bell className="w-5 h-5 mr-2 text-[var(--cs-accent)]" />
            Notification Settings
          </h2>
        </div>

        <div className="p-6 space-y-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Mail className="w-5 h-5 text-[var(--cs-text-muted)] mr-3" />
              <div>
                <p className="text-sm font-medium text-[var(--cs-text)]">Email Notifications</p>
                <p className="text-xs text-[var(--cs-text-muted)]">Receive updates and reminders via email.</p>
              </div>
            </div>
            <button
              onClick={() => handleToggle('emailNotifications')}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)] focus:ring-offset-2 ${preferences.emailNotifications ? 'bg-[var(--cs-accent)]' : 'bg-[var(--cs-border)]'}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${preferences.emailNotifications ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Smartphone className="w-5 h-5 text-[var(--cs-text-muted)] mr-3" />
              <div>
                <p className="text-sm font-medium text-[var(--cs-text)]">SMS Notifications</p>
                <p className="text-xs text-[var(--cs-text-muted)]">Receive urgent alerts via text message.</p>
              </div>
            </div>
            <button
              onClick={() => handleToggle('smsNotifications')}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)] focus:ring-offset-2 ${preferences.smsNotifications ? 'bg-[var(--cs-accent)]' : 'bg-[var(--cs-border)]'}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${preferences.smsNotifications ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center">
              <Bell className="w-5 h-5 text-[var(--cs-text-muted)] mr-3" />
              <div>
                <p className="text-sm font-medium text-[var(--cs-text)]">Push Alerts</p>
                <p className="text-xs text-[var(--cs-text-muted)]">Receive real-time notifications in the browser.</p>
              </div>
            </div>
            <button
              onClick={() => handleToggle('pushAlerts')}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)] focus:ring-offset-2 ${preferences.pushAlerts ? 'bg-[var(--cs-accent)]' : 'bg-[var(--cs-border)]'}`}
            >
              <span className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${preferences.pushAlerts ? 'translate-x-5' : 'translate-x-0'}`} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
