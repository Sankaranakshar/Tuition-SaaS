import React, { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
import {
  Plus, Search, Trash2, FileText, MessageSquare, Receipt, Download, Upload,
  CheckCircle, XCircle, Users, TrendingUp, UserCircle, GraduationCap, UserPlus, Copy, ShieldAlert,
} from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { PersonRow, EmptyState, SkeletonRow, Modal, Button, Input, Field, type ChipTone } from "../components/kit";
import { BulkImportModal } from "../components/BulkImportModal";
import {
  useStudentsList, useStudentInvoices, useStudentAttendance,
  useLeadsList, useParentsList, useTutorsList, type StudentRow,
} from "../hooks/usePeople";
import {
  rankStudentsByAttention, buildLeadFunnel, rankLeadsByGoingCold,
  LEAD_FUNNEL_STAGES, type AttentionReason,
} from "../lib/people";
import { uploadDocument, getDocumentUrl, deleteDocument, createParentInvite, createStudentInvite, eraseStudent } from "../lib/api";
import { canConfirmErase } from "../lib/erasure";
import { planLimitErrorMessage } from "../lib/subscription";
import { debounce } from "../lib/debounce";

type Lens = "students" | "leads" | "parents" | "tutors";
const LENSES: { key: Lens; labelKey: string; icon: typeof Users }[] = [
  { key: "students", labelKey: "people.lensStudents", icon: Users },
  { key: "leads", labelKey: "people.lensLeads", icon: TrendingUp },
  { key: "parents", labelKey: "people.lensParents", icon: UserCircle },
  { key: "tutors", labelKey: "people.lensTutors", icon: GraduationCap },
];

const LEAD_SOURCES = ["Website", "Referral", "Walk-in", "Social Media", "Other"];

// Matches kit Input's skin for the native <select>/<textarea> elements it
// doesn't provide a wrapper for (same recipe as Money.tsx's CreateInvoiceModal).
const SELECT_CLASS =
  "w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface)] px-3 py-1.5 text-[13px] text-[var(--cs-text)] outline-none transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] focus:border-[var(--cs-focus)] focus:ring-2 focus:ring-[var(--cs-focus)]/30";

function attentionChip(reason: AttentionReason): { label: string; tone: ChipTone } | undefined {
  switch (reason.kind) {
    case "overdue_fee":
      return { label: `${reason.days}d overdue`, tone: "danger" };
    case "absence_streak":
      return { label: `${reason.length} absences`, tone: "warn" };
    case "stale_contact":
      return { label: "Stale contact", tone: "neutral" };
    default:
      return undefined;
  }
}

export default function People() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const lens: Lens = (searchParams.get("lens") as Lens) || "students";
  const setLens = (l: Lens) => setSearchParams((prev) => { prev.set("lens", l); return prev; }, { replace: true });

  const [search, setSearch] = useState("");

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-[var(--cs-text)]">{t("nav.people")}</h1>
      </div>

      <div className="flex items-center gap-1 border-b border-[var(--cs-border)]">
        {LENSES.map(({ key, labelKey, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setLens(key)}
            className={`flex items-center gap-1.5 border-b-2 px-3 py-2 text-sm font-medium transition-colors ${
              lens === key
                ? "border-[var(--cs-accent)] text-[var(--cs-accent)]"
                : "border-transparent text-[var(--cs-text-muted)] hover:text-[var(--cs-text)]"
            }`}
          >
            <Icon className="h-4 w-4" />
            {t(labelKey)}
          </button>
        ))}
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--cs-text-muted)]" />
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("people.searchPlaceholder")}
          className="w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 pl-9 pr-3 text-sm focus:outline-none focus:ring-2 focus:ring-[var(--cs-accent)]"
        />
      </div>

      {lens === "students" && <StudentsLens search={search} user={user} navigate={navigate} t={t} />}
      {lens === "leads" && <LeadsLens search={search} user={user} navigate={navigate} t={t} />}
      {lens === "parents" && <ParentsLens search={search} navigate={navigate} t={t} />}
      {lens === "tutors" && <TutorsLens search={search} user={user} t={t} />}
    </div>
  );
}

