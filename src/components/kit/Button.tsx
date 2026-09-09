import { forwardRef, type ButtonHTMLAttributes } from "react";
import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

type Variant = "primary" | "ghost" | "quiet" | "danger";
type Size = "sm" | "md";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary = the one accent action; ghost = bordered secondary; quiet = borderless tertiary; danger = destructive confirm. */
  variant?: Variant;
  size?: Size;
  /** Optional leading icon, sized and stroked to match the label. */
  icon?: LucideIcon;
}

// The one button (REDESIGN §13). Every call site was repeating the same
// `rounded bg-[var(--cs-accent)] text-white hover:opacity-90` string; this
// centralises it so the accent, the radius, and the motion come from tokens.
const base =
  "inline-flex items-center justify-center gap-1.5 border border-transparent font-medium " +
  "rounded-[var(--cs-radius-control)] " +
  "transition-[background-color,border-color,color,opacity] duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] " +
  "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-focus)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--cs-bg)] " +
  "disabled:cursor-not-allowed disabled:opacity-60";

const variants: Record<Variant, string> = {
  primary: "bg-[var(--cs-accent)] text-[var(--cs-accent-contrast)] hover:bg-[var(--cs-accent-hover)]",
  ghost:
    "border-[var(--cs-border)] text-[var(--cs-text-muted)] hover:border-[var(--cs-border-strong)] hover:bg-[var(--cs-surface-2)] hover:text-[var(--cs-text)]",
  quiet: "text-[var(--cs-text-muted)] hover:bg-[var(--cs-surface-2)] hover:text-[var(--cs-text)]",
  // --cs-surface tracks the opposite pole of --cs-danger in both themes, so it
  // stays the readable label colour without an ad-hoc dark: variant.
  danger: "bg-[var(--cs-danger)] text-[var(--cs-surface)] hover:opacity-90",
};

const sizes: Record<Size, string> = {
  sm: "px-2.5 py-1 text-xs",
  md: "px-3 py-1.5 text-[13px]",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = "primary", size = "md", icon: Icon, className, children, type = "button", ...props }, ref) => (
    <button ref={ref} type={type} className={cn(base, variants[variant], sizes[size], className)} {...props}>
      {Icon && <Icon className="h-4 w-4" strokeWidth={1.75} />}
      {children}
    </button>
  )
);
Button.displayName = "Button";
