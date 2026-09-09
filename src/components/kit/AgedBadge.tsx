import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";

interface AgedBadgeProps {
  /** Days overdue. 0 or negative means not yet due. */
  daysOverdue: number;
  className?: string;
}

// Aging reads as neutral grey plus the day count (REDESIGN §13, no amber):
// not due and recently overdue are both quiet, and only well overdue (30+
// days) turns red — the single escalation signal. The text always states the
// days, so colour is never the only cue.
export function AgedBadge({ daysOverdue, className }: AgedBadgeProps) {
  const { t } = useTranslation();
  const d = Math.floor(daysOverdue);

  const wellOverdue = d > 30;
  const label = d <= 0 ? t("common.notDue") : t("common.daysOverdue", { count: d });

  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium tabular-nums",
        wellOverdue
          ? "bg-[var(--cs-danger-soft)] text-[var(--cs-danger)]"
          : "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)]",
        className
      )}
    >
      {label}
    </span>
  );
}