// ---------------------------------------------------------------- Students

function StudentsLens({ search, user, navigate, t }: any) {
  const { data: students, loading, refetch } = useStudentsList();
  const { data: invoices } = useStudentInvoices();
  const { data: attendance } = useStudentAttendance();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [modalStudent, setModalStudent] = useState<StudentRow | "new" | null>(null);
  const [docsStudent, setDocsStudent] = useState<StudentRow | null>(null);
  const [inviteStudent, setInviteStudent] = useState<StudentRow | null>(null);
  const [toArchive, setToArchive] = useState<string | null>(null);
  const [toErase, setToErase] = useState<StudentRow | null>(null);
  const [bulkImportOpen, setBulkImportOpen] = useState(false);

  const canErase = user?.organizationRole === "owner" || user?.organizationRole === "admin";

  const ranked = useMemo(() => {
    const now = new Date();
    const filtered = students.filter(
      (s) =>
        s.name.toLowerCase().includes(search.toLowerCase()) ||
        (s.parentName || "").toLowerCase().includes(search.toLowerCase())
    );
    return rankStudentsByAttention(filtered, invoices, attendance, now);
  }, [students, invoices, attendance, search]);

  const toggleSelect = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const exportCsv = () => {
    const rows = students.filter((s) => selected.has(s.id));
    const header = ["Name", "Parent name", "Parent phone", "Grade", "Subject"];
    const lines = rows.map((s) =>
      [s.name, s.parentName || "", s.parentPhone || "", s.grade || "", s.subject || ""]
        .map((v) => `"${String(v).replace(/"/g, '""')}"`)
        .join(",")
    );
    const csv = [header.join(","), ...lines].join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "students.csv";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const archive = async () => {
    if (!toArchive) return;
    try {
      const { error } = await supabase
        .from("students")
        .update({ is_deleted: true, updated_at: new Date().toISOString() })
        .eq("id", toArchive);
      if (error) throw error;
      toast.success(t("people.archived"));
      setToArchive(null);
    } catch (err: any) {
      toast.error(t("people.archiveFailed"), { description: err.message });
    }
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        {selected.size > 0 ? (
          <div className="flex items-center gap-2 text-sm">
            <span className="text-[var(--cs-text-muted)]">{selected.size} selected</span>
            <Button variant="ghost" size="sm" icon={MessageSquare} onClick={() => navigate("/app/inbox")}>
              {t("people.bulkMessage")}
            </Button>
            {selected.size === 1 && (
              <Button
                variant="ghost"
                size="sm"
                icon={Receipt}
                onClick={() => navigate(`/app/money?new=1&studentId=${Array.from(selected)[0]}`)}
              >
                {t("people.bulkInvoice")}
              </Button>
            )}
            <Button variant="ghost" size="sm" icon={Download} onClick={exportCsv}>
              {t("people.bulkExport")}
            </Button>
          </div>
        ) : <span />}
        <div className="flex items-center gap-2">
          <Button variant="ghost" icon={Upload} onClick={() => setBulkImportOpen(true)}>
            {t("people.bulkImport")}
          </Button>
          <Button icon={Plus} onClick={() => setModalStudent("new")}>
            {t("people.addStudent")}
          </Button>
        </div>
      </div>

      <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        {loading ? (
          <div className="divide-y divide-[var(--cs-border)]">{Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : ranked.length === 0 ? (
          <EmptyState icon={Users} title={t("people.noStudents")} description={t("people.noStudentsHint")} action={{ label: t("people.addStudent"), onClick: () => setModalStudent("new") }} />
        ) : (
          <div className="divide-y divide-[var(--cs-border)]">
            {ranked.map(({ student, reason }) => (
              <div key={student.id} className="flex items-center gap-2 pl-3">
                <input
                  type="checkbox"
                  checked={selected.has(student.id)}
                  onChange={() => toggleSelect(student.id)}
                  className="h-4 w-4"
                  aria-label={`Select ${student.name}`}
                />
                <div className="min-w-0 flex-1">
                  <PersonRow
                    name={student.name}
                    subtitle={student.parentName ? `Parent: ${student.parentName}` : "No parent linked"}
                    status={attentionChip(reason)}
                    onClick={() => navigate(`/app/students/${student.id}`)}
                    actions={
                      <>
                        <button onClick={(e) => { e.stopPropagation(); setInviteStudent(student); }} title={t("people.invite")} className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-accent)]">
                          <UserPlus className="h-4 w-4" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setDocsStudent(student); }} title="Documents" className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-accent)]">
                          <FileText className="h-4 w-4" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); navigate(`/app/inbox?student=${student.id}`); }} title="Message" className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-accent)]">
                          <MessageSquare className="h-4 w-4" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); navigate(`/app/money?new=1&studentId=${student.id}`); }} title="Invoice" className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-accent)]">
                          <Receipt className="h-4 w-4" />
                        </button>
                        <button onClick={(e) => { e.stopPropagation(); setToArchive(student.id); }} title="Archive" className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-danger)]">
                          <Trash2 className="h-4 w-4" />
                        </button>
                        {canErase && (
                          <button onClick={(e) => { e.stopPropagation(); setToErase(student); }} title={t("people.eraseTitle")} className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-danger)]">
                            <ShieldAlert className="h-4 w-4" />
                          </button>
                        )}
                      </>
                    }
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {modalStudent && (
        <StudentModal
          student={modalStudent === "new" ? null : modalStudent}
          user={user}
          onClose={() => setModalStudent(null)}
          onSaved={() => { setModalStudent(null); refetch(); }}
        />
      )}
      {docsStudent && <DocumentsModal student={docsStudent} onClose={() => setDocsStudent(null)} />}
      {inviteStudent && <InviteModal student={inviteStudent} onClose={() => setInviteStudent(null)} />}
      {bulkImportOpen && <BulkImportModal onClose={() => setBulkImportOpen(false)} onImported={refetch} />}
      {toArchive && (
        <ConfirmModal
          title={t("people.archiveTitle")}
          body={t("people.archiveBody")}
          confirmLabel={t("people.archiveConfirm")}
          onConfirm={archive}
          onClose={() => setToArchive(null)}
        />
      )}
      {toErase && (
        <EraseStudentModal
          student={toErase}
          onClose={() => setToErase(null)}
          onErased={() => { setToErase(null); refetch(); }}
        />
      )}
    </div>
  );
}

