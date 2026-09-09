import type { LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "./Button";

interface EmptyStateProps {
  icon?: LucideIcon;
  title: string;
  description?: string;
  /** The one primary action. Rendered as a filled accent button. */
  action?: { label: string; onClick: () => void };
  /** An optional secondary "show me an example" affordance. */
  example?: { label: string; onClick: () => void };
  className?: string;
}

// Every empty list says what it is, why it is empty, and offers exactly one
// primary action (REDESIGN §9). Never a bare "No data".
export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
  example,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        "flex flex-col items-center justify-center rounded-[10px] border border-dashed border-[var(--cs-border)] px-6 py-12 text-center",
        className
      )}
    >
      {Icon && (
        <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-full bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]">
          <Icon className="h-5 w-5" strokeWidth={1.75} />
        </div>
      )}
      <h3 className="text-sm font-semibold text-[var(--cs-text)]">{title}</h3>
      {description && (
        <p className="mt-1 max-w-sm text-sm text-[var(--cs-text-muted)]">{description}</p>
      )}
      {(action || example) && (
        <div className="mt-5 flex items-center gap-2">
          {action && <Button onClick={action.onClick}>{action.label}</Button>}
          {example && (
            <Button variant="ghost" onClick={example.onClick}>
              {example.label}
            </Button>
          )}
        </div>
      )}
    </div>
  );
}
