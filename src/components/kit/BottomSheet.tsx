import { useEffect, useState, type ReactNode } from "react";
import { Modal } from "./Modal";

interface BottomSheetProps {
  /** Called on backdrop click and Escape. */
  onClose: () => void;
  children: ReactNode;
  className?: string;
  labelledBy?: string;
  label?: string;
}

// The mobile counterpart to Popover: same `Modal` a11y wrapper (focus trap,
// Escape, role="dialog"), but slid up from the bottom edge instead of
// anchored to a trigger — anchored popovers don't work well touch-first.
// CSS transition only, no gesture library (see Stage 4 mobile-polish plan:
// the main bundle has ~14% headroom against its 260KB gzip budget).
export function BottomSheet({ onClose, children, className, labelledBy, label }: BottomSheetProps) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const raf = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(raf);
  }, []);

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50" onClick={onClose}>
      <Modal
        onClose={onClose}
        labelledBy={labelledBy}
        label={label}
        className={`w-full max-w-md rounded-t-[10px] border-t border-[var(--cs-border)] bg-[var(--cs-surface)] pb-[env(safe-area-inset-bottom)] shadow-lg transition-transform duration-200 ease-out ${
          entered ? "translate-y-0" : "translate-y-full"
        } ${className || ""}`}
      >
        <div className="flex justify-center pb-1 pt-2">
          <span className="h-1 w-9 rounded-full bg-[var(--cs-border)]" />
        </div>
        {children}
      </Modal>
    </div>
  );
}