// B-11 / EXECUTION_PLAN.md Step 10: per-student erasure (DPDP). Owner/admin
// only (gated by the caller), type-to-confirm the student's exact name —
// re-checked server-side. Mirrors OrgExportSettings' offboard confirm.
function EraseStudentModal({ student, onClose, onErased }: { student: StudentRow; onClose: () => void; onErased: () => void }) {
  const { t } = useTranslation();
  const [confirmText, setConfirmText] = useState("");
  const [erasing, setErasing] = useState(false);

  const handleErase = async () => {
    if (!canConfirmErase(student.name, confirmText)) return;
    setErasing(true);
    try {
      const res = await eraseStudent(student.id, confirmText.trim());
      const wo = res.walletWriteOff;
      toast.success(
        wo && (wo.credits || wo.paise)
          ? t("people.eraseDoneWriteoff", { credits: wo.credits, rupees: (wo.paise / 100).toLocaleString("en-IN") })
          : t("people.eraseDone")
      );
      onErased();
    } catch (err: any) {
      toast.error(err?.message || t("people.eraseFailed"));
      setErasing(false);
    }
  };

  return (
    <PeopleModal title={t("people.eraseTitle")} onClose={onClose}>
      <div className="space-y-3">
        <p className="text-sm text-[var(--cs-text-muted)]">{t("people.eraseBody")}</p>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--cs-text-muted)]">
          <li>{t("people.eraseBulletDeleted")}</li>
          <li>{t("people.eraseBulletKept")}</li>
        </ul>
        <div>
          <label className="mb-1.5 block text-xs font-medium text-[var(--cs-text-muted)]">
            {t("people.eraseConfirmLabel")}{" "}
            <span className="rounded bg-[var(--cs-surface-2)] px-1 font-mono text-[var(--cs-text)]">{student.name}</span>
          </label>
          <Input
            type="text"
            value={confirmText}
            onChange={(e) => setConfirmText(e.target.value)}
            placeholder={student.name}
          />
        </div>
        <div className="flex justify-end gap-3 pt-1">
          <Button variant="ghost" onClick={onClose}>{t("people.cancel")}</Button>
          <Button
            variant="danger"
            onClick={handleErase}
            disabled={erasing || !canConfirmErase(student.name, confirmText)}
          >
            {erasing ? t("people.erasing") : t("people.eraseConfirm")}
          </Button>
        </div>
      </div>
    </PeopleModal>
  );
}

