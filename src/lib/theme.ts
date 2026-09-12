// Theme preference: light / dark / system (follow the OS). Persisted in
// localStorage under "cs-theme" (absent = system). The initial resolve happens
// in an inline script in index.html to avoid a flash of the wrong theme; this
// module keeps the two in sync and handles runtime changes.
//
// Applied to <html> as both data-theme="light|dark" (drives the --cs-* tokens
// in src/index.css) and the .dark class (drives Tailwind's `dark:` variant).

export type ThemePref = "light" | "dark" | "system";

const STORAGE_KEY = "cs-theme";

export function getThemePref(): ThemePref {
  try {
    const v = localStorage.getItem(STORAGE_KEY);
    return v === "light" || v === "dark" ? v : "system";
  } catch {
    return "system";
  }
}

function prefersDark(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-color-scheme: dark)").matches
  );
}

export function resolveTheme(pref: ThemePref = getThemePref()): "light" | "dark" {
  if (pref === "system") return prefersDark() ? "dark" : "light";
  return pref;
}

export function applyTheme(pref: ThemePref = getThemePref()): void {
  const resolved = resolveTheme(pref);
  const el = document.documentElement;
  el.classList.toggle("dark", resolved === "dark");
  el.setAttribute("data-theme", resolved);
}

export function setThemePref(pref: ThemePref): void {
  try {
    if (pref === "system") localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    // ignore — a private window still gets the applied theme for this session
  }
  applyTheme(pref);
}

// Keep a "system" preference reactive to the OS switching light/dark while the
// app is open. Returns an unsubscribe fn. No-op effect when the user has an
// explicit preference.
export function watchSystemTheme(): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const handler = () => {
    if (getThemePref() === "system") applyTheme("system");
  };
  mq.addEventListener("change", handler);
  return () => mq.removeEventListener("change", handler);
}
