import { cn } from "@/lib/utils";

// Loading placeholders that match the shape of the content they replace.
// No spinners for anything list- or card-shaped (REDESIGN §9): the skeleton
// tells the eye where the real thing will land.

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        "animate-pulse rounded-[6px] bg-[var(--cs-border)]/60",
        className
      )}
    />
  );
}

/** A stack of text lines, e.g. while a paragraph or list item loads. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn("space-y-2", className)}>
      {Array.from({ length: lines }).map((_, i) => (
        <div
          key={i}
          className={cn(
            "h-3.5 animate-pulse rounded-[6px] bg-[var(--cs-border)]/60",
            i === lines - 1 ? "w-2/3" : "w-full"
          )}
        />
      ))}
    </div>
  );
}

/** A person/list row placeholder: avatar + two text lines. */
export function SkeletonRow() {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <Skeleton className="h-9 w-9 rounded-full" />
      <div className="flex-1 space-y-1.5">
        <Skeleton className="h-3.5 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
    </div>
  );
}

/** A card placeholder: header line + body lines. */
export function SkeletonCard() {
  return (
    <div className="rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4">
      <Skeleton className="mb-3 h-4 w-24" />
      <SkeletonText lines={3} />
    </div>
  );
}