function StudentModal({ student, user, onClose, onSaved }: any) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: student?.name || "",
    grade: student?.grade || "",
    subject: student?.subject || "",
    parentName: student?.parentName || "",
    parentPhone: student?.parentPhone || "",
    phone: student?.phone || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) { setError(t("people.nameRequired")); return; }
    setSaving(true);
    try {
      const payload: any = {
        name: form.name,
        grade: form.grade,
        subject: form.subject,
        parent_name: form.parentName,
        parent_phone: form.parentPhone,
        phone: form.phone,
        organization_id: user.organizationId,
      };
      if (student) {
        payload.updated_at = new Date().toISOString();
        const { error: err } = await supabase.from("students").update(payload).eq("id", student.id);
        if (err) throw err;
      } else {
        payload.tutor_id = user.id;
        payload.status = "active";
        const { error: err } = await supabase.from("students").insert(payload);
        if (err) throw err;
      }
      onSaved();
    } catch (err: any) {
      setError(planLimitErrorMessage(err.message) || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PeopleModal onClose={onClose} title={student ? t("people.editStudent") : t("people.addStudent")}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-[var(--cs-radius-control)] bg-[var(--cs-danger-soft)] p-2 text-sm text-[var(--cs-danger)]">{error}</div>}
        <Field label={t("people.studentName")} required>
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("people.grade")}>
            <Input value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} />
          </Field>
          <Field label={t("people.subject")}>
            <Input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </Field>
        </div>
        <Field label={t("people.studentPhone")}>
          <Input value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("people.parentName")}>
            <Input value={form.parentName} onChange={(e) => setForm({ ...form, parentName: e.target.value })} />
          </Field>
          <Field label={t("people.parentPhone")}>
            <Input value={form.parentPhone} onChange={(e) => setForm({ ...form, parentPhone: e.target.value })} />
          </Field>
        </div>
        <ModalActions saving={saving} onClose={onClose} saveLabel={student ? t("people.saveChanges") : t("people.addStudent")} />
      </form>
    </PeopleModal>
  );
}

