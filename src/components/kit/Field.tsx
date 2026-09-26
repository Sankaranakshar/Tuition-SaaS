import { cloneElement, forwardRef, isValidElement, useId, type InputHTMLAttributes, type ReactElement, type ReactNode } from "react";
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
   *  generated id is given to a single input/select/textarea child, or
   *  passed to `renderControl`. */
  htmlFor?: string;
  hint?: string;
  error?: string | null;
  required?: boolean;
  className?: string;
  children?: ReactNode;
  /** Alternative to children when you want the generated id wired for you. */
  renderControl?: (id: string) => ReactNode;
}

// A <label htmlFor> only names a control that carries that id. Most call
// sites pass one bare <Input>/<select>/<textarea> as children with no id, so
// until 2026-09-26 their labels named nothing and screen readers announced
// unlabelled fields (found by Step 31's axe pass). Give such a child the id.
const LABELLABLE = new Set<unknown>(["input", "select", "textarea", Input]);
function withControlId(children: ReactNode, id: string): ReactNode {
  if (!isValidElement(children) || !LABELLABLE.has(children.type)) return children;
  const el = children as ReactElement<{ id?: string }>;
  return el.props.id ? el : cloneElement(el, { id });
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
      {renderControl ? renderControl(id) : withControlId(children, id)}
      {hint && !error && <p className="text-xs text-[var(--cs-text-muted)]">{hint}</p>}
      {error && <p className="text-xs text-[var(--cs-danger)]">{error}</p>}
    </div>
  );
}
