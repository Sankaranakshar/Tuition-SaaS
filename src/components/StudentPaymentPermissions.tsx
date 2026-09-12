import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Save } from "lucide-react";
import { Button, Field } from "./kit";
import { getStudentPaymentPermissions, setStudentPaymentPermissions } from "../lib/api";
import { rupeesToPaise, paiseToRupees } from "../../shared/money";
import { DEFAULT_PAYMENT_PERMISSIONS, type PaymentPermissions } from "../../shared/paymentPermissions";

// D-05 (MASTER_PLAN.md §5) / EXECUTION_PLAN.md Step 19: a parent's per-child
// payment-permissions settings — self-pay toggle, spending limit, allowed
// methods — enforced server-side on the one self-serve student-initiated
// path that exists today (POST /api/v1/session-requests). Embedded in
// ParentPortal.tsx's per-child settings tab; also usable from a staff
// context (owner/admin), since the route allows both.
//
// Matches kit Input's skin for the native <input> elements this form
// doesn't route through the kit wrapper for (same recipe as
// OrganizationSettings.tsx's FIELD_CLASS/CHECKBOX_CLASS).
const FIELD_CLASS =
  "mt-1 block w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface)] py-1.5 px-3 text-[13px] text-[var(--cs-text)] outline-none transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] focus:border-[var(--cs-focus)] focus:ring-2 focus:ring-[var(--cs-focus)]/30 disabled:opacity-50";
const CHECKBOX_CLASS = "h-4 w-4 rounded border-[var(--cs-border-strong)] text-[var(--cs-accent)] focus:ring-[var(--cs-focus)]";

const METHODS: { id: "wallet" | "razorpay_link"; labelKey: string }[] = [
  { id: "wallet", labelKey: "studentPaymentPermissions.methodWallet" },
  { id: "razorpay_link", labelKey: "studentPaymentPermissions.methodRazorpayLink" },
];

export default function StudentPaymentPermissions({ studentId, studentName }: { studentId: string; studentName: string }) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [permissions, setPermissions] = useState<PaymentPermissions>(DEFAULT_PAYMENT_PERMISSIONS);
  const [limitInput, setLimitInput] = useState(""); // rupees, empty = no limit

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    getStudentPaymentPermissions(studentId)
      .then((res) => {
        if (cancelled) return;
        setPermissions(res);
        setLimitInput(res.spendingLimitPaise != null ? String(paiseToRupees(res.spendingLimitPaise)) : "");
      })
      .catch(() => { if (!cancelled) toast.error(t("studentPaymentPermissions.loadFailed")); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [studentId, t]);

  function toggleMethod(method: "wallet" | "razorpay_link") {
    setPermissions((prev) => ({
      ...prev,
      allowedPaymentMethods: prev.allowedPaymentMethods.includes(method)
        ? prev.allowedPaymentMethods.filter((m) => m !== method)
        : [...prev.allowedPaymentMethods, method],
    }));
  }

  async function handleSave() {
    const trimmed = limitInput.trim();
    const rupees = trimmed === "" ? null : Number(trimmed);
    if (rupees !== null && (!Number.isFinite(rupees) || rupees <= 0)) {
      toast.error(t("studentPaymentPermissions.invalidLimit"));
      return;
    }
    setSaving(true);
    try {
      const body: PaymentPermissions = {
        selfPayAllowed: permissions.selfPayAllowed,
        spendingLimitPaise: rupees === null ? null : rupeesToPaise(rupees),
        allowedPaymentMethods: permissions.allowedPaymentMethods,
      };
      const saved = await setStudentPaymentPermissions(studentId, body);
      setPermissions(saved);
      setLimitInput(saved.spendingLimitPaise != null ? String(paiseToRupees(saved.spendingLimitPaise)) : "");
      toast.success(t("studentPaymentPermissions.saved"));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("studentPaymentPermissions.saveFailed"));
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return <p className="px-1 text-sm text-[var(--cs-text-muted)]">{t("studentPaymentPermissions.loading")}</p>;
  }

  return (
    <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4">
      <p className="text-sm font-medium text-[var(--cs-text)]">{t("studentPaymentPermissions.title", { name: studentName })}</p>
      <p className="mt-1 text-xs text-[var(--cs-text-muted)]">{t("studentPaymentPermissions.description", { name: studentName })}</p>

      <label className="mt-4 flex items-center gap-2 text-sm text-[var(--cs-text)]">
        <input
          type="checkbox"
          className={CHECKBOX_CLASS}
          checked={permissions.selfPayAllowed}
          onChange={(e) => setPermissions((prev) => ({ ...prev, selfPayAllowed: e.target.checked }))}
        />
        {t("studentPaymentPermissions.selfPayLabel")}
      </label>

      <Field
        label={t("studentPaymentPermissions.spendingLimitLabel")}
        className="mt-3"
        renderControl={(id) => (
          <input
            id={id}
            type="number"
            min="1"
            inputMode="decimal"
            placeholder={t("studentPaymentPermissions.spendingLimitPlaceholder")}
            value={limitInput}
            onChange={(e) => setLimitInput(e.target.value)}
            className={FIELD_CLASS}
          />
        )}
      />

      <div className="mt-3">
        <p className="text-sm text-[var(--cs-text)]">{t("studentPaymentPermissions.methodsLabel")}</p>
        <div className="mt-1 space-y-1.5">
          {METHODS.map((m) => (
            <label key={m.id} className="flex items-center gap-2 text-sm text-[var(--cs-text-muted)]">
              <input
                type="checkbox"
                className={CHECKBOX_CLASS}
                checked={permissions.allowedPaymentMethods.includes(m.id)}
                onChange={() => toggleMethod(m.id)}
              />
              {t(m.labelKey)}
            </label>
          ))}
        </div>
      </div>

      <Button onClick={handleSave} disabled={saving} icon={Save} className="mt-4 w-full">
        {saving ? t("studentPaymentPermissions.saving") : t("studentPaymentPermissions.save")}
      </Button>
    </div>
  );
}
