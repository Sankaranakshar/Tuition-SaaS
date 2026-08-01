import { useEffect, useRef, type ReactNode } from "react";

interface ModalProps {
  /** Called on Escape and should also be wired to the caller's own backdrop onClick. */
  onClose: () => void;
  children: ReactNode;
  /** Classes for the dialog panel itself (the caller's existing panel classes). */
  className?: string;
  /** id of a heading inside children, for aria-labelledby. */
  labelledBy?: string;
  /** Fallback accessible name when there's no heading id to reference. */
  label?: string;
}

const FOCUSABLE_SELECTOR =
  'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

// Adds real dialog semantics to an existing modal panel — role="dialog",
// aria-modal, Escape-to-close, a focus trap, initial focus-in, and focus
// restoration on close — WITHOUT imposing new backdrop/layout markup. Every
// modal overlay in this codebase already builds its own backdrop (centering
// strategy, z-index, and mobile-sheet-vs-centered layout all differ between
// call sites), so this wraps only the panel: replace the panel's outer
// `<div onClick={stopPropagation}>` with `<Modal onClose={...}>`, keep the
// caller's own backdrop div exactly as it is (docs/OPTIMIZATION_AUDIT.md
// finding H6 — before this, there was zero role="dialog"/aria-modal/focus
// trap anywhere in the app).
export function Modal({ onClose, children, className, labelledBy, label }: ModalProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    previouslyFocused.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const firstFocusable = panel?.querySelector<HTMLElement>(FOCUSABLE_SELECTOR);
    // Land focus inside the dialog (its first focusable control, or the
    // panel itself as a fallback) so keyboard/AT users aren't left on
    // whatever was focused on the page behind the overlay.
    (firstFocusable ?? panel)?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panel) return;
      const focusables = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
        (el) => el.offsetParent !== null // skip hidden elements
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previouslyFocused.current?.focus();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-modal="true"
      aria-labelledby={labelledBy}
      aria-label={labelledBy ? undefined : label}
      tabIndex={-1}
      onClick={(e) => e.stopPropagation()}
      className={className}
    >
      {children}
    </div>
  );
}
