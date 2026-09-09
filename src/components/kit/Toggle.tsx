import { cn } from "@/lib/utils";

interface ToggleProps {
  checked: boolean;
  onChange: (next: boolean) => void;
  /** Accessible name — the switch carries no visible text of its own. */
  label: string;
  id?: string;
  disabled?: boolean;
  className?: string;
}

// The one switch (extracted from Preferences). role="switch" + aria-checked so
// AT announces the state; the knob and track colours come from tokens, and the
// travel uses the fast motion tier (collapsed to nothing by the global
// prefers-reduced-motion guard).
export function Toggle({ checked, onChange, label, id, disabled, className }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex h-6 w-11 flex-shrink-0 items-center rounded-full border-2 border-transparent",
        "transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)]",
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--cs-bg)]",
        "disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-[var(--cs-accent)]" : "bg-[var(--cs-border-strong)]",
        className
      )}
    >
      <span
        className={cn(
          "pointer-events-none inline-block h-5 w-5 transform rounded-full bg-[var(--cs-surface)] shadow-sm",
          "transition-transform duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)]",
          checked ? "translate-x-5" : "translate-x-0"
        )}
      />
    </button>
  );
}
