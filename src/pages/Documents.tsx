import React, { useState, useEffect } from "react";
import { Upload, FileText, Download, Trash2 } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { uploadDocument, getDocumentUrl, deleteDocument } from "../lib/api";
import { debounce } from "../lib/debounce";
import { toast } from "sonner";

import LoadingSpinner from "../components/LoadingSpinner";
import { Modal } from "../components/kit";

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
      .on("postgres_changes", { event: "*", schema: "public", table: "students", filter: `organization_id=eq.${user.organizationId}` }, debounce(loadStudents, 200))
      .subscribe();
    const docsChannel = supabase
      .channel(`documents-${user.organizationId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "documents", filter: `organization_id=eq.${user.organizationId}` }, debounce(loadDocs, 200))
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
        <h1 className="text-2xl font-bold text-[var(--cs-text)]">Library</h1>
        <button
          onClick={() => setIsModalOpen(true)}
          className="flex items-center rounded-[6px] bg-[var(--cs-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity"
        >
          <Upload className="w-4 h-4 mr-2" />
          Upload Document
        </button>
      </div>

      {/* Data Table */}
      <div className="bg-[var(--cs-surface)] rounded-[10px] border border-[var(--cs-border)] overflow-hidden">
        <div className="overflow-x-auto" tabIndex={0} role="region" aria-label="Documents table">
          <table className="min-w-full divide-y divide-[var(--cs-border)]">
            <thead className="bg-[var(--cs-bg)]">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--cs-text-muted)] uppercase tracking-wider">File Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--cs-text-muted)] uppercase tracking-wider">Student</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--cs-text-muted)] uppercase tracking-wider">Category</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-[var(--cs-text-muted)] uppercase tracking-wider">Date</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-[var(--cs-text-muted)] uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-[var(--cs-surface)] divide-y divide-[var(--cs-border)]">
              {loading ? (
                <tr><td colSpan={5} className="px-6 py-12"><LoadingSpinner message="Loading documents..." /></td></tr>
              ) : documents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <FileText className="mx-auto h-12 w-12 text-[var(--cs-border)]" />
                    <h3 className="mt-2 text-sm font-medium text-[var(--cs-text)]">No documents found</h3>
                    <p className="mt-1 text-sm text-[var(--cs-text-muted)]">Upload documents to share with your students.</p>
                  </td>
                </tr>
              ) : (
                documents.map((doc) => (
                  <tr key={doc.id} className="hover:bg-[var(--cs-bg)] transition-colors duration-150">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center">
                        <FileText className="w-5 h-5 text-[var(--cs-text-muted)] mr-2" />
                        <div className="text-sm font-medium text-[var(--cs-text)]">{doc.fileName}</div>
                      </div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--cs-text-muted)]">
                      {getStudentName(doc.studentId)}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-[var(--cs-bg)] text-[var(--cs-text-muted)]">
                        {doc.category}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-[var(--cs-text-muted)]">
                      {new Date(doc.createdAt?.toDate ? doc.createdAt.toDate() : doc.createdAt).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button onClick={() => handleDownload(doc.id)} className="text-[var(--cs-accent)] hover:opacity-80 mr-4 inline-block">
                        <Download className="w-4 h-4" />
                      </button>
                      <button onClick={() => confirmDelete(doc.id)} className="text-[var(--cs-danger)] hover:opacity-80">
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
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={() => setIsModalOpen(false)}>
          <Modal
            onClose={() => setIsModalOpen(false)}
            labelledBy="upload-document-title"
            className="w-full max-w-lg rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] text-left overflow-hidden shadow-xl"
          >
            <form onSubmit={handleSubmit}>
              <div className="px-5 py-4">
                <h3 id="upload-document-title" className="text-lg font-semibold text-[var(--cs-text)] mb-4">Upload Document</h3>
                {uploadError && (
                  <div className="mb-4 p-3 bg-red-50 text-[var(--cs-danger)] text-sm rounded-[6px] border border-red-200">
                    {uploadError}
                  </div>
                )}
                <div className="space-y-4">
                  <div>
                    <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Student</label>
                    <select required value={studentId} onChange={e => setStudentId(e.target.value)} className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]">
                      <option value="" disabled>Select a student</option>
                      {students.map(s => (
                        <option key={s.id} value={s.id}>{s.name}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Category</label>
                    <select required value={category} onChange={e => setCategory(e.target.value)} className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]">
                      <option value="homework">Homework</option>
                      <option value="notes">Notes</option>
                      <option value="tests">Tests</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--cs-text-muted)]">File</label>
                    <input type="file" required onChange={e => setFile(e.target.files?.[0] || null)} className="mt-1 block w-full text-sm text-[var(--cs-text-muted)] file:mr-4 file:py-2 file:px-4 file:rounded-[6px] file:border-0 file:text-sm file:font-semibold file:bg-[var(--cs-accent-soft)] file:text-[var(--cs-accent)] hover:file:opacity-90" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Notes (Optional)</label>
                    <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={3} className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]" />
                  </div>
                </div>
              </div>
              <div className="border-t border-[var(--cs-border)] px-5 py-4 flex justify-end gap-2">
                <button type="button" onClick={() => setIsModalOpen(false)} className="rounded-[6px] border border-[var(--cs-border)] px-4 py-2 text-sm font-medium text-[var(--cs-text)] hover:bg-[var(--cs-bg)]">
                  Cancel
                </button>
                <button type="submit" className="rounded-[6px] bg-[var(--cs-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90">
                  Upload
                </button>
              </div>
            </form>
          </Modal>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {isDeleteModalOpen && (
        <div className="fixed inset-0 z-20 flex items-center justify-center bg-black/40 p-4" onClick={() => setIsDeleteModalOpen(false)}>
          <Modal
            onClose={() => setIsDeleteModalOpen(false)}
            labelledBy="modal-title"
            className="w-full max-w-lg rounded-[10px] border border-[var(--cs-border)] bg-[var(--cs-surface)] text-left overflow-hidden shadow-xl"
          >
            <div className="px-5 py-4">
              <div className="sm:flex sm:items-start">
                <div className="mx-auto flex-shrink-0 flex items-center justify-center h-10 w-10 rounded-full bg-red-50 sm:mx-0">
                  <Trash2 className="h-5 w-5 text-[var(--cs-danger)]" aria-hidden="true" />
                </div>
                <div className="mt-3 text-center sm:mt-0 sm:ml-4 sm:text-left">
                  <h3 className="text-lg font-semibold text-[var(--cs-text)]" id="modal-title">
                    Delete Document
                  </h3>
                  <div className="mt-2">
                    <p className="text-sm text-[var(--cs-text-muted)]">
                      Are you sure you want to delete this document? This action cannot be undone.
                    </p>
                  </div>
                </div>
              </div>
            </div>
            <div className="border-t border-[var(--cs-border)] px-5 py-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setIsDeleteModalOpen(false)}
                className="rounded-[6px] border border-[var(--cs-border)] px-4 py-2 text-sm font-medium text-[var(--cs-text)] hover:bg-[var(--cs-bg)]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDelete}
                className="rounded-[6px] bg-[var(--cs-danger)] px-4 py-2 text-sm font-medium text-white hover:opacity-90"
              >
                Delete
              </button>
            </div>
          </Modal>
        </div>
      )}
    </div>
  );
}
