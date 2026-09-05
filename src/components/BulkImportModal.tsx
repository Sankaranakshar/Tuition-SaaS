import { useState } from "react";
import { useTranslation } from "react-i18next";
import { X, Upload } from "lucide-react";
import { Modal } from "./kit";
import {
  inspectStudentImport, runStudentImport,
} from "../lib/api";
import type {
  ImportField, BulkImportPreviewResponse, BulkImportCommitResponse, BulkImportResolutions,
} from "../../shared/schemas/students";

// B-09 bulk import (EXECUTION_PLAN.md Step 6). Upload -> column mapping ->
// dry-run preview (with per-duplicate resolution) -> commit, mirroring
// BookingRequestsPanel's convention of a standalone component file rendered
// from a page-level modal state, not inlined into People.tsx alongside its
// existing per-student modals.
//
// Dedup rule, decided directly during this step since no real spec for it
// exists anywhere (see server/utils/bulkImport.ts's header for the full
// story): a row is a duplicate only when BOTH name and phone match, and
// every flagged duplicate needs an explicit Skip/Import choice — none are
// auto-imported, none are auto-skipped.

type Step = "upload" | "mapping" | "preview" | "done";

const FIELD_OPTIONS: { value: ImportField | ""; labelKey: string }[] = [
  { value: "", labelKey: "people.bulkImportFieldIgnore" },
  { value: "name", labelKey: "people.bulkImportFieldName" },
  { value: "phone", labelKey: "people.bulkImportFieldPhone" },
  { value: "parentName", labelKey: "people.bulkImportFieldParentName" },
  { value: "parentPhone", labelKey: "people.bulkImportFieldParentPhone" },
  { value: "grade", labelKey: "people.bulkImportFieldGrade" },
  { value: "subject", labelKey: "people.bulkImportFieldSubject" },
];

