import React, { useState, useEffect } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Edit2, FileText, Calendar, DollarSign, MessageSquare, User, BookOpen, Clock, CreditCard, Plus, Save, X, CheckCircle, XCircle, Link as LinkIcon, Award, Download } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { toast } from "sonner";

import LoadingSpinner from "../components/LoadingSpinner";
import { createParentInvite, createStudentInvite } from "../lib/api";

// --- Supabase row <-> camelCase UI-shape mappers. The students table grew a
// large ad-hoc field set under the old Firestore model; keep the UI's camelCase
// keys unchanged and translate at the query boundary. ---

const STUDENT_FIELDS: [string, string][] = [
  ["name", "name"],
  ["notes", "notes"],
  ["status", "status"],
  ["phone", "phone"],
  ["email", "email"],
  ["address", "address"],
  ["parentName", "parent_name"],
  ["parentPhone", "parent_phone"],
  ["parentEmail", "parent_email"],
  ["tutorId", "tutor_id"],
  ["age", "age"],
  ["gender", "gender"],
  ["schoolName", "school_name"],
  ["board", "board"],
  ["grade", "grade"],
  ["subject", "subject"],
  ["areasOfDifficulty", "areas_of_difficulty"],
  ["learningGoals", "learning_goals"],
  ["studentPhone", "student_phone"],
  ["studentEmail", "student_email"],
  ["emergencyContactName", "emergency_contact_name"],
  ["emergencyContactPhone", "emergency_contact_phone"],
  ["feeStructure", "fee_structure"],
  ["feeAmount", "fee_amount"],
  ["credits", "credits"],
];

