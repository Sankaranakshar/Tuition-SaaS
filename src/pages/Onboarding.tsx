import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { useAuth } from "../context/AuthContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import { Users, Building2, UserRound, Upload } from "lucide-react";
import { previewParentInvite, redeemParentInvite, previewStudentInvite, redeemStudentInvite, bootstrapOrganization, api } from "../lib/api";
import { ClassManager } from "../services/ClassManager";
import type { MaterializeResponse } from "../../shared/schemas/scheduling";
import {
  defaultOrgName,
  TEMPLATE_GALLERY,
  buildClassTemplatePayload,
  validateManualStudentRow,
  parseStudentsCsvRows,
  type OrgMode,
  type CsvStudentRow,
} from "../lib/onboarding";
import { planLimitErrorMessage } from "../lib/subscription";

// Epic 14.5 (DEV_PLAN §2a Stage 2 item 5, REDESIGN §6.7): the tutor-signup
// form sequence below is a from-scratch three-beat conversational flow
// (solo/center → first class from a template gallery → add students). The
// parent/student invite-redeem sections (renderParentSteps/renderStudentSteps
// and everything they depend on) are UNCHANGED from before this rebuild —
// they're current product (Tech Debt #16/HANDOFF §18.1), not legacy.
export default function Onboarding() {
  const { t } = useTranslation();
  const { user, checkAuth } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Parent State: linking to a child happens via a staff-issued invite token
  // (E10.1), not a self-declared profile — parent_links has no client write
  // path, so this is the only way a parent account gains access to a child.
  const [searchParams] = useSearchParams();
  const [inviteToken, setInviteToken] = useState(
    searchParams.get("invite") || sessionStorage.getItem("pendingParentInvite") || ""
  );
  const [invitePreview, setInvitePreview] = useState<{ studentName: string | null; organizationName: string | null } | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [consent, setConsent] = useState(false);

  // Student State: joining an org happens via a staff-issued invite token tied
  // to an existing `students` roster row (Tech Debt #16 / DEV_PLAN.md), the
  // same pattern as the parent flow above — a student has no client write
  // path to claim a roster row on their own.
  const [studentInviteToken, setStudentInviteToken] = useState(
    searchParams.get("studentInvite") || sessionStorage.getItem("pendingStudentInvite") || ""
  );
  const [studentInvitePreview, setStudentInvitePreview] = useState<{ studentName: string | null; organizationName: string | null } | null>(null);
  const [studentPreviewLoading, setStudentPreviewLoading] = useState(false);

  // Which of the three flows to show. A parent/student invite token means we
  // already know the visitor's role — no generic "pick your role" screen
  // needed (the old 3-card picker asked this even of invite-token holders).
  // Everyone else is on the only other real self-serve path: becoming a tutor.
  const flow: "parent" | "student" | "tutor" = inviteToken ? "parent" : studentInviteToken ? "student" : "tutor";

  useEffect(() => {
    if (user?.profile_status === "complete") {
      navigate("/app");
    }
  }, [user, navigate]);

  const handlePreviewInvite = async () => {
    const token = inviteToken.trim();
    if (!token) return;
    setPreviewLoading(true);
    setError("");
    setInvitePreview(null);
    try {
      const result = await previewParentInvite(token);
      setInvitePreview({ studentName: result.studentName, organizationName: result.organizationName });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite not found or expired.");
    } finally {
      setPreviewLoading(false);
    }
  };

  // A link opened with ?invite=TOKEN previews itself immediately — no role
  // click needed first now that the flow is determined by token presence.
  useEffect(() => {
    if (flow === "parent" && inviteToken && !invitePreview && !previewLoading) {
      handlePreviewInvite();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  const handlePreviewStudentInvite = async () => {
    const token = studentInviteToken.trim();
    if (!token) return;
    setStudentPreviewLoading(true);
    setError("");
    setStudentInvitePreview(null);
    try {
      const result = await previewStudentInvite(token);
      setStudentInvitePreview({ studentName: result.studentName, organizationName: result.organizationName });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Invite not found or expired.");
    } finally {
      setStudentPreviewLoading(false);
    }
  };

  // A link opened with ?studentInvite=TOKEN previews itself immediately, same as above.
  useEffect(() => {
    if (flow === "student" && studentInviteToken && !studentInvitePreview && !studentPreviewLoading) {
      handlePreviewStudentInvite();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [flow]);

  const handleCompleteOnboarding = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // role_type is what AuthContext.loadUser() derives `roles`/`currentRole`
      // from when `profiles.roles` is empty (the common case) — the old
      // renderRoleSelection() wrote this the moment a parent/student clicked
      // their card. Skipping straight to these steps from token presence
      // means that click never happens, so it must be written here instead,
      // or the account ends up with no resolvable role and falls back to the
      // staff rail despite organization_members.role being correct.
      if (flow === "parent" || flow === "student") {
        const { error: roleErr } = await supabase.from("profiles").update({ role_type: flow }).eq("id", user.id);
        if (roleErr) throw roleErr;
      }

      if (flow === "parent") {
        if (!invitePreview || !consent) return;
        await redeemParentInvite(inviteToken.trim());
        sessionStorage.removeItem("pendingParentInvite");
        // No token refresh needed: organization membership is read fresh
        // from Postgres on every request, unlike the old Firebase-custom-claims
        // model where a stale ID token could hide a just-granted role.
      } else if (flow === "student") {
        if (!studentInvitePreview) return;
        await redeemStudentInvite(studentInviteToken.trim());
        sessionStorage.removeItem("pendingStudentInvite");
        // No token refresh needed: organization membership is read fresh
        // from Postgres on every request, same as the parent redeem above.
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .update({ profile_status: "complete" })
        .eq("id", user.id);
      if (profileError) throw profileError;

      await checkAuth();
      navigate("/app");
    } catch (err) {
      console.error(err);
      setError("Failed to complete onboarding.");
    } finally {
      setLoading(false);
    }
  };

  const renderParentSteps = () => (
    <div className="space-y-4">
      <h3 className="text-xl font-bold">Link to your child's account</h3>
      <p className="text-sm text-gray-500">
        Ask your tutoring center for an invite link or code — they generate one from your child's profile.
      </p>
      <div>
        <label className="block text-sm font-medium text-gray-700">Invite code</label>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            value={inviteToken}
            onChange={e => { setInviteToken(e.target.value); setInvitePreview(null); }}
            placeholder="Paste the code from your center"
            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border"
          />
          <button
            onClick={handlePreviewInvite}
            disabled={previewLoading || !inviteToken.trim()}
            className="whitespace-nowrap py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            {previewLoading ? "Looking up…" : "Look up"}
          </button>
        </div>
      </div>

      {invitePreview && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 space-y-3">
          <p className="text-sm text-indigo-900">
            This will link your account to <span className="font-semibold">{invitePreview.studentName || "this student"}</span> at{" "}
            <span className="font-semibold">{invitePreview.organizationName || "this tutoring center"}</span>.
          </p>
          <label className="flex items-start gap-2 text-sm text-indigo-900">
            <input
              type="checkbox"
              checked={consent}
              onChange={e => setConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
            />
            <span>
              I consent to my child's attendance, invoices, and payment records being shared with my account,
              per the tutoring center's privacy policy (DPDP Act, 2023).
            </span>
          </label>
        </div>
      )}

      <button
        onClick={handleCompleteOnboarding}
        disabled={loading || !invitePreview || !consent}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? "Linking…" : "Link account"}
      </button>
    </div>
  );

  const renderStudentSteps = () => (
    <div className="space-y-4">
      <h3 className="text-xl font-bold">Join your tutoring center</h3>
      <p className="text-sm text-gray-500">
        Ask your tutor or tutoring center for an invite code — they generate one from your student profile.
      </p>
      <div>
        <label className="block text-sm font-medium text-gray-700">Invite code</label>
        <div className="mt-1 flex gap-2">
          <input
            type="text"
            value={studentInviteToken}
            onChange={e => { setStudentInviteToken(e.target.value); setStudentInvitePreview(null); }}
            placeholder="Paste the code from your center"
            className="block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border"
          />
          <button
            onClick={handlePreviewStudentInvite}
            disabled={studentPreviewLoading || !studentInviteToken.trim()}
            className="whitespace-nowrap py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 disabled:opacity-50"
          >
            {studentPreviewLoading ? "Looking up…" : "Look up"}
          </button>
        </div>
      </div>

      {studentInvitePreview && (
        <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4">
          <p className="text-sm text-indigo-900">
            This will link your account to <span className="font-semibold">{studentInvitePreview.studentName || "this student"}</span> at{" "}
            <span className="font-semibold">{studentInvitePreview.organizationName || "this tutoring center"}</span>.
          </p>
        </div>
      )}

      <button
        onClick={handleCompleteOnboarding}
        disabled={loading || !studentInvitePreview}
        className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
      >
        {loading ? "Joining…" : "Join"}
      </button>
    </div>
  );

  // ---- Tutor wizard: solo/center -> first class -> students, one deferred write at the end ----

  const [tutorBeat, setTutorBeat] = useState<1 | 2 | 3>(1);

  const [orgMode, setOrgMode] = useState<OrgMode | null>(null);
  const [orgName, setOrgName] = useState("");

  const [presetId, setPresetId] = useState(TEMPLATE_GALLERY[0].id);
  const preset = TEMPLATE_GALLERY.find(p => p.id === presetId)!;
  const [className, setClassName] = useState("");
  const [startTime, setStartTime] = useState("16:00");

  const [manualStudents, setManualStudents] = useState([{ name: "", phone: "" }, { name: "", phone: "" }]);
  const [csvMode, setCsvMode] = useState(false);
  const [csvStudents, setCsvStudents] = useState<CsvStudentRow[]>([]);
  const [csvErrors, setCsvErrors] = useState<string[]>([]);

  const handleCsvFile = async (file: File) => {
    setError("");
    const Papa = (await import("papaparse")).default;
    const text = await file.text();
    const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
    const { students, errors } = parseStudentsCsvRows(parsed.data as unknown as string[][]);
    setCsvStudents(students);
    setCsvErrors(errors);
  };

  const manualRowErrors = manualStudents.map(validateManualStudentRow);
  const canFinishBeat3 = manualRowErrors.every(errs => errs.length === 0);

  const handleFinishTutorOnboarding = async () => {
    if (!user?.id) return;
    setLoading(true);
    setError("");
    try {
      // 1. Bootstrap the org with a real, user-chosen name (solo keeps
      // today's auto-generated default). A 409 here is a benign race with
      // AuthContext's own auto-bootstrap effect — bootstrapOrganization()
      // resolves { conflict: true } instead of throwing for that case.
      const chosenOrgName = orgMode === "center" && orgName.trim() ? orgName.trim() : defaultOrgName(user.name, user.email);
      await bootstrapOrganization(chosenOrgName);

      // 2. role_type is a display preference; real authorization comes from
      // organization_members, not this column.
      const { error: roleErr } = await supabase.from("profiles").update({ role_type: "tutor" }).eq("id", user.id);
      if (roleErr) throw roleErr;

      // 3. Re-resolve organizationId fresh rather than trusting a stale
      // `user` closure (Tech Debt #15's exact discipline) — by now
      // organization_members already has a row (from step 1, whichever of
      // us created it), so this also naturally avoids re-triggering
      // AuthContext's own auto-bootstrap branch.
      const refreshed = await checkAuth();
      const organizationId = refreshed?.organizationId;
      if (!organizationId) {
        setError(t("onboarding.errorGeneric"));
        setLoading(false);
        return;
      }

      // 4. Create the students first — class_templates.student_ids must be
      // populated at insert time (step 5), not patched afterward, so that
      // materialize (step 6) resolves student_user_ids/parent_user_ids
      // correctly in the same pass (server/routes/scheduling.ts's
      // materializeTemplate reads student_ids fresh off the template row).
      const rowsToCreate: CsvStudentRow[] = csvMode
        ? csvStudents
        : manualStudents.filter(r => r.name.trim()).map(r => ({ name: r.name.trim(), phone: r.phone.trim() || undefined }));

      const studentIds: string[] = [];
      for (const row of rowsToCreate) {
        const { data, error: sErr } = await supabase
          .from("students")
          .insert({
            organization_id: organizationId,
            tutor_id: user.id,
            name: row.name,
            phone: row.phone || null,
            parent_name: row.parentName || null,
            parent_phone: row.parentPhone || null,
            status: "active",
          })
          .select("id")
          .single();
        if (sErr) throw sErr;
        studentIds.push(data.id);
      }

      // 5. Create the class template, roster already attached.
      const [startHour, startMinute] = startTime.split(":").map(Number);
      const payload = buildClassTemplatePayload({
        preset, name: className, startHour, startMinute, organizationId, tutorId: user.id, studentIds,
      });
      const { data: template, error: tErr } = await supabase.from("class_templates").insert(payload).select().single();
      if (tErr) throw tErr;

      // 6. Fill the rolling session window immediately — same call Calendar.tsx
      // makes right after creating a recurring batch template.
      await api<MaterializeResponse>("/scheduling/materialize", { method: "POST" });

      // 7. Enrollments (capacity tracking), same as Calendar.tsx.
      for (const studentId of studentIds) {
        await ClassManager.enrollStudent(organizationId, studentId, template.id);
      }

      // 8. Done.
      const { error: profileErr } = await supabase.from("profiles").update({ profile_status: "complete" }).eq("id", user.id);
      if (profileErr) throw profileErr;

      await checkAuth();
      navigate("/app");
    } catch (err: any) {
      console.error(err);
      setError(planLimitErrorMessage(err?.message) || t("onboarding.errorGeneric"));
    } finally {
      setLoading(false);
    }
  };

  const renderTutorProgress = () => (
    <div className="mb-8 flex items-center justify-center gap-2">
      {[1, 2, 3].map(n => (
        <div key={n} className={`h-2 w-10 rounded-full ${tutorBeat >= n ? "bg-indigo-600" : "bg-gray-200"}`} />
      ))}
    </div>
  );

  const renderBeat1SoloOrCenter = () => (
    <div className="space-y-6">
      <h3 className="text-xl font-bold text-center">{t("onboarding.beat1Title")}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <button
          onClick={() => { setOrgMode("solo"); setTutorBeat(2); }}
          className={`p-6 border-2 rounded-xl text-center transition-all ${orgMode === "solo" ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:border-indigo-500 hover:bg-indigo-50"}`}
        >
          <UserRound className="w-12 h-12 mx-auto text-indigo-600 mb-4" />
          <h4 className="text-lg font-semibold">{t("onboarding.soloTitle")}</h4>
          <p className="text-sm text-gray-500 mt-2">{t("onboarding.soloSubtitle")}</p>
        </button>
        <button
          onClick={() => setOrgMode("center")}
          className={`p-6 border-2 rounded-xl text-center transition-all ${orgMode === "center" ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:border-indigo-500 hover:bg-indigo-50"}`}
        >
          <Building2 className="w-12 h-12 mx-auto text-indigo-600 mb-4" />
          <h4 className="text-lg font-semibold">{t("onboarding.centerTitle")}</h4>
          <p className="text-sm text-gray-500 mt-2">{t("onboarding.centerSubtitle")}</p>
        </button>
      </div>
      {orgMode === "center" && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700">{t("onboarding.orgNameLabel")}</label>
            <input
              type="text"
              autoFocus
              value={orgName}
              onChange={e => setOrgName(e.target.value)}
              placeholder={t("onboarding.orgNamePlaceholder")}
              className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border"
            />
          </div>
          <button
            onClick={() => setTutorBeat(2)}
            disabled={!orgName.trim()}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
          >
            {t("onboarding.continueButton")}
          </button>
        </div>
      )}
    </div>
  );

  const renderBeat2FirstClass = () => (
    <div className="space-y-4">
      <h3 className="text-xl font-bold text-center">{t("onboarding.beat2Title")}</h3>
      <div className="grid grid-cols-1 gap-2">
        {TEMPLATE_GALLERY.map(p => (
          <button
            key={p.id}
            onClick={() => { setPresetId(p.id); if (!className) setClassName(""); }}
            className={`flex items-center justify-between p-3 border-2 rounded-lg text-left ${presetId === p.id ? "border-indigo-500 bg-indigo-50" : "border-gray-200 hover:border-indigo-500"}`}
          >
            <span className="font-medium">{t(p.labelKey)}</span>
          </button>
        ))}
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">{t("onboarding.classNameLabel")}</label>
        <input
          type="text"
          value={className}
          onChange={e => setClassName(e.target.value)}
          placeholder={preset.namePlaceholder}
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border"
        />
      </div>
      <div>
        <label className="block text-sm font-medium text-gray-700">{t("onboarding.startTimeLabel")}</label>
        <input
          type="time"
          value={startTime}
          onChange={e => setStartTime(e.target.value)}
          className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border"
        />
      </div>
      <div className="flex justify-between">
        <button onClick={() => setTutorBeat(1)} className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
          {t("onboarding.back")}
        </button>
        <button onClick={() => setTutorBeat(3)} className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">
          {t("onboarding.continueButton")}
        </button>
      </div>
    </div>
  );

  const renderBeat3Students = () => (
    <div className="space-y-4">
      <h3 className="text-xl font-bold text-center">{t("onboarding.beat3Title")}</h3>
      <p className="text-sm text-gray-500 text-center">{t("onboarding.beat3Subtitle")}</p>

      {!csvMode ? (
        <>
          <div className="space-y-3">
            {manualStudents.map((row, i) => (
              <div key={i} className="grid grid-cols-2 gap-2">
                <input
                  type="text"
                  value={row.name}
                  onChange={e => setManualStudents(rows => rows.map((r, idx) => idx === i ? { ...r, name: e.target.value } : r))}
                  placeholder={t("onboarding.studentNameLabel")}
                  className="border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border"
                />
                <input
                  type="text"
                  value={row.phone}
                  onChange={e => setManualStudents(rows => rows.map((r, idx) => idx === i ? { ...r, phone: e.target.value } : r))}
                  placeholder={t("onboarding.phoneLabel")}
                  className="border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border"
                />
              </div>
            ))}
          </div>
          <button onClick={() => setCsvMode(true)} className="text-sm text-indigo-600 hover:underline flex items-center gap-1">
            <Upload className="w-4 h-4" /> {t("onboarding.importCsv")}
          </button>
        </>
      ) : (
        <>
          <label className="block">
            <span className="sr-only">{t("onboarding.importCsv")}</span>
            <input
              type="file"
              accept=".csv,text/csv"
              onChange={e => { const f = e.target.files?.[0]; if (f) handleCsvFile(f); }}
              className="block w-full text-sm text-gray-600 file:mr-3 file:py-2 file:px-4 file:rounded-md file:border-0 file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100"
            />
          </label>
          <p className="text-xs text-gray-500">{t("onboarding.csvHelp")}</p>
          {csvStudents.length > 0 && (
            <p className="text-sm text-green-700">{csvStudents.length} student(s) ready to import.</p>
          )}
          {csvErrors.length > 0 && (
            <p className="text-sm text-amber-700">{t("onboarding.csvErrors", { count: csvErrors.length })}</p>
          )}
          <button onClick={() => { setCsvMode(false); setCsvStudents([]); setCsvErrors([]); }} className="text-sm text-indigo-600 hover:underline flex items-center gap-1">
            <Users className="w-4 h-4" /> {t("onboarding.addManually")}
          </button>
        </>
      )}

      <div className="flex justify-between">
        <button onClick={() => setTutorBeat(2)} className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">
          {t("onboarding.back")}
        </button>
        <button
          onClick={handleFinishTutorOnboarding}
          disabled={loading || !canFinishBeat3}
          className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
        >
          {loading ? t("onboarding.finishing") : t("onboarding.finish")}
        </button>
      </div>
    </div>
  );

  const renderTutorWizard = () => (
    <div className="space-y-6">
      {renderTutorProgress()}
      {tutorBeat === 1 && renderBeat1SoloOrCenter()}
      {tutorBeat === 2 && renderBeat2FirstClass()}
      {tutorBeat === 3 && renderBeat3Students()}
    </div>
  );

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-3xl">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          {flow === "tutor" ? t("onboarding.welcomeTitle") : "Complete Your Profile"}
        </h2>
        {flow === "tutor" && <p className="mt-2 text-center text-gray-600">{t("onboarding.welcomeSubtitle")}</p>}
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-3xl">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          {flow === "parent" && renderParentSteps()}
          {flow === "student" && renderStudentSteps()}
          {flow === "tutor" && renderTutorWizard()}
        </div>
      </div>
    </div>
  );
}
