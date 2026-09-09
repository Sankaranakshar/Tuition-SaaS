import { cn } from "@/lib/utils";

export type ChipTone = "neutral" | "positive" | "warn" | "danger" | "accent";

// Near-monochrome semantics (REDESIGN §13): positive/accent carry the pine
// accent, a caution reads as plain grey (no amber), only a real problem is red.
const tones: Record<ChipTone, string> = {
  neutral: "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)]",
  positive: "bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]",
  warn: "bg-[var(--cs-surface-2)] text-[var(--cs-text-muted)]",
  danger: "bg-[var(--cs-danger-soft)] text-[var(--cs-danger)]",
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
