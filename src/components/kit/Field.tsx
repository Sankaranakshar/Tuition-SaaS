import { forwardRef, useId, type InputHTMLAttributes, type ReactNode } from "react";
import { cn } from "@/lib/utils";

// The shared text-input skin (REDESIGN §13): surface fill, strong hairline,
// tight control radius, a 2px accent focus ring. Replaces the ~20 hand-rolled
// `border border-[var(--cs-border)] ... focus:border-[var(--cs-accent)]`
// strings scattered through the pages.
export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => (
    <input
      ref={ref}
      className={cn(
        "w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface)] px-3 py-1.5 text-[13px] text-[var(--cs-text)]",
        "placeholder:text-[var(--cs-text-faint)] outline-none",
        "transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)]",
        "focus:border-[var(--cs-focus)] focus:ring-2 focus:ring-[var(--cs-focus)]/30",
        "disabled:cursor-not-allowed disabled:opacity-60",
        className
      )}
      {...props}
    />
  )
);
Input.displayName = "Input";

interface FieldProps {
  label: string;
  /** Supply when wrapping a control you render yourself; otherwise the
   *  generated id is passed to the single child via `renderControl`. */
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children?: ReactNode;
  /** Alternative to children when you want the generated id wired for you. */
  renderControl?: (id: string) => ReactNode;
}

// Label + optional hint + inline error, in plain language and at the field
// (REDESIGN §9). Never a toast for a validation problem.
export function Field({ label, htmlFor, hint, error, required, className, children, renderControl }: FieldProps) {
  const generatedId = useId();
  const id = htmlFor ?? generatedId;
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-xs font-medium text-[var(--cs-text-muted)]">
        {label}
        {required && <span className="ml-0.5 text-[var(--cs-danger)]">*</span>}
      </label>
      {renderControl ? renderControl(id) : children}
      {hint && !error && <p className="text-xs text-[var(--cs-text-faint)]">{hint}</p>}
      {error && <p className="text-xs text-[var(--cs-danger)]">{error}</p>}
    </div>
  );
}
