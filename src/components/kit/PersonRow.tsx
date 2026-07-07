import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusChip, type ChipTone } from "./StatusChip";

interface PersonRowProps {
  name: string;
  /** One "last activity" sentence, e.g. "Paid ₹3,000 · 2 days ago". */
  subtitle?: string;
  /** Optional avatar image; falls back to the name initial. */
  avatarUrl?: string;
  status?: { label: string; tone?: ChipTone };
  /** Inline actions revealed on hover (desktop) / always shown (touch). */
  actions?: ReactNode;
  selected?: boolean;
  onClick?: () => void;
  className?: string;
}

// The single row schema shared by every People lens (REDESIGN §6.2):
// avatar, name, one status chip, one activity sentence, hover actions.
export function PersonRow({
  name,
  subtitle,
  avatarUrl,
  status,
  actions,
  selected,
  onClick,
  className,
}: PersonRowProps) {
  return (
    <div
      onClick={onClick}
      className={cn(
        "group flex items-center gap-3 rounded-[6px] px-3 py-2.5 transition-colors",
        onClick && "cursor-pointer hover:bg-[var(--cs-bg)]",
        selected && "bg-[var(--cs-accent-soft)]",
        className
      )}
    >
      {avatarUrl ? (
        <img src={avatarUrl} alt="" className="h-9 w-9 shrink-0 rounded-full object-cover" />
      ) : (
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--cs-accent-soft)] text-sm font-semibold text-[var(--cs-accent)]">
          {name.charAt(0).toUpperCase()}
        </div>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm font-medium text-[var(--cs-text)]">{name}</span>
          {status && <StatusChip label={status.label} tone={status.tone} />}
        </div>
        {subtitle && (
          <div className="truncate text-xs text-[var(--cs-text-muted)]">{subtitle}</div>
        )}
      </div>

      {actions && (
        <div className="flex shrink-0 items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          {actions}
        </div>
      )}
    </div>
  );
}
