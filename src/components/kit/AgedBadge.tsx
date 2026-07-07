import { cn } from "@/lib/utils";

interface AgedBadgeProps {
  /** Days overdue. 0 or negative means not yet due. */
  daysOverdue: number;
  className?: string;
}

// Aging with escalating temperature (REDESIGN §6.4): 0-7 quiet, 8-30 amber,
// 30+ red. Colour is never the sole signal — the text always states the days.
export function AgedBadge({ daysOverdue, className }: AgedBadgeProps) {
  const d = Math.floor(daysOverdue);

  if (d <= 0) {
    return (
      <span
        className={cn(
          "inline-flex items-center rounded-full bg-[var(--cs-bg)] px-2 py-0.5 text-xs font-medium text-[var(--cs-text-muted)] tabular-nums",
          className
        )}
      >
        Not due
      </span>
    );
  }

  const bucket =
    d > 30
      ? { bg: "bg-red-50", text: "text-red-700", dark: "dark:bg-red-900/30 dark:text-red-300" }
      : d > 7
        ? { bg: "bg-yellow-50", text: "text-yellow-800", dark: "dark:bg-yellow-900/30 dark:text-yellow-300" }
        : { bg: "bg-gray-100", text: "text-gray-700", dark: "dark:bg-gray-800 dark:text-gray-300" };

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        bucket.bg,
        bucket.text,
        bucket.dark,
        className
      )}
    >
      {d}d overdue
    </span>
  );
}
