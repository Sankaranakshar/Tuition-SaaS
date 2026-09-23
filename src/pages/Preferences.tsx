import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Bell, Mail, Smartphone, Save, Sun, Moon, Monitor } from "lucide-react";
import { Toggle, Button } from "@/components/kit";
import { getThemePref, setThemePref, type ThemePref } from "@/lib/theme";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";

const NOTIFICATION_ROWS = [
  { key: "emailNotifications", icon: Mail },
  { key: "smsNotifications", icon: Smartphone },
  { key: "pushAlerts", icon: Bell },
] as const;

type NotificationPrefs = { emailNotifications: boolean; smsNotifications: boolean; pushAlerts: boolean };
// B-17 (EXECUTION_PLAN.md Step 27): these preferences are read for real now
// -- smsNotifications gates every WhatsApp/SMS send server-side
// (server/utils/messaging/outbox.ts's enqueueMessage). Default true: every
// message this router sends is transactional (about the parent's own child,
// under an existing relationship), not marketing, so opt-in-by-default is
// the correct posture — the toggle is for the rare parent who wants to opt
// out, not a consent gate on messages nobody would otherwise expect.
const DEFAULT_PREFS: NotificationPrefs = { emailNotifications: true, smsNotifications: true, pushAlerts: true };

const THEME_OPTIONS: { value: ThemePref; icon: typeof Sun }[] = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
];

export default function Preferences() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [preferences, setPreferences] = useState<NotificationPrefs>(DEFAULT_PREFS);
  const [themePref, setThemePrefState] = useState<ThemePref>(getThemePref);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!user) return;
    supabase.from("profiles").select("preferences").eq("id", user.id).maybeSingle().then(({ data }) => {
      const stored = (data?.preferences as { notifications?: Partial<NotificationPrefs> } | null)?.notifications;
      if (stored) setPreferences((prev) => ({ ...prev, ...stored }));
    });
  }, [user]);

  const setToggle = (key: keyof NotificationPrefs, next: boolean) => {
    setPreferences((prev) => ({ ...prev, [key]: next }));
  };

  const chooseTheme = (pref: ThemePref) => {
    setThemePrefState(pref);
    setThemePref(pref);
  };

  const save = async () => {
    if (!user) return;
    setSaving(true);
    try {
      // profiles.preferences is a jsonb column with other keys the app may
      // set elsewhere -- merge under a `notifications` key rather than
      // overwriting the whole column.
      const { data } = await supabase.from("profiles").select("preferences").eq("id", user.id).maybeSingle();
      const merged = { ...(data?.preferences as Record<string, unknown> | null), notifications: preferences };
      const { error } = await supabase.from("profiles").update({ preferences: merged, updated_at: new Date().toISOString() }).eq("id", user.id);
      if (error) throw error;
      toast.success(t("preferences.saved"));
    } catch (err: any) {
      toast.error(t("preferences.saveFailed"), { description: err.message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--cs-text)]">{t("preferences.title")}</h1>
        <Button icon={Save} onClick={save} disabled={saving}>{t("preferences.save")}</Button>
      </div>

      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <h2 className="border-b border-[var(--cs-border)] px-4 py-3 text-sm font-semibold text-[var(--cs-text)]">
          {t("preferences.appearance")}
        </h2>
        <div className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-medium text-[var(--cs-text)]">{t("preferences.theme")}</p>
            <p className="text-xs text-[var(--cs-text-muted)]">{t("preferences.themeDescription")}</p>
          </div>
          <div className="flex gap-1 rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-bg)] p-1">
            {THEME_OPTIONS.map(({ value, icon: Icon }) => (
              <button
                key={value}
                type="button"
                aria-pressed={themePref === value}
                onClick={() => chooseTheme(value)}
                className={`flex flex-1 items-center justify-center gap-1.5 rounded-[var(--cs-radius-control)] px-3 py-1.5 text-sm font-medium transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] ${
                  themePref === value
                    ? "bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]"
                    : "text-[var(--cs-text-muted)] hover:bg-[var(--cs-surface-2)]"
                }`}
              >
                <Icon className="h-4 w-4" strokeWidth={1.75} />
                {t(`preferences.theme_${value}`)}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <h2 className="border-b border-[var(--cs-border)] px-4 py-3 text-sm font-semibold text-[var(--cs-text)]">
          {t("preferences.notifications")}
        </h2>

        <div className="space-y-6 p-4">
          {NOTIFICATION_ROWS.map(({ key, icon: Icon }) => (
            <div key={key} className="flex items-center justify-between">
              <div className="flex items-center">
                <Icon className="mr-3 h-5 w-5 text-[var(--cs-text-muted)]" strokeWidth={1.75} />
                <div>
                  <p className="text-sm font-medium text-[var(--cs-text)]">{t(`preferences.${key}`)}</p>
                  <p className="text-xs text-[var(--cs-text-muted)]">{t(`preferences.${key}Description`)}</p>
                </div>
              </div>
              <Toggle
                label={t(`preferences.${key}`)}
                checked={preferences[key]}
                onChange={(next) => setToggle(key, next)}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
