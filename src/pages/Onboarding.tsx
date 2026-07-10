import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "../supabase";
import { CheckCircle, ChevronRight, User, BookOpen, Users, DollarSign, MapPin, GraduationCap } from "lucide-react";
import { previewParentInvite, redeemParentInvite, previewStudentInvite, redeemStudentInvite } from "../lib/api";

export default function Onboarding() {
  const { user, checkAuth } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // State
  const initialRole = user?.role_type || user?.role || null;
  const [role, setRole] = useState<'tutor' | 'parent' | 'student' | 'admin' | null>(initialRole as any);
  const [step, setStep] = useState(initialRole ? 2 : 1);
  
  // Tutor State
  const [tutorData, setTutorData] = useState({
    fullName: user?.name || "",
    subjects: "",
    grades: "",
    experienceYears: 0,
    qualification: "",
    teachingMode: "online",
    location: "",
    priceModel: "monthly",
    priceMin: 0,
    priceMax: 0,
    maxBatchSize: 10
  });

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

  useEffect(() => {
    if (user?.profile_status === 'complete') {
      navigate("/app");
    }
  }, [user, navigate]);

  const handleRoleSelect = async (selectedRole: 'tutor' | 'parent' | 'student') => {
    if (!user?.id) return;
    setLoading(true);
    try {
      // role_type is a display preference; real authorization comes from
      // organization_members, not this column.
      const { error } = await supabase
        .from("profiles")
        .update({ role_type: selectedRole })
        .eq("id", user.id);
      if (error) throw error;
      setRole(selectedRole);
      setStep(2);
      await checkAuth(); // refresh user context
    } catch (err) {
      setError("Failed to set role. Please try again.");
    } finally {
      setLoading(false);
    }
  };

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

  // A link opened with ?invite=TOKEN previews itself once the parent has
  // chosen the parent role and reached step 2.
  useEffect(() => {
    if (role === 'parent' && step === 2 && inviteToken && !invitePreview && !previewLoading) {
      handlePreviewInvite();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, step]);

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

  // A link opened with ?studentInvite=TOKEN previews itself once the student
  // has chosen the student role and reached step 2.
  useEffect(() => {
    if (role === 'student' && step === 2 && studentInviteToken && !studentInvitePreview && !studentPreviewLoading) {
      handlePreviewStudentInvite();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, step]);

  // Resolves a current organizationId rather than trusting `user.organizationId`
  // directly: that value can be stale if bootstrap (triggered by loadUser when
  // role_type first becomes 'tutor'/'admin') hasn't finished updating context
  // yet, or if this is a page reload where role_type was already set on a
  // prior attempt but bootstrap never actually completed. Re-resolving via
  // checkAuth() before writing a role profile closes that race instead of
  // letting a null organization_id hit the database as a constraint violation.
  const resolveOrganizationId = async (): Promise<string | null> => {
    if (user?.organizationId) return user.organizationId;
    const refreshed = await checkAuth();
    return refreshed?.organizationId || null;
  };

  const handleCompleteOnboarding = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      if (role === 'tutor') {
        const organizationId = await resolveOrganizationId();
        if (!organizationId) {
          setError("We couldn't finish setting up your organization. Please try again in a moment.");
          setLoading(false);
          return;
        }
        const { error } = await supabase.from("tutor_profiles").upsert({
          user_id: user.id,
          organization_id: organizationId,
          full_name: tutorData.fullName,
          subjects: tutorData.subjects.split(',').map(s => s.trim()).filter(Boolean),
          grades: tutorData.grades.split(',').map(s => s.trim()).filter(Boolean),
          experience_years: tutorData.experienceYears,
          qualification: tutorData.qualification,
          teaching_mode: tutorData.teachingMode,
          location: tutorData.location,
          price_model: tutorData.priceModel,
          price_range_min: tutorData.priceMin,
          price_range_max: tutorData.priceMax,
          max_batch_size: tutorData.maxBatchSize,
          is_verified: false
        }, { onConflict: "user_id" });
        if (error) throw error;
      } else if (role === 'parent') {
        if (!invitePreview || !consent) return;
        await redeemParentInvite(inviteToken.trim());
        sessionStorage.removeItem("pendingParentInvite");
        // No token refresh needed: organization membership is read fresh
        // from Postgres on every request, unlike the old Firebase-custom-claims
        // model where a stale ID token could hide a just-granted role.
      } else if (role === 'student') {
        if (!studentInvitePreview) return;
        await redeemStudentInvite(studentInviteToken.trim());
        sessionStorage.removeItem("pendingStudentInvite");
        // No token refresh needed: organization membership is read fresh
        // from Postgres on every request, same as the parent redeem above.
      }

      const { error: profileError } = await supabase
        .from("profiles")
        .update({ profile_status: 'complete' })
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

  const renderRoleSelection = () => (
    <div className="space-y-6">
      <div className="text-center">
        <h2 className="text-2xl font-bold text-gray-900">Welcome to the Platform</h2>
        <p className="mt-2 text-gray-600">Please select your role to continue</p>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <button onClick={() => handleRoleSelect('tutor')} disabled={loading} className="p-6 border-2 border-gray-200 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 transition-all text-center">
          <BookOpen className="w-12 h-12 mx-auto text-indigo-600 mb-4" />
          <h3 className="text-lg font-semibold">I am a Tutor</h3>
          <p className="text-sm text-gray-500 mt-2">I want to teach and manage students</p>
        </button>
        <button onClick={() => handleRoleSelect('parent')} disabled={loading} className="p-6 border-2 border-gray-200 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 transition-all text-center">
          <Users className="w-12 h-12 mx-auto text-indigo-600 mb-4" />
          <h3 className="text-lg font-semibold">I am a Parent</h3>
          <p className="text-sm text-gray-500 mt-2">I want to monitor my child's progress</p>
        </button>
        <button onClick={() => handleRoleSelect('student')} disabled={loading} className="p-6 border-2 border-gray-200 rounded-xl hover:border-indigo-500 hover:bg-indigo-50 transition-all text-center">
          <GraduationCap className="w-12 h-12 mx-auto text-indigo-600 mb-4" />
          <h3 className="text-lg font-semibold">I am a Student</h3>
          <p className="text-sm text-gray-500 mt-2">I want to learn and attend classes</p>
        </button>
      </div>
    </div>
  );

  const renderTutorSteps = () => {
    if (step === 2) {
      return (
        <div className="space-y-4">
          <h3 className="text-xl font-bold">Basic & Professional Info</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700">Full Name</label>
            <input type="text" value={tutorData.fullName} onChange={e => setTutorData({...tutorData, fullName: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Qualification</label>
            <input type="text" value={tutorData.qualification} onChange={e => setTutorData({...tutorData, qualification: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Years of Experience</label>
            <input type="number" value={tutorData.experienceYears} onChange={e => setTutorData({...tutorData, experienceYears: Number(e.target.value)})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" />
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700">Subjects (comma separated)</label>
            <input type="text" value={tutorData.subjects} onChange={e => setTutorData({...tutorData, subjects: e.target.value})} placeholder="e.g. Math, Science" className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" />
          </div>
          <div className="mt-4">
            <label className="block text-sm font-medium text-gray-700">Grades (comma separated)</label>
            <input type="text" value={tutorData.grades} onChange={e => setTutorData({...tutorData, grades: e.target.value})} placeholder="e.g. 9th, 10th" className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" />
          </div>
          <button onClick={() => setStep(3)} className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 mt-4">Next</button>
        </div>
      );
    }
    if (step === 3) {
      return (
        <div className="space-y-4">
          <h3 className="text-xl font-bold">Teaching Setup & Pricing</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700">Teaching Mode</label>
            <select value={tutorData.teachingMode} onChange={e => setTutorData({...tutorData, teachingMode: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border">
              <option value="online">Online</option>
              <option value="offline">Offline</option>
              <option value="hybrid">Hybrid</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Pricing Model</label>
            <select value={tutorData.priceModel} onChange={e => setTutorData({...tutorData, priceModel: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border">
              <option value="monthly">Monthly</option>
              <option value="per_session">Per Session</option>
              <option value="package">Package</option>
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Min Price</label>
              <input type="number" value={tutorData.priceMin} onChange={e => setTutorData({...tutorData, priceMin: Number(e.target.value)})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Max Price</label>
              <input type="number" value={tutorData.priceMax} onChange={e => setTutorData({...tutorData, priceMax: Number(e.target.value)})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" />
            </div>
          </div>
          <div className="flex justify-between">
            <button onClick={() => setStep(2)} className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">Back</button>
            <button onClick={handleCompleteOnboarding} disabled={loading} className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Complete Profile</button>
          </div>
        </div>
      );
    }
  };

  const renderParentSteps = () => {
    if (step !== 2) return null;
    return (
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
  };

  const renderStudentSteps = () => {
    if (step !== 2) return null;
    return (
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
  };

  const renderAdminSteps = () => {
    return (
      <div className="space-y-4 text-center">
        <h3 className="text-xl font-bold">Admin Setup</h3>
        <p className="text-gray-600">Your account has been designated as an administrator.</p>
        <button onClick={handleCompleteOnboarding} disabled={loading} className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Complete Setup</button>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8">
      <div className="sm:mx-auto sm:w-full sm:max-w-3xl">
        <h2 className="mt-6 text-center text-3xl font-extrabold text-gray-900">
          Complete Your Profile
        </h2>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-3xl">
        <div className="bg-white py-8 px-4 shadow sm:rounded-lg sm:px-10">
          {error && (
            <div className="mb-4 bg-red-50 border border-red-200 text-red-600 px-4 py-3 rounded-md text-sm">
              {error}
            </div>
          )}

          {/* Progress Bar */}
          {role && role !== 'admin' && (
            <div className="mb-8">
              <div className="flex items-center justify-between">
                <div className="flex items-center">
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full ${step >= 1 ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'}`}>1</div>
                  <div className={`w-12 h-1 ${step >= 2 ? 'bg-indigo-600' : 'bg-gray-200'}`}></div>
                  <div className={`flex items-center justify-center w-8 h-8 rounded-full ${step >= 2 ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'}`}>2</div>
                  {role !== 'student' && role !== 'parent' && (
                    <>
                      <div className={`w-12 h-1 ${step >= 3 ? 'bg-indigo-600' : 'bg-gray-200'}`}></div>
                      <div className={`flex items-center justify-center w-8 h-8 rounded-full ${step >= 3 ? 'bg-indigo-600 text-white' : 'bg-gray-200 text-gray-500'}`}>3</div>
                    </>
                  )}
                </div>
                <div className="text-sm font-medium text-gray-500 capitalize">Role: {role}</div>
              </div>
            </div>
          )}

          {!role && renderRoleSelection()}
          {role === 'tutor' && renderTutorSteps()}
          {role === 'parent' && renderParentSteps()}
          {role === 'student' && renderStudentSteps()}
          {role === 'admin' && renderAdminSteps()}
        </div>
      </div>
    </div>
  );
}
