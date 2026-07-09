import React, { useState, useEffect } from "react";
import { Upload, FileText, Download, Trash2 } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { uploadDocument, getDocumentUrl, deleteDocument } from "../lib/api";
import { toast } from "sonner";

import LoadingSpinner from "../components/LoadingSpinner";

// NOTE: uploadDocument / getDocumentUrl / deleteDocument (from ../lib/api) call
// the server, which is the one that talks to Firebase/Cloud Storage for the
// actual file bytes (see the comment above handleSubmit). This file has no
// direct Firebase Storage SDK calls (no uploadBytes/getDownloadURL/ref) — only
// the Firestore "documents" collection listeners below needed migrating.

const DOCUMENT_SELECT =
  "id, organizationId:organization_id, studentId:student_id, fileName:name, category, createdAt:created_at, uploadedByUserId:uploaded_by_user_id";

export default function Documents() {
  const { user } = useAuth();
  const [documents, setDocuments] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Form state
  const [studentId, setStudentId] = useState("");
  const [category, setCategory] = useState("homework");
  const [notes, setNotes] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [isDeleteModalOpen, setIsDeleteModalOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState("");

  useEffect(() => {
    if (!user || !user.organizationId) return;

    let cancelled = false;

    const loadStudents = async () => {
      let studentsQuery = supabase
        .from("students")
        .select("*")
        .eq("organization_id", user.organizationId)
        .limit(100);
      if (user.role === 'tutor') studentsQuery = studentsQuery.eq("tutor_id", user.id);
      const { data, error } = await studentsQuery;
      if (cancelled) return;
      if (error) console.error("Supabase Error (Students): ", error);
      else setStudents(data || []);
    };

    // documents has no tutor_id column; for a tutor we scope to documents
    // they uploaded (uploaded_by_user_id) as the closest equivalent to the
    // old Firestore tutorId filter.
    const loadDocs = async () => {
      let docsQuery = supabase
        .from("documents")
        .select(DOCUMENT_SELECT)
        .eq("organization_id", user.organizationId)
        .limit(100);
      if (user.role === 'tutor') docsQuery = docsQuery.eq("uploaded_by_user_id", user.id);
      const { data, error } = await docsQuery;
      if (cancelled) return;
      if (error) console.error("Supabase Error (Documents): ", error);
      else setDocuments(data || []);
      setLoading(false);
    };

    loadStudents();
    loadDocs();

    const studentsChannel = supabase
      .channel(`documents-students-${user.organizationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "students", filter: `organization_id=eq.${user.organizationId}` }, loadStudents)
      .subscribe();
    const docsChannel = supabase
      .channel(`documents-${user.organizationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "documents", filter: `organization_id=eq.${user.organizationId}` }, loadDocs)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(studentsChannel);
      supabase.removeChannel(docsChannel);
    };
  }, [user]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError("");
    if (!file || !user || !user.organizationId) return;

    if (file.size > 5 * 1024 * 1024) {
      setUploadError("File size must be less than 5MB.");
      return;
    }

    try {
      // Uploads to Cloud Storage via the server, which sniffs the real file
      // signature and sanitizes the filename before it lands in storage
      // (DEV_PLAN E3.9). No local base64-into-Firestore path anymore.
      await uploadDocument({ file, studentId, category, notes });
      setIsModalOpen(false);
      setStudentId(""); setCategory("homework"); setNotes(""); setFile(null);
    } catch (error: any) {
      setUploadError(error.message || "Upload failed");
    }
  };

  const confirmDelete = (id: string) => {
    setDocToDelete(id);
    setIsDeleteModalOpen(true);
  };

  const handleDelete = async () => {
    if (!docToDelete) return;
    try {
      await deleteDocument(docToDelete);
      setIsDeleteModalOpen(false);
      setDocToDelete(null);
    } catch (error: any) {
      toast.error("Could not delete document", { description: error.message });
    }
  };

  const handleDownload = async (documentId: string) => {
    try {
      const { url } = await getDocumentUrl(documentId);
      window.open(url, "_blank", "noopener,noreferrer");
    } catch (error: any) {
      toast.error("Could not open document", { description: error.message });
    }
  };

  const getStudentName = (id: string) => {
    const student = students.find(s => s.id === id);
    return student ? student.name : "Unknown Student";
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Library</h1>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
        >
          <Upload className="w-4 h-4 mr-2" />
          Upload Document
        </button>
      </div>

      {/* Data Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">File Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Student</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr><td colSpan={5} className="px-6 py-12"><LoadingSpinner message="Loading documents..." /></td></tr>
              ) : documents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <FileText className="mx-auto h-12 w-12 text-gray-300" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No documents found</h3>
                    <p className="mt-1 text-sm text-gray-500">Upload documents to share with your students.</p>
                  </td>
                </tr>
              ) : (
                documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-gray-50 transition-colors duration-150">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <FileText className="w-5 h-5 text-gray-400 mr-2" />
                        <div className="text-sm font-medium text-gray-900">{doc.fileName}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {getStudentName(doc.studentId)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-gray-100 text-gray-800">
                        {doc.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      {new Date(doc.createdAt?.toDate ? doc.createdAt.toDate() : doc.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button onClick={() => handleDownload(doc.id)} className="text-indigo-600 hover:text-indigo-900 mr-4 inline-block">
                        <Download className="w-4 h-4" />
                      </button>
                      <button onClick={() => confirmDelete(doc.id)} className="text-red-600 hover:text-red-900">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Upload Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75" onClick={() => setIsModalOpen(false)}></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-20 inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleSubmit}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                  <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">Upload Document</h3>
                  {uploadError && (
                    <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-md border border-red-200">
                      {uploadError}
                    </div>
                  )}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Student</label>
                      <select required value={studentId} onChange={e => setStudentId(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                        <option value="" disabled>Select a student</option>
                        {students.map(s => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Category</label>
                      <select required value={category} onChange={e => setCategory(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                        <option value="homework">Homework</option>
                        <option value="notes">Notes</option>
                        <option value="tests">Tests</option>
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">File</label>
                      <input type="file" required onChange={e => setFile(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4 file:rounded-md file:border-0 file:text-sm file:font-semibold file:bg-indigo-50 file:text-indigo-700 hover:file:bg-indigo-100" />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Notes (Optional)</label>
                      <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button type="submit" className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm">
                    Upload
                  </button>
                  <button type="button" onClick={() => setIsModalOpen(false)} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75" onClick={() => setIsDeleteModalOpen(false)}></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-20 inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4">
                <div className="sm:flex sm:items-start">
                  <div className="mx-auto flex-shrink-0 flex items-center justify-center h-12 w-12 rounded-full bg-red-100 sm:mx-0 sm:h-10 sm:w-10">
                    <Trash2 className="h-6 w-6 text-red-600" aria-hidden="true" />
                  </div>
                  <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                    <h3 className="text-lg leading-6 font-medium text-gray-900" id="modal-title">
                      Delete Document
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Are you sure you want to delete this document? This action cannot be undone.
                      </p>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button
                  type="button"
                  onClick={handleDelete}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setIsDeleteModalOpen(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
