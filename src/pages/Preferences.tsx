import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Bell, Mail, Smartphone, Save, Sun, Moon, Monitor } from "lucide-react";
import { Toggle, Button } from "@/components/kit";
import { getThemePref, setThemePref, type ThemePref } from "@/lib/theme";

const NOTIFICATION_ROWS = [
  { key: "emailNotifications", icon: Mail },
  { key: "smsNotifications", icon: Smartphone },
  { key: "pushAlerts", icon: Bell },
] as const;

const THEME_OPTIONS: { value: ThemePref; icon: typeof Sun }[] = [
  { value: "light", icon: Sun },
  { value: "dark", icon: Moon },
  { value: "system", icon: Monitor },
];

export default function Preferences() {
  const { t } = useTranslation();
  const [preferences, setPreferences] = useState({
    emailNotifications: true,
    smsNotifications: false,
    pushAlerts: true,
  });
  const [themePref, setThemePrefState] = useState<ThemePref>(getThemePref);

  const setToggle = (key: keyof typeof preferences, next: boolean) => {
    setPreferences((prev) => ({ ...prev, [key]: next }));
  };

  const chooseTheme = (pref: ThemePref) => {
    setThemePrefState(pref);
    setThemePref(pref);
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--cs-text)]">{t("preferences.title")}</h1>
        <Button icon={Save}>{t("preferences.save")}</Button>
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
