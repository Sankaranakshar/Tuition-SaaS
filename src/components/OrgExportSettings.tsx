import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Download, FileJson, FileSpreadsheet, AlertTriangle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../supabase";
import { downloadOrgExportJson, downloadOrgExportXlsx, offboardOrganization } from "../lib/api";
import { canConfirmOffboard } from "../lib/orgExport";
import { Button } from "./kit";

// Stage 3: org export/offboarding (DEV_PLAN §5, old E16.3). Export is
// available to any admin/tutor role_type user, matching Plan & Billing's
// tab-visibility tier (src/pages/Settings.tsx) — the real boundary is the
// server's requireRole("owner", "admin") on GET /org-export/json|xlsx.
// Offboarding is gated to owner only server-side (requireRole("owner"));
// the client still shows the section to admin/tutor so the error message on
// a 403 is informative rather than the section simply not existing — same
// posture §28 documents for the platform-admin console ("the client check
// is not the security boundary").
export default function OrgExportSettings() {
  const { user } = useAuth();
  const [orgName, setOrgName] = useState<string | null>(null);
  const [exporting, setExporting] = useState<"json" | "xlsx" | null>(null);
  const [confirmText, setConfirmText] = useState("");
  const [offboarding, setOffboarding] = useState(false);
  const [offboarded, setOffboarded] = useState(false);

  useEffect(() => {
    if (!user?.organizationId) return;
    supabase
      .from("organizations")
      .select("name")
      .eq("id", user.organizationId)
      .maybeSingle()
      .then(({ data }) => setOrgName(data?.name ?? null));
  }, [user?.organizationId]);

  const handleExport = async (format: "json" | "xlsx") => {
    setExporting(format);
    try {
      if (format === "json") await downloadOrgExportJson();
      else await downloadOrgExportXlsx();
      toast.success(`Export ready — check your downloads.`);
    } catch (err: any) {
      toast.error(err?.message || "Couldn't generate the export");
    } finally {
      setExporting(null);
    }
  };

  const handleOffboard = async () => {
    if (!orgName || !canConfirmOffboard(orgName, confirmText)) return;
    setOffboarding(true);
    try {
      await offboardOrganization(confirmText.trim());
      setOffboarded(true);
      toast.success("Organization offboarded.");
    } catch (err: any) {
      toast.error(err?.message || "Couldn't offboard this organization");
    } finally {
      setOffboarding(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <div className="border-b border-[var(--cs-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--cs-text)]">Data export</h2>
          <p className="mt-1 text-xs text-[var(--cs-text-muted)]">
            Download every record this organization owns — students, courses, sessions, attendance, invoices, payments, and more.
          </p>
        </div>
        <div className="flex flex-col gap-3 p-4 sm:flex-row">
          <Button variant="ghost" onClick={() => handleExport("json")} disabled={exporting !== null} icon={FileJson}>
            {exporting === "json" ? "Preparing…" : "Export as JSON"}
          </Button>
          <Button variant="ghost" onClick={() => handleExport("xlsx")} disabled={exporting !== null} icon={FileSpreadsheet}>
            {exporting === "xlsx" ? "Preparing…" : "Export as Excel"}
          </Button>
          <Download className="ml-auto hidden h-4 w-4 self-center text-[var(--cs-text-muted)] sm:block" strokeWidth={1.75} />
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <div className="border-b border-[var(--cs-border)] bg-[var(--cs-danger-soft)] px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--cs-danger)]">
            <AlertTriangle className="h-5 w-5" strokeWidth={1.75} />
            Offboard this organization
          </h2>
          <p className="mt-1 text-xs text-[var(--cs-danger)]">
            This closes the account and blocks all further access for every member. Financial records (invoices, payments) are
            retained per legal requirements and are never deleted. Only the organization's owner can do this.
          </p>
        </div>
        <div className="p-4">
          {offboarded ? (
            <p className="text-sm text-[var(--cs-text-muted)]">This organization has been offboarded.</p>
          ) : (
            <div className="max-w-md space-y-3">
              <label className="block text-sm font-medium text-[var(--cs-text-muted)]">
                Type <span className="rounded bg-[var(--cs-surface-2)] px-1 font-mono">{orgName ?? "…"}</span> to confirm
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                disabled={!orgName}
                className="block w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface)] px-3 py-1.5 text-[13px] text-[var(--cs-text)] outline-none transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] focus:border-[var(--cs-focus)] focus:ring-2 focus:ring-[var(--cs-focus)]/30 disabled:bg-[var(--cs-surface-2)] disabled:opacity-50"
                placeholder={orgName ?? ""}
              />
              <Button
                variant="danger"
                onClick={handleOffboard}
                disabled={offboarding || !orgName || !canConfirmOffboard(orgName, confirmText)}
              >
                {offboarding ? "Offboarding…" : "Offboard organization"}
              </Button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
