import { useState } from "react";
import { Bell, Mail, Smartphone, Save } from "lucide-react";
import { Toggle } from "@/components/kit";

const NOTIFICATION_ROWS = [
  { key: "emailNotifications", icon: Mail, title: "Email Notifications", desc: "Receive updates and reminders via email." },
  { key: "smsNotifications", icon: Smartphone, title: "SMS Notifications", desc: "Receive urgent alerts via text message." },
  { key: "pushAlerts", icon: Bell, title: "Push Alerts", desc: "Receive real-time notifications in the browser." },
] as const;

export default function Preferences() {
  const [preferences, setPreferences] = useState({
    emailNotifications: true,
    smsNotifications: false,
    pushAlerts: true,
    classReminders: true,
    assignmentUpdates: true,
    marketingEmails: false,
  });

  const setToggle = (key: keyof typeof preferences, next: boolean) => {
    setPreferences(prev => ({ ...prev, [key]: next }));
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-[var(--cs-text)]">Preferences</h1>
        <button className="flex items-center rounded-[var(--cs-radius-control)] bg-[var(--cs-accent)] px-4 py-2 text-sm font-medium text-[var(--cs-accent-contrast)] hover:bg-[var(--cs-accent-hover)] transition-colors">
          <Save className="w-4 h-4 mr-2" />
          Save Preferences
        </button>
      </div>

      <div className="bg-[var(--cs-surface)] rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--cs-border)] flex justify-between items-center">
          <h2 className="text-lg font-semibold text-[var(--cs-text)] flex items-center">
            <Bell className="w-5 h-5 mr-2 text-[var(--cs-accent)]" />
            Notification Settings
          </h2>
        </div>

        <div className="p-6 space-y-6">
          {NOTIFICATION_ROWS.map(({ key, icon: Icon, title, desc }) => (
            <div key={key} className="flex items-center justify-between">
              <div className="flex items-center">
                <Icon className="w-5 h-5 text-[var(--cs-text-muted)] mr-3" />
                <div>
                  <p className="text-sm font-medium text-[var(--cs-text)]">{title}</p>
                  <p className="text-xs text-[var(--cs-text-muted)]">{desc}</p>
                </div>
              </div>
              <Toggle
                label={title}
                checked={preferences[key]}
                onChange={next => setToggle(key, next)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
