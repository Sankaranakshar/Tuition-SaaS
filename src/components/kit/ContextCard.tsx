import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface ContextCardProps {
  icon?: LucideIcon;
  /** What this thread/notification is about, e.g. "Invoice #142". */
  title: string;
  /** The supporting facts, e.g. "₹3,000 · overdue 6 days". */
  detail?: string;
  /** Inline action(s) so the reader never has to leave to act. */
  action?: ReactNode;
  tone?: "default" | "warn" | "danger";
  className?: string;
}

// The anchor card at the top of an Inbox thread or notification (REDESIGN
// §6.5): it names the entity in question and carries its action inline, so a
// "did Riya attend?" question is answered without leaving the thread.
export function ContextCard({
  icon: Icon,
  title,
  detail,
  action,
  tone = "default",
  className,
}: ContextCardProps) {
  const accent =
    tone === "danger"
      ? "border-l-[var(--cs-danger)]"
      : tone === "warn"
        ? "border-l-[var(--cs-warn)]"
        : "border-l-[var(--cs-accent)]";

  return (
    <div
      className={cn(
        "flex items-center gap-3 rounded-[10px] border border-[var(--cs-border)] border-l-2 bg-[var(--cs-surface)] px-3.5 py-3",
        accent,
        className
      )}
    >
      {Icon && (
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[6px] bg-[var(--cs-bg)] text-[var(--cs-text-muted)]">
          <Icon className="h-4 w-4" strokeWidth={1.75} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <div className="truncate text-sm font-medium text-[var(--cs-text)]">{title}</div>
        {detail && <div className="truncate text-xs text-[var(--cs-text-muted)]">{detail}</div>}
      </div>
      {action && <div className="flex shrink-0 items-center gap-1">{action}</div>}
    </div>
  );
}
