import { cn } from "@/lib/utils";

export type ChipTone = "neutral" | "positive" | "warn" | "danger" | "accent";

const tones: Record<ChipTone, string> = {
  neutral: "bg-[var(--cs-bg)] text-[var(--cs-text-muted)]",
  positive: "bg-green-50 text-green-700 dark:bg-green-900/30 dark:text-green-300",
  warn: "bg-yellow-50 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-300",
  danger: "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-300",
  accent: "bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]",
};

// One small status pill. A dot carries the state for colour-blind readers so
// colour is never the only signal (REDESIGN §14).
export function StatusChip({
  label,
  tone = "neutral",
  dot = true,
  className,
}: {
  label: string;
  tone?: ChipTone;
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium",
        tones[tone],
        className
      )}
    >
      {dot && <span className="h-1.5 w-1.5 rounded-full bg-current opacity-70" />}
      {label}
    </span>
  );
}