function rowToStudent(row: any): any {
  const out: any = {
    id: row.id,
    organizationId: row.organization_id,
    studentUserId: row.student_user_id,
    isDeleted: row.is_deleted,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  for (const [camel, snake] of STUDENT_FIELDS) out[camel] = row[snake];
  return out;
}

function studentToRow(edit: any): any {
  const out: any = {};
  for (const [camel, snake] of STUDENT_FIELDS) {
    if (edit[camel] !== undefined) out[snake] = edit[camel];
  }
  return out;
}

function rowToSession(row: any): any {
  return {
    id: row.id,
    organizationId: row.organization_id,
    tutorId: row.tutor_id,
    studentIds: row.student_ids || [],
    startTime: row.start_time,
    endTime: row.end_time,
    status: row.status,
  };
}

function rowToDocument(row: any): any {
  return {
    id: row.id,
    studentId: row.student_id,
    tutorId: row.tutor_id,
    name: row.name,
    storagePath: row.storage_path,
    fileUrl: row.file_url,
    createdAt: row.created_at,
  };
}

function rowToInvoice(row: any): any {
  return {
    id: row.id,
    studentId: row.student_id,
    tutorId: row.tutor_id,
    status: row.status,
    dueDate: row.due_date,
    amount: row.total_amount,
  };
}

function rowToClassTemplate(row: any): any {
  return {
    id: row.id,
    organizationId: row.organization_id,
    tutorId: row.tutor_id,
    name: row.name,
    type: row.type,
    subject: row.subject,
    grade: row.grade,
    studentIds: row.student_ids || [],
  };
}

function rowToAssessment(row: any): any {
  return {
    id: row.id,
    studentId: row.student_id,
    tutorId: row.tutor_id,
    title: row.title,
    type: row.type,
    date: row.date,
    score: row.score,
    totalScore: row.total_score,
    feedback: row.feedback,
  };
}

export default function StudentProfile() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  
  const [student, setStudent] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [sessions, setSessions] = useState<any[]>([]);
  const [documents, setDocuments] = useState<any[]>([]);
  const [invoices, setInvoices] = useState<any[]>([]);
  const [assessments, setAssessments] = useState<any[]>([]);

  const [activeTab, setActiveTab] = useState<'profile' | 'academic' | 'schedule' | 'financial' | 'communications'>('profile');
  
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editFormData, setEditFormData] = useState<any>({});
  const [isSaving, setIsSaving] = useState(false);

  // Modals state
  const [isScheduleModalOpen, setIsScheduleModalOpen] = useState(false);
  const [isInvoiceModalOpen, setIsInvoiceModalOpen] = useState(false);
  const [isInstanceModalOpen, setIsInstanceModalOpen] = useState(false);
  const [isAssessmentModalOpen, setIsAssessmentModalOpen] = useState(false);
  
  // Assessment Form State
  const [assessmentType, setAssessmentType] = useState("Quiz");
  const [assessmentDate, setAssessmentDate] = useState(new Date().toISOString().split('T')[0]);
  const [assessmentScore, setAssessmentScore] = useState("");
  const [assessmentMaxScore, setAssessmentMaxScore] = useState("");
  const [assessmentComments, setAssessmentComments] = useState("");

  const [classInstances, setClassInstances] = useState<any[]>([]);
  const [availableClassInstances, setAvailableClassInstances] = useState<any[]>([]);
  const [selectedInstanceId, setSelectedInstanceId] = useState("");

  // Parent portal invite state (E10.1) — the real, verified linking path.
  const [parentInvite, setParentInvite] = useState<{ link: string; expiresAt: string } | null>(null);
  const [isCreatingInvite, setIsCreatingInvite] = useState(false);
  const [studentInvite, setStudentInvite] = useState<{ link: string; expiresAt: string } | null>(null);
  const [isCreatingStudentInvite, setIsCreatingStudentInvite] = useState(false);

  useEffect(() => {
    if (!user || !id || !user.organizationId) return;
    let cancelled = false;
    const orgId = user.organizationId;
    const isTutor = user.role === 'tutor';

    // Student details (single-doc listener).
    const loadStudent = async () => {
      const { data, error } = await supabase.from("students").select("*").eq("id", id).maybeSingle();
      if (cancelled) return;
      if (error) {
        console.error("Error fetching student:", error);
      } else if (data) {
        const mapped = rowToStudent(data);
        setStudent(mapped);
        setEditFormData(mapped);
      } else {
        console.error("No such student!");
      }
      setLoading(false);
    };

    // Related sessions (array-contains -> .contains()).
    const loadSessions = async () => {
      let q = supabase
        .from("class_sessions")
        .select("*")
        .contains("student_ids", [id])
        .eq("organization_id", orgId)
        .limit(50);
      if (isTutor) q = q.eq("tutor_id", user.id);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) console.error("Error fetching sessions:", error);
      else setSessions((data || []).map(rowToSession));
    };

    // Related documents.
    const loadDocuments = async () => {
      let q = supabase.from("documents").select("*").eq("student_id", id).eq("organization_id", orgId).limit(50);
      if (isTutor) q = q.eq("tutor_id", user.id);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) console.error("Error fetching documents:", error);
      else setDocuments((data || []).map(rowToDocument));
    };

    // Related invoices.
    const loadInvoices = async () => {
      let q = supabase.from("invoices").select("*").eq("student_id", id).eq("organization_id", orgId).limit(50);
      if (isTutor) q = q.eq("tutor_id", user.id);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) console.error("Error fetching invoices:", error);
      else setInvoices((data || []).map(rowToInvoice));
    };

    // Related class instances (templates).
    const loadInstances = async () => {
      let q = supabase.from("class_templates").select("*").eq("organization_id", orgId).limit(100);
      if (isTutor) q = q.eq("tutor_id", user.id);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) console.error("Error fetching class instances:", error);
      else setClassInstances((data || []).map(rowToClassTemplate));
    };

    // Assessments.
    const loadAssessments = async () => {
      let q = supabase.from("assessments").select("*").eq("student_id", id).eq("organization_id", orgId).limit(50);
      if (isTutor) q = q.eq("tutor_id", user.id);
      const { data, error } = await q;
      if (cancelled) return;
      if (error) {
        console.error("Error fetching assessments:", error);
        return;
      }
      const sorted = (data || []).map(rowToAssessment).sort((a: any, b: any) => new Date(b.date).getTime() - new Date(a.date).getTime());
      setAssessments(sorted);
    };

    loadStudent();
    loadSessions();
    loadDocuments();
    loadInvoices();
    loadInstances();
    loadAssessments();

    // postgres_changes filters only support one simple column=eq condition
    // server-side; scope each subscription to organization_id (broadest safe
    // scope) and let the full load() reapply the student/tutor/array filters.
    const channel = supabase
      .channel(`student-profile-${id}-${orgId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "students", filter: `id=eq.${id}` }, loadStudent)
      .on("postgres_changes", { event: "*", schema: "public", table: "class_sessions", filter: `organization_id=eq.${orgId}` }, loadSessions)
      .on("postgres_changes", { event: "*", schema: "public", table: "documents", filter: `organization_id=eq.${orgId}` }, loadDocuments)
      .on("postgres_changes", { event: "*", schema: "public", table: "invoices", filter: `organization_id=eq.${orgId}` }, loadInvoices)
      .on("postgres_changes", { event: "*", schema: "public", table: "class_templates", filter: `organization_id=eq.${orgId}` }, loadInstances)
      .on("postgres_changes", { event: "*", schema: "public", table: "assessments", filter: `organization_id=eq.${orgId}` }, loadAssessments)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user, id]);

  const handleCreateParentInvite = async () => {
    if (!id) return;
    setIsCreatingInvite(true);
    try {
      const result = await createParentInvite(id);
      const link = `${window.location.origin}/onboarding?invite=${result.token}`;
      setParentInvite({ link, expiresAt: result.expiresAt });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't generate an invite link");
    } finally {
      setIsCreatingInvite(false);
    }
  };

  const handleCreateStudentInvite = async () => {
    if (!id) return;
    setIsCreatingStudentInvite(true);
    try {
      const result = await createStudentInvite(id);
      const link = `${window.location.origin}/onboarding?studentInvite=${result.token}`;
      setStudentInvite({ link, expiresAt: result.expiresAt });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't generate an invite link");
    } finally {
      setIsCreatingStudentInvite(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!id) return;
    setIsSaving(true);
    try {
      const { error } = await supabase.from("students").update(studentToRow(editFormData)).eq("id", id);
      if (error) throw error;
      setIsEditingProfile(false);
    } catch (error) {
      console.error("Error updating profile:", error);
    } finally {
      setIsSaving(false);
    }
  };

  const handleInputChange = (field: string, value: any) => {
    setEditFormData((prev: any) => ({ ...prev, [field]: value }));
  };

  const handleSaveAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !user?.organizationId) return;
    try {
      const { error } = await supabase.from("assessments").insert({
        student_id: id,
        organization_id: user.organizationId,
        tutor_id: user.id,
        title: `${assessmentType} on ${assessmentDate}`, // Default title
        type: assessmentType.toLowerCase(), // Ensure it matches enum
        date: assessmentDate,
        score: Number(assessmentScore),
        total_score: Number(assessmentMaxScore),
        feedback: assessmentComments,
      });
      if (error) throw error;
      setIsAssessmentModalOpen(false);
      setAssessmentType("Quiz");
      setAssessmentDate(new Date().toISOString().split('T')[0]);
      setAssessmentScore("");
      setAssessmentMaxScore("");
      setAssessmentComments("");
    } catch (error) {
      console.error("Error saving assessment:", error);
    }
  };

  // Tech Debt #6 (DEV_PLAN.md): jspdf/jspdf-autotable are loaded on demand,
  // like exceljs elsewhere, so they don't sit in this page's chunk unless the
  // report is actually generated.
  const generateProgressReport = async () => {
    const [{ jsPDF }, { default: autoTable }] = await Promise.all([
      import("jspdf"),
      import("jspdf-autotable"),
    ]);
    const doc = new jsPDF();

    // Header
    doc.setFontSize(22);
    doc.setTextColor(79, 70, 229); // Indigo 600
    doc.text("Monthly Progress Report", 14, 20);
    
    doc.setFontSize(12);
    doc.setTextColor(0, 0, 0);
    doc.text(`Student: ${student?.name}`, 14, 30);
    doc.text(`Grade: ${student?.grade || 'N/A'}`, 14, 38);
    doc.text(`Subject: ${student?.subject || 'N/A'}`, 14, 46);
    doc.text(`Date: ${new Date().toLocaleDateString()}`, 14, 54);

    // Attendance Summary
    const completedSessions = sessions.filter(s => s.status === 'completed').length;
    const noShowSessions = sessions.filter(s => s.status === 'no_show').length;
    const totalSessions = completedSessions + noShowSessions;
    const attendanceRate = totalSessions > 0 ? Math.round((completedSessions / totalSessions) * 100) : 0;

    doc.setFontSize(16);
    doc.text("Attendance Summary", 14, 70);
    doc.setFontSize(12);
    doc.text(`Total Classes: ${totalSessions}`, 14, 80);
    doc.text(`Attended: ${completedSessions}`, 14, 88);
    doc.text(`Attendance Rate: ${attendanceRate}%`, 14, 96);

    // Academic Performance
    doc.setFontSize(16);
    doc.text("Academic Performance", 14, 115);
    
    if (assessments.length > 0) {
      const tableData = assessments.map(a => {
        const maxScore = a.totalScore || a.maxScore || 100;
        return [
          new Date(a.date).toLocaleDateString(),
          a.type,
          `${a.score} / ${maxScore}`,
          `${Math.round((a.score / maxScore) * 100)}%`,
          a.feedback || a.comments || '-'
        ];
      });

      autoTable(doc, {
        startY: 125,
        head: [['Date', 'Type', 'Score', 'Percentage', 'Comments']],
        body: tableData,
        theme: 'striped',
        headStyles: { fillColor: [79, 70, 229] }
      });
    } else {
      doc.setFontSize(12);
      doc.text("No assessments recorded yet.", 14, 125);
    }

    // Tutor Notes
    const finalY = (doc as any).lastAutoTable ? (doc as any).lastAutoTable.finalY + 20 : 145;
    doc.setFontSize(16);
    doc.text("Tutor Comments", 14, finalY);
    doc.setFontSize(12);
    doc.text(student?.areasOfDifficulty ? `Focus Areas: ${student.areasOfDifficulty}` : "Keep up the good work!", 14, finalY + 10, { maxWidth: 180 });

    doc.save(`${student?.name.replace(/\s+/g, '_')}_Progress_Report.pdf`);
  };

  if (loading) {
    return <LoadingSpinner message="Loading student profile..." />;
  }

  if (!student) {
    return (
      <div className="p-6 text-center">
        <h2 className="text-xl font-semibold text-gray-900">Student not found</h2>
        <button onClick={() => navigate("/students")} className="mt-4 text-indigo-600 hover:text-indigo-800">
          Back to Students
        </button>
      </div>
    );
  }

  const renderProfileTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">Student Profile & Academic Details</h2>
        {!isEditingProfile ? (
          <button onClick={() => setIsEditingProfile(true)} className="flex items-center text-sm text-indigo-600 hover:text-indigo-800">
            <Edit2 className="w-4 h-4 mr-1" /> Edit Profile
          </button>
        ) : (
          <div className="flex space-x-2">
            <button onClick={() => setIsEditingProfile(false)} className="flex items-center text-sm text-gray-600 hover:text-gray-800">
              <X className="w-4 h-4 mr-1" /> Cancel
            </button>
            <button onClick={handleSaveProfile} disabled={isSaving} className="flex items-center text-sm text-white bg-indigo-600 px-3 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50">
              <Save className="w-4 h-4 mr-1" /> {isSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Personal Info */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-md font-semibold text-gray-900 mb-4 flex items-center">
            <User className="w-5 h-5 mr-2 text-indigo-500" /> Personal Info
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-500">Full Name</label>
              {isEditingProfile ? (
                <input type="text" value={editFormData.name || ''} onChange={e => handleInputChange('name', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
              ) : (
                <p className="mt-1 text-sm text-gray-900">{student.name}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-500">Age / DOB</label>
                {isEditingProfile ? (
                  <input type="text" value={editFormData.age || ''} onChange={e => handleInputChange('age', e.target.value)} placeholder="e.g. 15 or YYYY-MM-DD" className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{student.age || 'Not provided'}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Gender</label>
                {isEditingProfile ? (
                  <select value={editFormData.gender || ''} onChange={e => handleInputChange('gender', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm">
                    <option value="">Select</option>
                    <option value="Male">Male</option>
                    <option value="Female">Female</option>
                    <option value="Other">Other</option>
                  </select>
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{student.gender || 'Not provided'}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* School Details */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-md font-semibold text-gray-900 mb-4 flex items-center">
            <BookOpen className="w-5 h-5 mr-2 text-indigo-500" /> School Details
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-500">School Name</label>
              {isEditingProfile ? (
                <input type="text" value={editFormData.schoolName || ''} onChange={e => handleInputChange('schoolName', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
              ) : (
                <p className="mt-1 text-sm text-gray-900">{student.schoolName || 'Not provided'}</p>
              )}
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-500">Board</label>
                {isEditingProfile ? (
                  <input type="text" value={editFormData.board || ''} onChange={e => handleInputChange('board', e.target.value)} placeholder="e.g. CBSE, ICSE" className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{student.board || 'Not provided'}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Grade / Standard</label>
                {isEditingProfile ? (
                  <input type="text" value={editFormData.grade || ''} onChange={e => handleInputChange('grade', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{student.grade || 'Not provided'}</p>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Academic Interests */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-md font-semibold text-gray-900 mb-4 flex items-center">
            <FileText className="w-5 h-5 mr-2 text-indigo-500" /> Academic Interests
          </h3>
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-500">Primary Subjects</label>
              {isEditingProfile ? (
                <input type="text" value={editFormData.subject || ''} onChange={e => handleInputChange('subject', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
              ) : (
                <p className="mt-1 text-sm text-gray-900">{student.subject || 'Not provided'}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">Areas of Difficulty</label>
              {isEditingProfile ? (
                <textarea value={editFormData.areasOfDifficulty || ''} onChange={e => handleInputChange('areasOfDifficulty', e.target.value)} rows={2} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
              ) : (
                <p className="mt-1 text-sm text-gray-900">{student.areasOfDifficulty || 'Not provided'}</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-500">Learning Goals</label>
              {isEditingProfile ? (
                <textarea value={editFormData.learningGoals || ''} onChange={e => handleInputChange('learningGoals', e.target.value)} rows={2} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
              ) : (
                <p className="mt-1 text-sm text-gray-900">{student.learningGoals || 'Not provided'}</p>
              )}
            </div>
          </div>
        </div>

        {/* Contact Info */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-md font-semibold text-gray-900 mb-4 flex items-center">
            <MessageSquare className="w-5 h-5 mr-2 text-indigo-500" /> Contact Info
          </h3>
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-500">Student Phone</label>
                {isEditingProfile ? (
                  <input type="text" value={editFormData.studentPhone || ''} onChange={e => handleInputChange('studentPhone', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{student.studentPhone || 'Not provided'}</p>
                )}
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-500">Student Email</label>
                {isEditingProfile ? (
                  <input type="email" value={editFormData.studentEmail || ''} onChange={e => handleInputChange('studentEmail', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
                ) : (
                  <p className="mt-1 text-sm text-gray-900">{student.studentEmail || 'Not provided'}</p>
                )}
              </div>
            </div>
            <div className="pt-4 border-t border-gray-100">
              <label className="block text-sm font-medium text-gray-900 mb-4">Parent / Guardian</label>
              <p className="text-xs text-gray-500 mb-4">
                Contact details shown on invoices and reports. To grant this parent access to the portal
                (schedule, invoices, payments), use the Parent Portal Access card below.
              </p>
              <div className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-500">Parent Name</label>
                  {isEditingProfile ? (
                    <input type="text" value={editFormData.parentName || ''} onChange={e => handleInputChange('parentName', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
                  ) : (
                    <p className="mt-1 text-sm text-gray-900">{student.parentName || 'Not provided'}</p>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-500">Parent Phone</label>
                    {isEditingProfile ? (
                      <input type="text" value={editFormData.parentPhone || ''} onChange={e => handleInputChange('parentPhone', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
                    ) : (
                      <p className="mt-1 text-sm text-gray-900">{student.parentPhone || 'Not provided'}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-500">Parent Email</label>
                    {isEditingProfile ? (
                      <input type="email" value={editFormData.parentEmail || ''} onChange={e => handleInputChange('parentEmail', e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
                    ) : (
                      <p className="mt-1 text-sm text-gray-900">{student.parentEmail || 'Not provided'}</p>
                    )}
                  </div>
                </div>
              </div>
            </div>
            <div className="pt-2 border-t border-gray-100">
              <label className="block text-sm font-medium text-gray-500">Emergency Contact</label>
              {isEditingProfile ? (
                <div className="grid grid-cols-2 gap-4 mt-1">
                  <input type="text" placeholder="Name" value={editFormData.emergencyContactName || ''} onChange={e => handleInputChange('emergencyContactName', e.target.value)} className="block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
                  <input type="text" placeholder="Phone" value={editFormData.emergencyContactPhone || ''} onChange={e => handleInputChange('emergencyContactPhone', e.target.value)} className="block w-full border border-gray-300 rounded-md shadow-sm py-1.5 px-3 sm:text-sm" />
                </div>
              ) : (
                <p className="mt-1 text-sm text-gray-900">
                  {student.emergencyContactName ? `${student.emergencyContactName} (${student.emergencyContactPhone})` : 'Not provided'}
                </p>
              )}
            </div>
          </div>
        </div>

        {/* Parent portal invite (E10.1): the real, verified linking path. */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-md font-semibold text-gray-900 mb-1 flex items-center">
            <LinkIcon className="w-5 h-5 mr-2 text-indigo-500" /> Parent Portal Access
          </h3>
          <p className="text-sm text-gray-500 mb-4">
            Generate a one-time invite link. The parent verifies their phone number and gives consent before
            they can see this student's schedule, invoices, or payments.
          </p>
          <button
            onClick={handleCreateParentInvite}
            disabled={isCreatingInvite}
            className="text-sm text-white bg-indigo-600 px-3 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            {isCreatingInvite ? "Generating…" : "Generate invite link"}
          </button>
          {parentInvite && (
            <div className="mt-4 bg-indigo-50 border border-indigo-100 rounded-lg p-3 space-y-2">
              <p className="text-xs text-indigo-700">
                Expires {new Date(parentInvite.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
              </p>
              <div className="flex items-center gap-2">
                <input
                  readOnly
                  value={parentInvite.link}
                  onClick={(e) => (e.target as HTMLInputElement).select()}
                  className="flex-1 min-w-0 text-xs bg-white border border-indigo-200 rounded px-2 py-1.5 font-mono"
                />
                <button
                  onClick={() => { navigator.clipboard.writeText(parentInvite.link); }}
                  className="text-xs text-indigo-700 bg-white border border-indigo-200 px-2 py-1.5 rounded hover:bg-indigo-100"
                >
                  Copy
                </button>
              </div>
              <a
                href={`https://wa.me/?text=${encodeURIComponent(`Link your parent account to ${student.name || 'your child'}'s tuition profile: ${parentInvite.link}`)}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-block text-xs text-green-700 bg-white border border-green-200 px-2 py-1.5 rounded hover:bg-green-50"
              >
                Share via WhatsApp
              </a>
            </div>
          )}
        </div>

        {/* Student self-onboarding invite (Tech Debt #16): the only path a
            student account can claim this roster row and see their own
            sessions/attendance. Hidden once already claimed. */}
        <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
          <h3 className="text-md font-semibold text-gray-900 mb-1 flex items-center">
            <LinkIcon className="w-5 h-5 mr-2 text-indigo-500" /> Student Portal Access
          </h3>
          {student.studentUserId ? (
            <p className="text-sm text-gray-500">This student already has a portal account linked.</p>
          ) : (
            <>
              <p className="text-sm text-gray-500 mb-4">
                Generate a one-time invite link so the student can create their own account and see
                their schedule, attendance, and materials.
              </p>
              <button
                onClick={handleCreateStudentInvite}
                disabled={isCreatingStudentInvite}
                className="text-sm text-white bg-indigo-600 px-3 py-1.5 rounded hover:bg-indigo-700 disabled:opacity-50"
              >
                {isCreatingStudentInvite ? "Generating…" : "Generate invite link"}
              </button>
              {studentInvite && (
                <div className="mt-4 bg-indigo-50 border border-indigo-100 rounded-lg p-3 space-y-2">
                  <p className="text-xs text-indigo-700">
                    Expires {new Date(studentInvite.expiresAt).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })}
                  </p>
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={studentInvite.link}
                      onClick={(e) => (e.target as HTMLInputElement).select()}
                      className="flex-1 min-w-0 text-xs bg-white border border-indigo-200 rounded px-2 py-1.5 font-mono"
                    />
                    <button
                      onClick={() => { navigator.clipboard.writeText(studentInvite.link); }}
                      className="text-xs text-indigo-700 bg-white border border-indigo-200 px-2 py-1.5 rounded hover:bg-indigo-100"
                    >
                      Copy
                    </button>
                  </div>
                  <a
                    href={`https://wa.me/?text=${encodeURIComponent(`Set up your student account: ${studentInvite.link}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-block text-xs text-green-700 bg-white border border-green-200 px-2 py-1.5 rounded hover:bg-green-50"
                  >
                    Share via WhatsApp
                  </a>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );

  const renderAcademicTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">Academic Performance & Progress</h2>
        <div className="flex space-x-3">
          <button onClick={() => setIsAssessmentModalOpen(true)} className="flex items-center text-sm text-white bg-indigo-600 px-3 py-1.5 rounded hover:bg-indigo-700">
            <Plus className="w-4 h-4 mr-1" /> Add Assessment
          </button>
          <button onClick={generateProgressReport} className="flex items-center text-sm text-gray-700 bg-white border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50">
            <Download className="w-4 h-4 mr-1" /> Progress Report
          </button>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
          <h3 className="text-md font-semibold text-gray-900 flex items-center">
            <Award className="w-5 h-5 mr-2 text-indigo-500" /> Assessment History
          </h3>
        </div>
        <div className="p-0">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Score</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Comments</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {assessments.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-6 py-12 text-center">
                    <FileText className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                    <p className="text-sm font-medium text-gray-900">No assessments found</p>
                    <p className="text-sm text-gray-500 mt-1">This student doesn't have any recorded assessments.</p>
                  </td>
                </tr>
              ) : (
                assessments.map(assessment => {
                  const percentage = Math.round((assessment.score / (assessment.totalScore || assessment.maxScore || 100)) * 100);
                  return (
                    <tr key={assessment.id} className="hover:bg-gray-50 transition-colors duration-150">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{new Date(assessment.date).toLocaleDateString()}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-indigo-100 text-indigo-800">
                          {assessment.type}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        <div className="flex items-center">
                          <span className={`font-medium ${percentage >= 80 ? 'text-green-600' : percentage >= 60 ? 'text-yellow-600' : 'text-red-600'}`}>
                            {assessment.score} / {assessment.totalScore || assessment.maxScore} ({percentage}%)
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                        {assessment.feedback || assessment.comments || '-'}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );

  const renderScheduleTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">Class & Schedule Management</h2>
        <div className="flex space-x-3">
          <button onClick={() => navigate('/app/calendar')} className="flex items-center text-sm text-gray-700 bg-white border border-gray-300 px-3 py-1.5 rounded hover:bg-gray-50">
            <Calendar className="w-4 h-4 mr-1" /> Full Calendar
          </button>
          <button className="flex items-center text-sm text-white bg-indigo-600 px-3 py-1.5 rounded hover:bg-indigo-700">
            <Plus className="w-4 h-4 mr-1" /> Schedule Class
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Upcoming Classes */}
        <div className="md:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50">
            <h3 className="text-md font-semibold text-gray-900 flex items-center">
              <Clock className="w-5 h-5 mr-2 text-indigo-500" /> Class Calendar & Attendance
            </h3>
          </div>
          <div className="p-0">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date & Time</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Attendance</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center">
                      <Calendar className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                      <p className="text-sm font-medium text-gray-900">No sessions found</p>
                      <p className="text-sm text-gray-500 mt-1">This student doesn't have any class sessions yet.</p>
                    </td>
                  </tr>
                ) : (
                  sessions.map(session => (
                    <tr key={session.id} className="hover:bg-gray-50 transition-colors duration-150">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
                        {new Date(session.startTime).toLocaleDateString()} <br/> 
                        <span className="text-gray-500 text-xs">
                          {new Date(session.startTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})} - 
                          {new Date(session.endTime).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'})}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{student.subject}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${session.status === 'completed' ? 'bg-green-100 text-green-800' : 'bg-blue-100 text-blue-800'}`}>
                          {session.status || 'Scheduled'}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <select 
                          className="border border-gray-300 rounded text-xs py-1 px-2 focus:ring-indigo-500 focus:border-indigo-500"
                          defaultValue={session.status || ''}
                          onChange={(e) => {
                            supabase.from("class_sessions").update({ status: e.target.value }).eq("id", session.id).then(({ error }) => {
                              if (error) console.error("Error updating session status:", error);
                            });
                          }}
                        >
                          <option value="" disabled>Mark...</option>
                          <option value="completed">Completed</option>
                          <option value="no_show">No Show</option>
                          <option value="cancelled">Cancelled</option>
                        </select>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Setup & Groups */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-md font-semibold text-gray-900 mb-4">Recurring Class Setup</h3>
            <div className="space-y-3">
              <p className="text-sm text-gray-500">Set up automatic scheduling for this student.</p>
              <button className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                Configure Schedule
              </button>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-md font-semibold text-gray-900 mb-4">Group Class Enrollment</h3>
            <div className="space-y-4">
              {classInstances.filter(b => b.studentIds?.includes(id)).length > 0 ? (
                <div className="space-y-2">
                  <p className="text-sm font-medium text-gray-700">Enrolled Group Classes:</p>
                  {classInstances.filter(b => b.studentIds?.includes(id)).map(batch => (
                    <div key={batch.id} className="flex items-center justify-between p-2 bg-gray-50 rounded border border-gray-100">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{batch.name || batch.type}</p>
                        <p className="text-xs text-gray-500">{batch.subject} • {batch.grade}</p>
                      </div>
                      <button
                        onClick={async () => {
                          try {
                            const updatedStudentIds = batch.studentIds.filter((sId: string) => sId !== id);
                            const { error } = await supabase
                              .from("class_templates")
                              .update({ student_ids: updatedStudentIds })
                              .eq("id", batch.id);
                            if (error) throw error;
                          } catch (error: any) {
                            console.error("Supabase Error: ", JSON.stringify({
                              error: error.message,
                              operationType: "update",
                              path: `class_templates/${batch.id}`
                            }));
                          }
                        }}
                        className="text-xs text-red-600 hover:text-red-800"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-gray-500">Not enrolled in any group batches.</p>
              )}
              <button 
                onClick={() => {
                  const available = classInstances.filter(b => 
                    !b.studentIds?.includes(id) && 
                    b.grade === student.grade && 
                    b.subject === student.subject
                  );
                  setAvailableClassInstances(available);
                  setIsInstanceModalOpen(true);
                }}
                className="w-full flex items-center justify-center px-4 py-2 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700"
              >
                Join Group
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );

  const renderFinancialTab = () => (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-lg font-semibold text-gray-900">Financial & Transactional Module</h2>
        <button onClick={() => navigate('/app/invoices')} className="flex items-center text-sm text-white bg-indigo-600 px-3 py-1.5 rounded hover:bg-indigo-700">
          <Plus className="w-4 h-4 mr-1" /> Generate Invoice
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Fee Structure & Wallet */}
        <div className="space-y-6">
          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <div className="flex justify-between items-center mb-4">
              <h3 className="text-md font-semibold text-gray-900 flex items-center">
                <CreditCard className="w-5 h-5 mr-2 text-indigo-500" /> Fee Structure
              </h3>
              <button className="text-indigo-600 hover:text-indigo-800 text-sm"><Edit2 className="w-4 h-4"/></button>
            </div>
            <div className="space-y-3">
              <div>
                <p className="text-sm font-medium text-gray-500">Plan Type</p>
                <p className="text-base text-gray-900 capitalize">{student.feeStructure || 'Not set'}</p>
              </div>
              <div>
                <p className="text-sm font-medium text-gray-500">Amount</p>
                <p className="text-2xl font-bold text-gray-900">${student.feeAmount || '0'}</p>
              </div>
            </div>
          </div>

          <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
            <h3 className="text-md font-semibold text-gray-900 mb-4 flex items-center">
              <DollarSign className="w-5 h-5 mr-2 text-green-500" /> Wallet / Credits
            </h3>
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm text-gray-500">Available Credits</span>
                <span className="text-xl font-bold text-gray-900">{student.credits || 0}</span>
              </div>
              <button className="w-full flex items-center justify-center px-4 py-2 border border-gray-300 shadow-sm text-sm font-medium rounded-md text-gray-700 bg-white hover:bg-gray-50">
                Add Credits
              </button>
            </div>
          </div>
        </div>

        {/* Payment History */}
        <div className="md:col-span-2 bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 bg-gray-50 flex justify-between items-center">
            <h3 className="text-md font-semibold text-gray-900">Payment History & Invoices</h3>
            <span className="text-sm text-gray-500">Auto-invoicing: <span className="text-green-600 font-medium">Enabled</span></span>
          </div>
          <div className="p-0">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Amount</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Status</th>
                  <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Receipt</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {invoices.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="px-6 py-12 text-center">
                      <DollarSign className="mx-auto h-12 w-12 text-gray-300 mb-3" />
                      <p className="text-sm font-medium text-gray-900">No invoices found</p>
                      <p className="text-sm text-gray-500 mt-1">This student doesn't have any billing history.</p>
                    </td>
                  </tr>
                ) : (
                  invoices.map(inv => (
                    <tr key={inv.id} className="hover:bg-gray-50 transition-colors duration-150">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">{inv.dueDate}</td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm font-medium text-gray-900">${inv.amount}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${inv.status === 'paid' ? 'bg-green-100 text-green-800' : inv.status === 'overdue' ? 'bg-red-100 text-red-800' : 'bg-yellow-100 text-yellow-800'}`}>
                          {inv.status}
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                        <button className="text-indigo-600 hover:text-indigo-900">Download PDF</button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );

  const renderCommunicationsTab = () => (
    <div className="space-y-6">
      <div className="bg-white p-6 rounded-xl shadow-sm border border-gray-100">
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-lg font-semibold text-gray-900 flex items-center">
            <MessageSquare className="w-5 h-5 mr-2 text-indigo-500" />
            Communication History
          </h3>
          <button 
            onClick={() => navigate("/messaging")}
            className="flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            New Message
          </button>
        </div>
        
        <div className="text-center py-12 bg-gray-50 rounded-lg border border-dashed border-gray-300">
          <MessageSquare className="w-12 h-12 text-gray-400 mx-auto mb-3" />
          <h3 className="text-lg font-medium text-gray-900">No communications yet</h3>
          <p className="text-gray-500 mt-1">Start a conversation with this student or their parents.</p>
          <button 
            onClick={() => navigate("/messaging")}
            className="mt-4 inline-flex items-center px-4 py-2 border border-transparent text-sm font-medium rounded-md shadow-sm text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500"
          >
            Send Message
          </button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center space-x-4">
          <button 
            onClick={() => navigate("/students")}
            className="p-2 hover:bg-gray-100 rounded-full transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex items-center space-x-3">
            <div className="w-12 h-12 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600">
              <User className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">{student.name}</h1>
              <span className="px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                {student.status || 'Active'}
              </span>
            </div>
          </div>
        </div>
        <div className="flex space-x-3">
          <button 
            onClick={() => navigate("/messaging")}
            className="flex items-center px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Message
          </button>
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-gray-200">
        <nav className="-mb-px flex space-x-8">
          <button
            onClick={() => setActiveTab('profile')}
            className={`${
              activeTab === 'profile'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <User className="w-4 h-4 mr-2" />
            Profile
          </button>
          <button
            onClick={() => setActiveTab('academic')}
            className={`${
              activeTab === 'academic'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <Award className="w-4 h-4 mr-2" />
            Academic
          </button>
          <button
            onClick={() => setActiveTab('schedule')}
            className={`${
              activeTab === 'schedule'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <Calendar className="w-4 h-4 mr-2" />
            Class & Schedule
          </button>
          <button
            onClick={() => setActiveTab('financial')}
            className={`${
              activeTab === 'financial'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <DollarSign className="w-4 h-4 mr-2" />
            Financial & Transactions
          </button>
          <button
            onClick={() => setActiveTab('communications')}
            className={`${
              activeTab === 'communications'
                ? 'border-indigo-500 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
            } whitespace-nowrap py-4 px-1 border-b-2 font-medium text-sm flex items-center`}
          >
            <MessageSquare className="w-4 h-4 mr-2" />
            Communications
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      <div className="mt-6">
        {activeTab === 'profile' && renderProfileTab()}
        {activeTab === 'academic' && renderAcademicTab()}
        {activeTab === 'schedule' && renderScheduleTab()}
        {activeTab === 'financial' && renderFinancialTab()}
        {activeTab === 'communications' && renderCommunicationsTab()}
      </div>

      {/* Add Assessment Modal */}
      {isAssessmentModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75" onClick={() => setIsAssessmentModalOpen(false)}></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-50 inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleSaveAssessment}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <div className="flex justify-between items-center mb-4">
                    <h3 className="text-lg leading-6 font-medium text-gray-900">Add Assessment</h3>
                    <button type="button" onClick={() => setIsAssessmentModalOpen(false)} className="text-gray-400 hover:text-gray-500">
                      <X className="w-5 h-5" />
                    </button>
                  </div>
                  
                  <div className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Type</label>
                        <select 
                          required
                          value={assessmentType}
                          onChange={(e) => setAssessmentType(e.target.value)}
                          className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                        >
                          <option value="Quiz">Quiz</option>
                          <option value="Test">Test</option>
                          <option value="Homework">Homework</option>
                          <option value="Project">Project</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Date</label>
                        <input 
                          type="date" 
                          required
                          value={assessmentDate}
                          onChange={(e) => setAssessmentDate(e.target.value)}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" 
                        />
                      </div>
                    </div>
                    
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Score</label>
                        <input 
                          type="number" 
                          required
                          min="0"
                          step="0.1"
                          value={assessmentScore}
                          onChange={(e) => setAssessmentScore(e.target.value)}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" 
                        />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Max Score</label>
                        <input 
                          type="number" 
                          required
                          min="1"
                          step="0.1"
                          value={assessmentMaxScore}
                          onChange={(e) => setAssessmentMaxScore(e.target.value)}
                          className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" 
                        />
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-medium text-gray-700">Tutor Comments</label>
                      <textarea 
                        rows={3}
                        value={assessmentComments}
                        onChange={(e) => setAssessmentComments(e.target.value)}
                        className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" 
                        placeholder="Add feedback or notes..."
                      />
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button
                    type="submit"
                    className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    Save Assessment
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsAssessmentModalOpen(false)}
                    className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                  >
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Join Group Class Modal */}
      {isInstanceModalOpen && (
        <div className="fixed inset-0 z-50 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75" onClick={() => setIsInstanceModalOpen(false)}></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-50 inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">Join Group Class</h3>
                  <button onClick={() => setIsInstanceModalOpen(false)} className="text-gray-400 hover:text-gray-500">
                    <X className="w-5 h-5" />
                  </button>
                </div>
                
                <div className="space-y-4">
                  <p className="text-sm text-gray-500">
                    Showing available group classes for <strong>{student.grade}</strong> - <strong>{student.subject}</strong>.
                  </p>
                  {availableClassInstances.length > 0 ? (
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Select Class</label>
                      <select 
                        value={selectedInstanceId} 
                        onChange={(e) => setSelectedInstanceId(e.target.value)}
                        className="mt-1 block w-full pl-3 pr-10 py-2 text-base border-gray-300 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm rounded-md"
                      >
                        <option value="">-- Select a class --</option>
                        {availableClassInstances.map(batch => (
                          <option key={batch.id} value={batch.id}>{batch.name || batch.type}</option>
                        ))}
                      </select>
                    </div>
                  ) : (
                    <div className="bg-yellow-50 border border-yellow-200 p-4 rounded-md">
                      <p className="text-sm text-yellow-800">No available group classes found matching the student's grade and subject.</p>
                    </div>
                  )}

                  <button
                    onClick={async () => {
                      if (!selectedInstanceId || !id) return;
                      try {
                        const batch = availableClassInstances.find(b => b.id === selectedInstanceId);
                        if (batch) {
                          const updatedStudentIds = [...(batch.studentIds || []), id];
                          const { error } = await supabase
                            .from("class_templates")
                            .update({ student_ids: updatedStudentIds })
                            .eq("id", batch.id);
                          if (error) throw error;
                          setIsInstanceModalOpen(false);
                          setSelectedInstanceId("");
                        }
                      } catch (error: any) {
                        console.error("Supabase Error: ", JSON.stringify({
                          error: error.message,
                          operationType: "update",
                          path: `class_templates/${selectedInstanceId}`
                        }));
                      }
                    }}
                    disabled={!selectedInstanceId}
                    className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
                  >
                    Enroll Student
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

    </div>
  );
}
