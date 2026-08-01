import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PopoverProps {
  /** Content rendered inside the trigger button (icon, text, or both). */
  trigger: ReactNode;
  /** Classes applied to the trigger <button> itself — same classes callers used to put on their own wrapping element. */
  triggerClassName?: string;
  /** Optional title/tooltip on the trigger button. */
  triggerTitle?: string;
  /** Popover body. Receives `close` to dismiss after an action. */
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
  className?: string;
}

// A lightweight anchored popover: the primitive behind all inline editing
// (REDESIGN §10, "popover-first editing"). Closes on outside click and Esc.
// Multi-field creation still uses a Dialog; this is for edit-in-place.
//
// The trigger is always a real <button> owned by this component (not a
// caller-supplied element wrapped in a plain onClick div) — some callers
// used to pass a non-interactive <span className="cursor-pointer"> as the
// whole trigger, which was invisible to keyboard/screen-reader users
// (docs/OPTIMIZATION_AUDIT.md finding H6). Callers now pass only the inner
// content (icon/text) plus `triggerClassName` for styling.
export function Popover({ trigger, triggerClassName, triggerTitle, children, align = "left", className }: PopoverProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  // Restores focus to the trigger — used for Escape and for the `close`
  // callback handed to children (e.g. "close after save"), both of which are
  // keyboard-driven exits where returning focus to a known place matters.
  // Outside-pointer-click dismissal deliberately does NOT force focus here;
  // the browser's own click-driven focus already goes wherever the user clicked.
  const close = useCallback(() => {
    setOpen(false);
    triggerRef.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);

  return (
    <div className="relative inline-flex" ref={ref}>
      <button
        ref={triggerRef}
        type="button"
        title={triggerTitle}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={triggerClassName}
      >
        {trigger}
      </button>
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