export function BulkImportModal({ onClose, onImported }: { onClose: () => void; onImported: () => void }) {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>("upload");
  const [file, setFile] = useState<File | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<(ImportField | null)[]>([]);
  const [preview, setPreview] = useState<BulkImportPreviewResponse | null>(null);
  const [resolutions, setResolutions] = useState<BulkImportResolutions>({});
  const [result, setResult] = useState<BulkImportCommitResponse | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const close = () => onClose();

  const chooseFile = async (f: File | null) => {
    if (!f) return;
    setError("");
    setFile(f);
    setBusy(true);
    try {
      const res = await inspectStudentImport(f);
      setHeaders(res.headers);
      setMapping(res.suggestedMapping);
      setStep("mapping");
    } catch (err: any) {
      setError(err.message || t("people.bulkImportFailed"));
    } finally {
      setBusy(false);
    }
  };

  const runPreview = async () => {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const res = (await runStudentImport({ file, mapping, commit: false })) as BulkImportPreviewResponse;
      setPreview(res);
      setResolutions({});
      setStep("preview");
    } catch (err: any) {
      setError(err.message || t("people.bulkImportFailed"));
    } finally {
      setBusy(false);
    }
  };

  const resolve = (rowIndex: number, action: "skip" | "import") => {
    setResolutions((prev) => ({ ...prev, [String(rowIndex)]: action }));
  };

  const allDuplicatesResolved = preview ? preview.duplicates.every((d) => !!resolutions[String(d.rowIndex)]) : true;

  const commit = async () => {
    if (!file) return;
    setError("");
    setBusy(true);
    try {
      const res = (await runStudentImport({ file, mapping, commit: true, resolutions })) as BulkImportCommitResponse;
      setResult(res);
      setStep("done");
    } catch (err: any) {
      setError(err.message || t("people.bulkImportFailed"));
    } finally {
      setBusy(false);
    }
  };

  const finish = () => {
    onImported();
    onClose();
  };

  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4" onClick={close}>
      <Modal onClose={close} labelledBy="bulk-import-title" className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 id="bulk-import-title" className="text-lg font-semibold text-gray-900">{t("people.bulkImportTitle")}</h2>
          <button onClick={close} className="text-gray-400 hover:text-gray-600"><X className="h-5 w-5" /></button>
        </div>

        {error && <div className="mb-4 rounded-md bg-red-50 p-2 text-sm text-red-700">{error}</div>}

        {step === "upload" && (
          <div className="flex flex-col items-center gap-3 rounded-lg border-2 border-dashed border-gray-300 px-6 py-10 text-center">
            <Upload className="h-8 w-8 text-gray-400" />
            <p className="text-sm text-gray-600">{t("people.bulkImportStepUpload")}</p>
            <label className="cursor-pointer rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
              {busy ? t("people.bulkImportInspecting") : t("people.bulkImportChooseFile")}
              <input
                type="file"
                accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                className="hidden"
                disabled={busy}
                onChange={(e) => chooseFile(e.target.files?.[0] || null)}
              />
            </label>
          </div>
        )}

        {step === "mapping" && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600">{t("people.bulkImportStepMapping")}</p>
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {headers.map((header, i) => (
                <div key={i} className="grid grid-cols-2 items-center gap-3 rounded-md border border-gray-200 p-2">
                  <div>
                    <div className="text-xs text-gray-400">{t("people.bulkImportColumn")}</div>
                    <div className="truncate text-sm font-medium text-gray-900">{header || `(${i + 1})`}</div>
                  </div>
                  <select
                    value={mapping[i] || ""}
                    onChange={(e) => {
                      const value = (e.target.value || null) as ImportField | null;
                      setMapping((prev) => prev.map((v, idx) => (idx === i ? value : v)));
                    }}
                    className="rounded-md border border-gray-300 px-2 py-1.5 text-sm"
                  >
                    {FIELD_OPTIONS.map((opt) => (
                      <option key={opt.value} value={opt.value}>{t(opt.labelKey)}</option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
            <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
              <button onClick={() => setStep("upload")} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                {t("people.bulkImportBack")}
              </button>
              <button
                onClick={runPreview}
                disabled={busy || !mapping.includes("name")}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy ? t("people.bulkImportPreviewing") : t("people.bulkImportPreview")}
              </button>
            </div>
          </div>
        )}

        {step === "preview" && preview && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-gray-900">
              {t("people.bulkImportSummary", { toCreate: preview.toCreate.length, duplicates: preview.duplicates.length, errors: preview.errors.length })}
            </p>

            {preview.errors.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-gray-500">{t("people.bulkImportErrorsTitle")}</div>
                <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md bg-red-50 p-2 text-xs text-red-700">
                  {preview.errors.map((e) => <li key={e.rowIndex}>{t("people.bulkImportRow", { row: e.rowIndex })}: {e.message}</li>)}
                </ul>
              </div>
            )}

            {preview.duplicates.length > 0 && (
              <div>
                <div className="mb-1 text-xs font-semibold uppercase text-gray-500">{t("people.bulkImportDuplicatesTitle")}</div>
                <div className="max-h-56 space-y-2 overflow-y-auto">
                  {preview.duplicates.map((d) => {
                    const chosen = resolutions[String(d.rowIndex)];
                    return (
                      <div key={d.rowIndex} className="flex items-center justify-between gap-3 rounded-md border border-amber-200 bg-amber-50 p-2">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-gray-900">{t("people.bulkImportRow", { row: d.rowIndex })}: {d.name}</div>
                          <div className="truncate text-xs text-gray-600">
                            {d.matchedStudentId
                              ? t("people.bulkImportDuplicateExisting", { name: d.matchedStudentName })
                              : t("people.bulkImportDuplicateInFile", { row: d.matchedRowIndex })}
                          </div>
                        </div>
                        <div className="flex shrink-0 gap-1">
                          <button
                            onClick={() => resolve(d.rowIndex, "skip")}
                            className={`rounded border px-2 py-1 text-xs font-medium ${chosen === "skip" ? "border-gray-700 bg-gray-700 text-white" : "border-gray-300 text-gray-700 hover:bg-gray-100"}`}
                          >
                            {t("people.bulkImportResolveSkip")}
                          </button>
                          <button
                            onClick={() => resolve(d.rowIndex, "import")}
                            className={`rounded border px-2 py-1 text-xs font-medium ${chosen === "import" ? "border-indigo-600 bg-indigo-600 text-white" : "border-gray-300 text-gray-700 hover:bg-gray-100"}`}
                          >
                            {t("people.bulkImportResolveImport")}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {!allDuplicatesResolved && <p className="mt-1 text-xs text-amber-700">{t("people.bulkImportUnresolvedWarning")}</p>}
              </div>
            )}

            <div className="flex justify-end gap-3 border-t border-gray-200 pt-4">
              <button onClick={() => setStep("mapping")} className="rounded-md border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
                {t("people.bulkImportBack")}
              </button>
              <button
                onClick={commit}
                disabled={busy || !allDuplicatesResolved}
                className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
              >
                {busy
                  ? t("people.bulkImportCommitting")
                  : t("people.bulkImportCommit", { count: preview.toCreate.length + Object.values(resolutions).filter((r) => r === "import").length })}
              </button>
            </div>
          </div>
        )}

        {step === "done" && result && (
          <div className="space-y-4">
            <p className="text-sm font-medium text-gray-900">{t("people.bulkImportDone")}</p>
            <p className="text-sm text-gray-600">
              {t("people.bulkImportDoneSummary", { created: result.createdCount, skipped: result.skippedDuplicates.length, errors: result.errors.length })}
            </p>
            {result.errors.length > 0 && (
              <ul className="max-h-32 space-y-1 overflow-y-auto rounded-md bg-red-50 p-2 text-xs text-red-700">
                {result.errors.map((e) => <li key={e.rowIndex}>{t("people.bulkImportRow", { row: e.rowIndex })}: {e.message}</li>)}
              </ul>
            )}
            <div className="flex justify-end border-t border-gray-200 pt-4">
              <button onClick={finish} className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700">
                {t("people.bulkImportClose")}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
}
