import { useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PopoverProps {
  /** The clickable element that opens the popover. */
  trigger: ReactNode;
  /** Popover body. Receives `close` to dismiss after an action. */
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
}

// A lightweight anchored popover: the primitive behind all inline editing
// (REDESIGN §10, "popover-first editing"). Closes on outside click and Esc.
// Multi-field creation still uses a Dialog; this is for edit-in-place.
export function Popover({ trigger, children, align = "left", className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const close = () => setOpen(false);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-flex" ref={ref}>
      <div onClick={() => setOpen((o) => !o)}>{trigger}</div>
      {open && (
        <div
          className={cn(
            "absolute top-full z-30 mt-1.5 min-w-56 rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-3 shadow-lg",
            align === "right" ? "right-0" : "left-0",
            className
          )}
        >
          {children(close)}
        </div>
      )}
    </div>
  );
}