function DocumentsModal({ student, onClose }: any) {
  const { t } = useTranslation();
  const [docs, setDocs] = useState<any[]>([]);
  const [file, setFile] = useState<File | null>(null);
  const [category, setCategory] = useState("homework");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState("");

  React.useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const { data } = await supabase.from("documents").select("*").eq("student_id", student.id).limit(50);
      if (!cancelled) setDocs(data || []);
    };
    load();
    const channel = supabase
      .channel(`people-documents-${student.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "documents", filter: `student_id=eq.${student.id}` }, debounce(load, 200))
      .subscribe();
    return () => { cancelled = true; supabase.removeChannel(channel); };
  }, [student.id]);

  const upload = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!file) return;
    try {
      await uploadDocument({ file, studentId: student.id, category, notes });
      setFile(null);
      setNotes("");
    } catch (err: any) {
      setError(err.message);
    }
  };

  const download = async (id: string) => {
    try {
      const { url } = await getDocumentUrl(id);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const remove = async (id: string) => {
    try {
      await deleteDocument(id);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <PeopleModal onClose={onClose} title={t("people.documentsFor", { name: student.name })} wide>
      <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="md:col-span-1">
          {error && <div className="mb-2 rounded-[var(--cs-radius-control)] bg-[var(--cs-danger-soft)] p-2 text-sm text-[var(--cs-danger)]">{error}</div>}
          <form onSubmit={upload} className="space-y-3">
            <input type="file" onChange={(e) => setFile(e.target.files?.[0] || null)} className="text-sm text-[var(--cs-text-muted)]" />
            <select value={category} onChange={(e) => setCategory(e.target.value)} className={SELECT_CLASS}>
              <option value="homework">Homework</option>
              <option value="test">Test/Quiz</option>
              <option value="report">Progress Report</option>
              <option value="other">Other</option>
            </select>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} placeholder="Notes" className={SELECT_CLASS} />
            <Button type="submit" disabled={!file} className="w-full">Upload</Button>
          </form>
        </div>
        <div className="md:col-span-2">
          {docs.length === 0 ? (
            <p className="py-8 text-center text-sm text-[var(--cs-text-muted)]">No documents.</p>
          ) : (
            <ul className="divide-y divide-[var(--cs-border)]">
              {docs.map((doc) => (
                <li key={doc.id} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium text-[var(--cs-text)]">{doc.file_name}</div>
                    <div className="text-xs text-[var(--cs-text-muted)]">{doc.category}</div>
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => download(doc.id)} className="p-1.5 text-[var(--cs-text-faint)] hover:text-[var(--cs-text)]"><Download className="h-4 w-4" /></button>
                    <button onClick={() => remove(doc.id)} className="p-1.5 text-[var(--cs-text-faint)] hover:text-[var(--cs-danger)]"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </PeopleModal>
  );
}

// Tech Debt #1 follow-up: createParentInvite/createStudentInvite (lib/api.ts)
// and the full redeem flow (Onboarding.tsx) already existed and were tested,
// but no page ever called the create side — staff had no way to actually
// generate a link. This modal is that missing piece.
function InviteLinkGenerator({ label, hint, onGenerate }: { label: string; hint: string; onGenerate: () => Promise<{ link: string; expiresAt: string }> }) {
  const { t } = useTranslation();
  const [link, setLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const generate = async () => {
    setLoading(true);
    try {
      const result = await onGenerate();
      setLink(result.link);
      setExpiresAt(result.expiresAt);
    } catch (err: any) {
      toast.error(t("people.inviteFailed"), { description: err.message });
    } finally {
      setLoading(false);
    }
  };

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    toast.success(t("people.inviteCopied"));
  };

  return (
    <div className="space-y-2 rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] p-3">
      <div className="text-sm font-medium text-[var(--cs-text)]">{label}</div>
      <p className="text-xs text-[var(--cs-text-muted)]">{hint}</p>
      {link ? (
        <div className="space-y-1">
          <div className="flex gap-2">
            <input readOnly value={link} className="w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] bg-[var(--cs-surface-2)] px-2 py-1.5 text-xs text-[var(--cs-text-muted)]" />
            <button onClick={copy} title={t("people.inviteCopy")} className="shrink-0 rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] px-2 py-1.5 text-[var(--cs-text-muted)] hover:bg-[var(--cs-surface-2)]">
              <Copy className="h-3.5 w-3.5" />
            </button>
          </div>
          {expiresAt && <p className="text-xs text-[var(--cs-text-faint)]">{t("people.inviteExpires", { date: new Date(expiresAt).toLocaleDateString() })}</p>}
        </div>
      ) : (
        <Button size="sm" onClick={generate} disabled={loading}>
          {loading ? t("people.inviteGenerating") : t("people.inviteGenerate")}
        </Button>
      )}
    </div>
  );
}

function InviteModal({ student, onClose }: { student: StudentRow; onClose: () => void }) {
  const { t } = useTranslation();
  const origin = window.location.origin;

  return (
    <PeopleModal onClose={onClose} title={t("people.inviteTitle", { name: student.name })}>
      <div className="space-y-4">
        <InviteLinkGenerator
          label={t("people.inviteParentSection")}
          hint={t("people.inviteParentHint")}
          onGenerate={async () => {
            const result = await createParentInvite(student.id);
            return { link: `${origin}/onboarding?invite=${result.token}`, expiresAt: result.expiresAt };
          }}
        />
        <InviteLinkGenerator
          label={t("people.inviteStudentSection")}
          hint={t("people.inviteStudentHint")}
          onGenerate={async () => {
            const result = await createStudentInvite(student.id);
            return { link: `${origin}/onboarding?studentInvite=${result.token}`, expiresAt: result.expiresAt };
          }}
        />
      </div>
    </PeopleModal>
  );
}

// -------------------------------------------------------------------- Leads

function LeadsLens({ search, user, navigate, t }: any) {
  const { data: leads, loading, refetch } = useLeadsList();
  const [stageFilter, setStageFilter] = useState<string | null>(null);
  const [modalLead, setModalLead] = useState<any | "new" | null>(null);

  const funnel = useMemo(() => buildLeadFunnel(leads), [leads]);
  const ranked = useMemo(() => {
    let filtered = leads.filter((l) => l.name.toLowerCase().includes(search.toLowerCase()));
    if (stageFilter) filtered = filtered.filter((l) => l.status === stageFilter);
    return rankLeadsByGoingCold(filtered, new Date());
  }, [leads, search, stageFilter]);

  const convertToStudent = async (lead: any) => {
    try {
      const { error } = await supabase.from("students").insert({
        organization_id: user.organizationId,
        name: lead.name,
        notes: (lead as any).notes || null,
        tutor_id: user.role === "tutor" ? user.id : null,
        status: "active",
      });
      if (error) throw error;
      await supabase.from("leads").update({ status: "Enrolled", updated_at: new Date().toISOString() }).eq("id", lead.id);
      toast.success(t("people.converted"));
      navigate("/app/people?lens=students");
    } catch (err: any) {
      toast.error(t("people.convertFailed"), { description: planLimitErrorMessage(err.message) || err.message });
    }
  };

  const remove = async (id: string) => {
    const lead = leads.find((l) => l.id === id);
    try {
      const { error } = await supabase.from("leads").delete().eq("id", id);
      if (error) throw error;
      toast.success(t("people.leadDeleted"), {
        action: lead ? { label: t("people.undo"), onClick: async () => {
          await supabase.from("leads").insert({ id: lead.id, name: lead.name, status: lead.status, source: lead.source, organization_id: user.organizationId });
        } } : undefined,
      });
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          {funnel.map(({ stage, count }, i) => (
            <React.Fragment key={stage}>
              <button
                onClick={() => setStageFilter(stageFilter === stage ? null : stage)}
                className={`rounded-[var(--cs-radius-control)] border px-3 py-1.5 text-sm ${
                  stageFilter === stage ? "border-[var(--cs-accent)] bg-[var(--cs-accent-soft)] text-[var(--cs-accent)]" : "border-[var(--cs-border)]"
                }`}
              >
                {stage} <span className="font-semibold">{count}</span>
              </button>
              {i < funnel.length - 1 && <span className="text-[var(--cs-text-muted)]">→</span>}
            </React.Fragment>
          ))}
        </div>
        <Button icon={Plus} onClick={() => setModalLead("new")}>{t("people.addLead")}</Button>
      </div>

      <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        {loading ? (
          <div className="divide-y divide-[var(--cs-border)]">{Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}</div>
        ) : ranked.length === 0 ? (
          <EmptyState icon={TrendingUp} title={t("people.noLeads")} action={{ label: t("people.addLead"), onClick: () => setModalLead("new") }} />
        ) : (
          <div className="divide-y divide-[var(--cs-border)]">
            {ranked.map(({ lead, daysSinceTouch, isGoingCold }) => (
              <PersonRow
                key={lead.id}
                name={lead.name}
                subtitle={`${lead.source || "Unknown source"} · last touch ${daysSinceTouch}d ago`}
                status={{ label: isGoingCold ? t("people.goingCold") : lead.status, tone: isGoingCold ? "danger" : "accent" }}
                onClick={() => setModalLead(lead)}
                actions={
                  <>
                    <button onClick={(e) => { e.stopPropagation(); convertToStudent(lead); }} title={t("people.convert")} className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-accent)]">
                      <CheckCircle className="h-4 w-4" />
                    </button>
                    <button onClick={(e) => { e.stopPropagation(); remove(lead.id); }} title="Delete" className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-danger)]">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </>
                }
              />
            ))}
          </div>
        )}
      </div>

      {modalLead && (
        <LeadModal lead={modalLead === "new" ? null : modalLead} user={user} onClose={() => setModalLead(null)} onSaved={() => { setModalLead(null); refetch(); }} />
      )}
    </div>
  );
}

function LeadModal({ lead, user, onClose, onSaved }: any) {
  const { t } = useTranslation();
  const [form, setForm] = useState({
    name: lead?.name || "",
    source: lead?.source || LEAD_SOURCES[0],
    status: lead?.status || LEAD_FUNNEL_STAGES[0],
    notes: lead?.notes || "",
  });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) { setError(t("people.nameRequired")); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name,
        source: form.source,
        status: form.status,
        notes: form.notes,
        organization_id: user.organizationId,
        updated_at: new Date().toISOString(),
      };
      if (lead) {
        const { error: err } = await supabase.from("leads").update(payload).eq("id", lead.id);
        if (err) throw err;
      } else {
        const { error: err } = await supabase.from("leads").insert(payload);
        if (err) throw err;
      }
      onSaved();
    } catch (err: any) {
      setError(planLimitErrorMessage(err.message) || err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <PeopleModal onClose={onClose} title={lead ? t("people.editLead") : t("people.addLead")}>
      <form onSubmit={submit} className="space-y-4">
        {error && <div className="rounded-[var(--cs-radius-control)] bg-[var(--cs-danger-soft)] p-2 text-sm text-[var(--cs-danger)]">{error}</div>}
        <Field label={t("people.studentName")} required>
          <Input required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </Field>
        <div className="grid grid-cols-2 gap-4">
          <Field label={t("people.source")}>
            <select value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} className={SELECT_CLASS}>
              {LEAD_SOURCES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label={t("people.stage")}>
            <select value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })} className={SELECT_CLASS}>
              {[...LEAD_FUNNEL_STAGES, "Lost"].map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <Field label={t("people.notes")}>
          <textarea value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} rows={3} className={SELECT_CLASS} />
        </Field>
        <ModalActions saving={saving} onClose={onClose} saveLabel={lead ? t("people.saveChanges") : t("people.addLead")} />
      </form>
    </PeopleModal>
  );
}

// ------------------------------------------------------------------ Parents

function ParentsLens({ search, navigate, t }: any) {
  const { data: parents, loading } = useParentsList();
  const filtered = parents.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
      {loading ? (
        <div className="divide-y divide-[var(--cs-border)]">{Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={UserCircle}
          title={t("people.noParents")}
          description={t("people.noParentsHint")}
        />
      ) : (
        <div className="divide-y divide-[var(--cs-border)]">
          {filtered.map((parent) => (
            <PersonRow
              key={parent.parentUserId}
              name={parent.name}
              subtitle={parent.studentNames.length > 0 ? `Parent of ${parent.studentNames.join(", ")}` : "No linked student"}
              actions={
                <button onClick={() => navigate(`/app/inbox?participant=${parent.parentUserId}`)} title="Message" className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-accent)]">
                  <MessageSquare className="h-4 w-4" />
                </button>
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------------- Tutors

function TutorsLens({ search, user, t }: any) {
  const { data: tutors, loading, refetch } = useTutorsList();
  const filtered = tutors.filter((tu) => tu.fullName.toLowerCase().includes(search.toLowerCase()));
  // Verification is admin-only (matches the old Admin.tsx gate); the
  // directory itself is visible to any staff role per REDESIGN §6.2.
  const canVerify = user?.organizationRole === "owner" || user?.organizationRole === "admin";

  const setVerified = async (userId: string, isVerified: boolean) => {
    try {
      // organization_id is required here now that tutor_profiles is keyed
      // per (user_id, organization_id) (EXECUTION_PLAN.md Step 15) — without
      // it, verifying a tutor who also teaches at a second org would flip
      // is_verified for every org they belong to, not just this one.
      const { error } = await supabase
        .from("tutor_profiles")
        .update({ is_verified: isVerified })
        .eq("user_id", userId)
        .eq("organization_id", user?.organizationId);
      if (error) throw error;
      refetch();
    } catch (err: any) {
      toast.error(t("people.verifyFailed"), { description: err.message });
    }
  };

  return (
    <div className="rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
      {loading ? (
        <div className="divide-y divide-[var(--cs-border)]">{Array.from({ length: 4 }).map((_, i) => <SkeletonRow key={i} />)}</div>
      ) : filtered.length === 0 ? (
        <EmptyState icon={GraduationCap} title={t("people.noTutors")} />
      ) : (
        <div className="divide-y divide-[var(--cs-border)]">
          {filtered.map((tutor) => (
            <PersonRow
              key={tutor.userId}
              name={tutor.fullName}
              subtitle={[tutor.subjects.join(", "), tutor.grades.join(", ")].filter(Boolean).join(" · ") || tutor.location || ""}
              status={{ label: tutor.isVerified ? t("people.verified") : t("people.unverified"), tone: tutor.isVerified ? "positive" : "warn" }}
              actions={
                canVerify ? (
                  tutor.isVerified ? (
                    <button onClick={() => setVerified(tutor.userId, false)} title="Revoke" className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-danger)]">
                      <XCircle className="h-4 w-4" />
                    </button>
                  ) : (
                    <button onClick={() => setVerified(tutor.userId, true)} title="Verify" className="p-1.5 text-[var(--cs-text-muted)] hover:text-[var(--cs-accent)]">
                      <CheckCircle className="h-4 w-4" />
                    </button>
                  )
                ) : undefined
              }
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ------------------------------------------------------------- Shared bits

// Kit-Modal wrapper shared by every dialog in this file (recipe from
// Money.tsx step 5: keep this file's own backdrop, swap the panel div for
// kit Modal — adds role="dialog"/aria-modal/focus-trap for free).
function PeopleModal({ title, children, onClose, wide }: { title: string; children: React.ReactNode; onClose: () => void; wide?: boolean }) {
  return (
    <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <Modal
        onClose={onClose}
        label={title}
        className={`max-h-[85vh] w-full overflow-y-auto rounded-[var(--cs-radius-container)] bg-[var(--cs-surface)] p-6 shadow-[var(--cs-shadow-pop)] outline-none ${wide ? "max-w-3xl" : "max-w-lg"}`}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-[var(--cs-text)]">{title}</h2>
          <button onClick={onClose} className="text-[var(--cs-text-faint)] hover:text-[var(--cs-text-muted)]">&times;</button>
        </div>
        {children}
      </Modal>
    </div>
  );
}

function ModalActions({ saving, onClose, saveLabel }: { saving: boolean; onClose: () => void; saveLabel: string }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-end gap-3 border-t border-[var(--cs-border)] pt-4">
      <Button type="button" variant="ghost" onClick={onClose}>{t("people.cancel")}</Button>
      <Button type="submit" disabled={saving}>{saving ? t("people.saving") : saveLabel}</Button>
    </div>
  );
}

function ConfirmModal({ title, body, confirmLabel, onConfirm, onClose }: any) {
  const { t } = useTranslation();
  return (
    <PeopleModal title={title} onClose={onClose}>
      <p className="mb-4 text-sm text-[var(--cs-text-muted)]">{body}</p>
      <div className="flex justify-end gap-3">
        <Button variant="ghost" onClick={onClose}>{t("people.cancel")}</Button>
        <Button variant="danger" onClick={onConfirm}>{confirmLabel}</Button>
      </div>
    </PeopleModal>
  );
}
