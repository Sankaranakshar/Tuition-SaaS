import { useState } from "react";
import { useTranslation } from "react-i18next";
import { cn } from "@/lib/utils";
import { Popover } from "./Popover";
import { Button } from "./Button";
import { Input } from "./Field";

interface PopoverEditProps {
  /** Current value, rendered as the clickable trigger. */
  value: string;
  /** Called with the new value on save. May be async. */
  onSave: (next: string) => void | Promise<void>;
  label?: string;
  type?: "text" | "number";
  placeholder?: string;
  /** Return an error string to block save, or null/undefined to allow. */
  validate?: (next: string) => string | null | undefined;
  className?: string;
}

// Click a value, edit it in place, save or cancel. The universal inline-edit
// control (REDESIGN §10). Validation shows at the field, in plain language.
export function PopoverEdit({
  value,
  onSave,
  label,
  type = "text",
  placeholder,
  validate,
  className,
}: PopoverEditProps) {
  return (
    <Popover
      trigger={value || placeholder || "—"}
      triggerClassName={cn(
        "rounded-[var(--cs-radius-control)] px-1.5 py-0.5 text-sm text-[var(--cs-text)] underline decoration-dotted decoration-[var(--cs-text-muted)] underline-offset-4 transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)]",
        className
      )}
    >
      {(close) => (
        <Editor
          initial={value}
          label={label}
          type={type}
          placeholder={placeholder}
          validate={validate}
          onCancel={close}
          onSubmit={async (next) => {
            await onSave(next);
            close();
          }}
        />
      )}
    </Popover>
  );
}

function Editor({
  initial,
  label,
  type,
  placeholder,
  validate,
  onSubmit,
  onCancel,
}: {
  initial: string;
  label?: string;
  type: "text" | "number";
  placeholder?: string;
  validate?: (next: string) => string | null | undefined;
  onSubmit: (next: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const [val, setVal] = useState(initial);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const err = validate?.(val);
    if (err) {
      setError(err);
      return;
    }
    setSaving(true);
    try {
      await onSubmit(val);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
      className="flex flex-col gap-2"
    >
      {label && <label className="text-xs font-medium text-[var(--cs-text-muted)]">{label}</label>}
      <Input
        autoFocus
        type={type}
        value={val}
        placeholder={placeholder}
        onChange={(e) => {
          setVal(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={(e) => {
          if (e.key === "Escape") onCancel();
        }}
      />
      {error && <p className="text-xs text-[var(--cs-danger)]">{error}</p>}
      <div className="flex items-center justify-end gap-2 pt-0.5">
        <Button type="button" variant="quiet" size="sm" onClick={onCancel}>
          {t("common.cancel")}
        </Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving ? t("common.saving") : t("common.save")}
        </Button>
      </div>
    </form>
  );
}
