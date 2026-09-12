import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import { Download } from "lucide-react";
import { Button } from "./kit";
import { downloadProgressReport } from "../lib/api";

// B-12 (MASTER_PLAN.md §4 / EXECUTION_PLAN.md Step 22): a month picker plus a
// download button for the server-rendered progress-report PDF. Used from
// both StudentStory.tsx (staff/self view) and ParentPortal.tsx (a parent's
// per-child settings tab) — one small component rather than duplicating the
// month-state/download-call logic in each page, same reasoning
// StudentPaymentPermissions.tsx gives for being its own component.
//
// Matches kit Input's skin for the native <input type="month"> this form
// doesn't route through the kit wrapper for (same recipe as
// StudentPaymentPermissions.tsx's FIELD_CLASS).
const FIELD_CLASS =
  "rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface)] py-1.5 px-3 text-[13px] text-[var(--cs-text)] outline-none transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] focus:border-[var(--cs-focus)] focus:ring-2 focus:ring-[var(--cs-focus)]/30";

function currentMonth(): string {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function ProgressReportDownload({ studentId }: { studentId: string }) {
  const { t } = useTranslation();
  const [month, setMonth] = useState(currentMonth());
  const [downloading, setDownloading] = useState(false);

  async function handleDownload() {
    setDownloading(true);
    try {
      await downloadProgressReport(studentId, month);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t("progressReport.downloadFailed"));
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] p-4">
      <p className="text-sm font-medium text-[var(--cs-text)]">{t("progressReport.title")}</p>
      <p className="mt-1 text-xs text-[var(--cs-text-muted)]">{t("progressReport.description")}</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          type="month"
          value={month}
          onChange={(e) => setMonth(e.target.value)}
          max={currentMonth()}
          className={FIELD_CLASS}
          aria-label={t("progressReport.monthLabel")}
        />
        <Button onClick={handleDownload} disabled={downloading || !month} icon={Download} size="sm">
          {downloading ? t("progressReport.downloading") : t("progressReport.download")}
        </Button>
      </div>
    </div>
  );
}
