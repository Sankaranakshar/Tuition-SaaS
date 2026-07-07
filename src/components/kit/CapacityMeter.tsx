import { cn } from "@/lib/utils";

interface CapacityMeterProps {
  filled: number;
  capacity: number;
  /** Hide the "3 / 5" label and show only the bar. */
  compact?: boolean;
  className?: string;
}

// A capacity bar that fills as students are added to a class (REDESIGN §6.1).
// Turns amber near full and red when overbooked, so the limit is felt.
export function CapacityMeter({ filled, capacity, compact, className }: CapacityMeterProps) {
  const pct = capacity > 0 ? Math.min(100, (filled / capacity) * 100) : 0;
  const over = filled > capacity;
  const near = !over && capacity > 0 && filled / capacity >= 0.8;

  const barColor = over
    ? "bg-[var(--cs-danger)]"
    : near
      ? "bg-[var(--cs-warn)]"
      : "bg-[var(--cs-accent)]";

  return (
    <div className={cn("flex items-center gap-2", className)}>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--cs-border)]">
        <div
          className={cn("h-full rounded-full transition-all", barColor)}
          style={{ width: `${over ? 100 : pct}%` }}
        />
      </div>
      {!compact && (
        <span
          className={cn(
            "shrink-0 text-xs font-medium tabular-nums",
            over ? "text-[var(--cs-danger)]" : "text-[var(--cs-text-muted)]"
          )}
        >
          {filled} / {capacity}
        </span>
      )}
    </div>
  );
}
