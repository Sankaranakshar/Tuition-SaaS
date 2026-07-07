import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface StatChipProps {
  label: string;
  value: string | number;
  /** Optional supporting delta line, e.g. "vs last week". */
  hint?: string;
  icon?: LucideIcon;
  /** Colour the value for semantic emphasis. Calm by default. */
  tone?: "default" | "positive" | "warn" | "danger";
  onClick?: () => void;
  className?: string;
}

const toneText: Record<NonNullable<StatChipProps["tone"]>, string> = {
  default: "text-[var(--cs-text)]",
  positive: "text-[var(--cs-ok)]",
  warn: "text-[var(--cs-warn)]",
  danger: "text-[var(--cs-danger)]",
};

// A single number that means something, with room for a label and a hint.
// Three of these are the Pulse (REDESIGN §5); charts live in Money → Insights.
export function StatChip({
  label,
  value,
  hint,
  icon: Icon,
  tone = "default",
  onClick,
  className,
}: StatChipProps) {
  const Wrapper = onClick ? "button" : "div";
  return (
    <Wrapper
      onClick={onClick}
      className={cn(
        "flex flex-col gap-1 rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4 text-left",
        onClick && "transition-colors hover:border-[var(--cs-accent)] focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--cs-accent)]",
        className
      )}
    >
      <div className="flex items-center gap-1.5 text-xs font-medium text-[var(--cs-text-muted)]">
        {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.75} />}
        {label}
      </div>
      <div className={cn("text-2xl font-semibold tabular-nums", toneText[tone])} data-money>
        {value}
      </div>
      {hint && <div className="text-xs text-[var(--cs-text-muted)]">{hint}</div>}
    </Wrapper>
  );
}
