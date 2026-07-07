import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { useNavigate } from "react-router-dom";
import { doc, updateDoc, setDoc, collection, addDoc } from "firebase/firestore";
import { db } from "../firebase";
import { CheckCircle, ChevronRight, User, BookOpen, Users, DollarSign, MapPin, GraduationCap } from "lucide-react";

export default function Onboarding() {
  const { user, checkAuth } = useAuth();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  
  // State
  const initialRole = user?.role_type || user?.role || null;
  const [role, setRole] = useState<'tutor' | 'parent' | 'student' | null>(initialRole as any);
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

  // Parent State
  const [parentData, setParentData] = useState({
    fullName: user?.name || "",
    address: "",
    children: [] as any[]
  });
  const [childForm, setChildForm] = useState({ name: "", grade: "", board: "", dob: "" });

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
      await updateDoc(doc(db, "users", user.id), {
        role_type: selectedRole,
        role: selectedRole // for backward compatibility
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
        await setDoc(doc(db, "parent_profiles", user.id), {
          user_id: user.id,
          full_name: parentData.fullName,
          address: parentData.address
        });
        // Add children
        for (const child of parentData.children) {
          await addDoc(collection(db, "student_profiles"), {
            full_name: child.name,
            grade: child.grade,
            board: child.board,
            dob: child.dob,
            parent_id: user.id
          });
        }
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
    if (step === 2) {
      return (
        <div className="space-y-4">
          <h3 className="text-xl font-bold">Parent Information</h3>
          <div>
            <label className="block text-sm font-medium text-gray-700">Full Name</label>
            <input type="text" value={parentData.fullName} onChange={e => setParentData({...parentData, fullName: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Address</label>
            <textarea value={parentData.address} onChange={e => setParentData({...parentData, address: e.target.value})} className="mt-1 block w-full border-gray-300 rounded-md shadow-sm focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm p-2 border" rows={3}></textarea>
          </div>
          <button onClick={() => setStep(3)} className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700">Next</button>
        </div>
      );
    }
    if (step === 3) {
      return (
        <div className="space-y-4">
          <h3 className="text-xl font-bold">Add Children</h3>
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 space-y-3">
            <input type="text" placeholder="Child's Full Name" value={childForm.name} onChange={e => setChildForm({...childForm, name: e.target.value})} className="block w-full border-gray-300 rounded-md shadow-sm p-2 border sm:text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <input type="text" placeholder="Grade" value={childForm.grade} onChange={e => setChildForm({...childForm, grade: e.target.value})} className="block w-full border-gray-300 rounded-md shadow-sm p-2 border sm:text-sm" />
              <input type="text" placeholder="Board" value={childForm.board} onChange={e => setChildForm({...childForm, board: e.target.value})} className="block w-full border-gray-300 rounded-md shadow-sm p-2 border sm:text-sm" />
            </div>
            <input type="date" value={childForm.dob} onChange={e => setChildForm({...childForm, dob: e.target.value})} className="block w-full border-gray-300 rounded-md shadow-sm p-2 border sm:text-sm" />
            <button 
              onClick={() => {
                if (childForm.name) {
                  setParentData({...parentData, children: [...parentData.children, childForm]});
                  setChildForm({ name: "", grade: "", board: "", dob: "" });
                }
              }}
              className="w-full py-2 bg-white border border-gray-300 rounded-md text-sm font-medium text-gray-700 hover:bg-gray-50"
            >
              Add Child
            </button>
          </div>
          
          {parentData.children.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-medium text-gray-700 mb-2">Added Children:</h4>
              <ul className="space-y-2">
                {parentData.children.map((child, idx) => (
                  <li key={idx} className="bg-white border border-gray-200 p-3 rounded-md flex justify-between items-center">
                    <span>{child.name} ({child.grade})</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          
          <div className="flex justify-between mt-6">
            <button onClick={() => setStep(2)} className="py-2 px-4 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50">Back</button>
            <button 
              onClick={handleCompleteOnboarding} 
              disabled={loading || parentData.children.length === 0} 
              className="py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50"
            >
              Complete Profile
            </button>
          </div>
        </div>
      );
    }
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
                  {role !== 'student' && (
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
