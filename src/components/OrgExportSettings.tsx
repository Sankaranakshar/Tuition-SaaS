import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Download, FileJson, FileSpreadsheet, AlertTriangle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../supabase";
import { downloadOrgExportJson, downloadOrgExportXlsx, offboardOrganization } from "../lib/api";
import { canConfirmOffboard } from "../lib/orgExport";

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
      <div className="bg-[var(--cs-surface)] rounded-[10px] shadow-sm border border-[var(--cs-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--cs-border)]">
          <h2 className="text-lg font-semibold text-[var(--cs-text)]">Data Export</h2>
          <p className="mt-1 text-sm text-[var(--cs-text-muted)]">
            Download every record this organization owns — students, courses, sessions, attendance, invoices, payments, and more.
          </p>
        </div>
        <div className="p-6 flex flex-col sm:flex-row gap-3">
          <button
            onClick={() => handleExport("json")}
            disabled={exporting !== null}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-[var(--cs-border)] shadow-sm text-sm font-medium rounded-[6px] text-[var(--cs-text)] bg-[var(--cs-surface)] hover:bg-[var(--cs-bg)] disabled:opacity-50"
          >
            <FileJson className="w-4 h-4" />
            {exporting === "json" ? "Preparing…" : "Export as JSON"}
          </button>
          <button
            onClick={() => handleExport("xlsx")}
            disabled={exporting !== null}
            className="inline-flex items-center justify-center gap-2 px-4 py-2 border border-[var(--cs-border)] shadow-sm text-sm font-medium rounded-[6px] text-[var(--cs-text)] bg-[var(--cs-surface)] hover:bg-[var(--cs-bg)] disabled:opacity-50"
          >
            <FileSpreadsheet className="w-4 h-4" />
            {exporting === "xlsx" ? "Preparing…" : "Export as Excel"}
          </button>
          <Download className="w-4 h-4 text-[var(--cs-text-muted)] self-center ml-auto hidden sm:block" />
        </div>
      </div>

      <div className="bg-[var(--cs-surface)] rounded-[10px] shadow-sm border border-red-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-red-100 bg-red-50">
          <h2 className="text-lg font-semibold text-[var(--cs-danger)] flex items-center gap-2">
            <AlertTriangle className="w-5 h-5" />
            Offboard this organization
          </h2>
          <p className="mt-1 text-sm text-[var(--cs-danger)]">
            This closes the account and blocks all further access for every member. Financial records (invoices, payments) are
            retained per legal requirements and are never deleted. Only the organization's owner can do this.
          </p>
        </div>
        <div className="p-6">
          {offboarded ? (
            <p className="text-sm text-[var(--cs-text-muted)]">This organization has been offboarded.</p>
          ) : (
            <div className="max-w-md space-y-3">
              <label className="block text-sm font-medium text-[var(--cs-text-muted)]">
                Type <span className="font-mono bg-[var(--cs-bg)] px-1 rounded">{orgName ?? "…"}</span> to confirm
              </label>
              <input
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                disabled={!orgName}
                className="block w-full border border-[var(--cs-border)] rounded-[6px] shadow-sm py-2 px-3 text-sm bg-[var(--cs-surface)] disabled:bg-[var(--cs-bg)]"
                placeholder={orgName ?? ""}
              />
              <button
                onClick={handleOffboard}
                disabled={offboarding || !orgName || !canConfirmOffboard(orgName, confirmText)}
                className="inline-flex items-center justify-center px-4 py-2 border border-transparent text-sm font-medium rounded-[6px] text-white bg-[var(--cs-danger)] hover:opacity-90 disabled:opacity-50 disabled:bg-[var(--cs-border)]"
              >
                {offboarding ? "Offboarding…" : "Offboard organization"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
