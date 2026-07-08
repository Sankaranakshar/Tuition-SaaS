import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import { doc, updateDoc, setDoc } from "firebase/firestore";
import { auth, db } from "../firebase";
import { CheckCircle, ChevronRight, User, BookOpen, Users, DollarSign, MapPin, GraduationCap } from "lucide-react";
import { previewParentInvite, redeemParentInvite } from "../lib/api";

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

  // Student State
  const [studentData, setStudentData] = useState({
    fullName: user?.name || "",
    dob: "",
    grade: "",
    board: "",
    subjectsNeeded: "",
    learningPreferences: "",
    parentCode: ""
  });

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
      // server-set custom claims and organization_members.
      await updateDoc(doc(db, "users", user.id), {
        role_type: selectedRole
      });
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

  const handleCompleteOnboarding = async () => {
    if (!user?.id) return;
    setLoading(true);
    try {
      if (role === 'tutor') {
        await setDoc(doc(db, "tutor_profiles", user.id), {
          user_id: user.id,
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
        });
      } else if (role === 'parent') {
        if (!invitePreview || !consent) return;
        await redeemParentInvite(inviteToken.trim());
        sessionStorage.removeItem("pendingParentInvite");
        // The redeem call just granted custom claims server-side; force a
        // fresh ID token so the very next API call carries them (mirrors the
        // tutor/admin bootstrap refresh above).
        await auth.currentUser?.getIdToken(true);
      } else if (role === 'student') {
        await setDoc(doc(db, "student_profiles", user.id), {
          user_id: user.id,
          full_name: studentData.fullName,
          grade: studentData.grade,
          board: studentData.board,
          dob: studentData.dob,
          subjects_needed: studentData.subjectsNeeded.split(',').map(s => s.trim()).filter(Boolean),
          learning_preferences: studentData.learningPreferences,
          parent_id: studentData.parentCode || null
        });
      }

      await updateDoc(doc(db, "users", user.id), {
        profile_status: 'complete'
      });
      
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
    if (step === 2) {
      return (
        <div className="space-y-4">
          <h3 className="text-xl font-bold">Student Profile</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700">Full Name</label>
            <input type="text" value={studentData.fullName} onChange={e => setStudentData({...studentData, fullName: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Date of Birth</label>
            <input type="date" value={studentData.dob} onChange={e => setStudentData({...studentData, dob: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Grade</label>
              <input type="text" value={studentData.grade} onChange={e => setStudentData({...studentData, grade: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">Board</label>
              <input type="text" value={studentData.board} onChange={e => setStudentData({...studentData, board: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" />
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Subjects Needed (comma separated)</label>
            <input type="text" value={studentData.subjectsNeeded} onChange={e => setStudentData({...studentData, subjectsNeeded: e.target.value})} placeholder="e.g. Math, Physics" className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Learning Preferences</label>
            <textarea value={studentData.learningPreferences} onChange={e => setStudentData({...studentData, learningPreferences: e.target.value})} placeholder="e.g. Needs extra help with algebra, prefers visual learning" className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" rows={3}></textarea>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Parent Invite Code (Optional)</label>
            <input type="text" placeholder="Enter code from parent" value={studentData.parentCode} onChange={e => setStudentData({...studentData, parentCode: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" />
          </div>
          <button onClick={handleCompleteOnboarding} disabled={loading} className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Complete Profile</button>
        </div>
      );
    }
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
