import React, { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, Edit2, Trash2, Users, FileText, Upload, Download } from "lucide-react";
import { collection, query, where, onSnapshot, addDoc, updateDoc, deleteDoc, doc } from "firebase/firestore";
import { db } from "../firebase";
import { useAuth } from "../context/AuthContext";

import LoadingSpinner from "../components/LoadingSpinner";

export default function Students() {
  const { user } = useAuth();
  const [students, setStudents] = useState<any[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);

  // Documents state
  const [isDocsModalOpen, setIsDocsModalOpen] = useState(false);
  const [selectedStudentForDocs, setSelectedStudentForDocs] = useState<any>(null);
  const [studentDocs, setStudentDocs] = useState<any[]>([]);
  const [docFile, setDocFile] = useState<File | null>(null);
  const [docCategory, setDocCategory] = useState("homework");
  const [docNotes, setDocNotes] = useState("");
  const [docsUnsubscribe, setDocsUnsubscribe] = useState<(() => void) | null>(null);
  const [uploadError, setUploadError] = useState("");

  // Form state
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [feeStructure, setFeeStructure] = useState("hourly");
  const [feeAmount, setFeeAmount] = useState("");
  const [parentName, setParentName] = useState("");
  const [parentEmail, setParentEmail] = useState("");
  const [parentPhone, setParentPhone] = useState("");
  const [studentEmail, setStudentEmail] = useState("");
  const [studentPhone, setStudentPhone] = useState("");
  const [address, setAddress] = useState("");
  const [emergencyContactName, setEmergencyContactName] = useState("");
  const [emergencyContactPhone, setEmergencyContactPhone] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [successMessage, setSuccessMessage] = useState("");
  const [formError, setFormError] = useState("");

  const [isDeleteStudentModalOpen, setIsDeleteStudentModalOpen] = useState(false);
  const [studentToDelete, setStudentToDelete] = useState<string | null>(null);

  const [isDeleteDocModalOpen, setIsDeleteDocModalOpen] = useState(false);
  const [docToDelete, setDocToDelete] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [filterGrade, setFilterGrade] = useState("All Grades");

  const filteredStudents = students.filter(student => {
    const matchesSearch = student.name.toLowerCase().includes(searchQuery.toLowerCase()) || 
                          (student.parentName && student.parentName.toLowerCase().includes(searchQuery.toLowerCase()));
    const matchesGrade = filterGrade === "All Grades" || student.grade === filterGrade;
    return matchesSearch && matchesGrade;
  });

  // Get unique grades for the filter dropdown
  const uniqueGrades = Array.from(new Set(students.map(s => s.grade).filter(Boolean)));

  useEffect(() => {
    if (!user || !user.organizationId) return;
    
    const q = query(
      collection(db, "students"), 
      where("organizationId", "==", user.organizationId),
      ...(user.role === 'tutor' ? [where("tutorId", "==", user.id)] : [])
    );
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const studentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStudents(studentsData);
      setLoading(false);
    }, (error) => {
      console.error("Firestore Error: ", JSON.stringify({
        error: error.message,
        operationType: "list",
        path: "students"
      }));
    });

    return () => unsubscribe();
  }, [user]);

  const fetchStudentDocs = (studentId: string) => {
    if (!user || !user.organizationId) return;
    
    if (docsUnsubscribe) {
      docsUnsubscribe();
    }

    const docsConstraints = [
      where("studentId", "==", studentId),
      where("organizationId", "==", user.organizationId)
    ];
    if (user.role === 'tutor') docsConstraints.push(where("tutorId", "==", user.id));
    const q = query(collection(db, "documents"), ...docsConstraints);
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const docsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setStudentDocs(docsData);
    }, (error) => {
      console.error("Firestore Error: ", JSON.stringify({
        error: error.message,
        operationType: "list",
        path: "documents"
      }));
    });
    
    setDocsUnsubscribe(() => unsubscribe);
  };

  const closeDocsModal = () => {
    setIsDocsModalOpen(false);
    setSelectedStudentForDocs(null);
    setStudentDocs([]);
    setDocFile(null);
    setDocNotes("");
    if (docsUnsubscribe) {
      docsUnsubscribe();
      setDocsUnsubscribe(null);
    }
  };

  const handleViewDocs = (student: any) => {
    setSelectedStudentForDocs(student);
    fetchStudentDocs(student.id);
    setIsDocsModalOpen(true);
    setDocFile(null);
    setDocCategory("homework");
    setDocNotes("");
  };

  const handleUploadDoc = async (e: React.FormEvent) => {
    e.preventDefault();
    setUploadError("");
    if (!docFile || !selectedStudentForDocs || !user || !user.organizationId) return;

    if (docFile.size > 1048576) { // 1MB limit for Firestore
      setUploadError("File size must be less than 1MB.");
      return;
    }

    try {
      const reader = new FileReader();
      reader.onloadend = async () => {
        const fileUrl = reader.result as string;

        await addDoc(collection(db, "documents"), {
          organizationId: user.organizationId,
          tutorId: user.id,
          studentId: selectedStudentForDocs.id,
          fileName: docFile.name,
          fileUrl,
          category: docCategory,
          notes: docNotes,
          uploadedBy: user.id,
          createdAt: new Date().toISOString()
        });
        
        setDocFile(null);
        setDocCategory("homework");
        setDocNotes("");
      };
      reader.readAsDataURL(docFile);
    } catch (error: any) {
      console.error("Firestore Error: ", JSON.stringify({
        error: error.message,
        operationType: "create",
        path: "documents"
      }));
    }
  };

  const confirmDeleteDoc = (id: string) => {
    setDocToDelete(id);
    setIsDeleteDocModalOpen(true);
  };

  const handleDeleteDoc = async () => {
    if (!docToDelete) return;
    try {
      await deleteDoc(doc(db, "documents", docToDelete));
      setIsDeleteDocModalOpen(false);
      setDocToDelete(null);
    } catch (error: any) {
      console.error("Firestore Error: ", JSON.stringify({
        error: error.message,
        operationType: "delete",
        path: "documents"
      }));
    }
  };

  const resetForm = () => {
    setName("");
    setGrade("");
    setSubject("");
    setFeeStructure("hourly");
    setFeeAmount("");
    setParentName("");
    setParentEmail("");
    setParentPhone("");
    setStudentEmail("");
    setStudentPhone("");
    setAddress("");
    setEmergencyContactName("");
    setEmergencyContactPhone("");
    setEditingId(null);
  };

  const handleEdit = (student: any) => {
    setEditingId(student.id);
    setName(student.name);
    setGrade(student.grade);
    setSubject(student.subject);
    setFeeStructure(student.feeStructure || "hourly");
    setFeeAmount(student.feeAmount !== undefined && student.feeAmount !== null ? student.feeAmount.toString() : "");
    setParentName(student.parentName || "");
    setParentEmail(student.parentEmail || "");
    setParentPhone(student.parentPhone || "");
    setStudentEmail(student.studentEmail || "");
    setStudentPhone(student.studentPhone || "");
    setAddress(student.address || "");
    setEmergencyContactName(student.emergencyContactName || "");
    setEmergencyContactPhone(student.emergencyContactPhone || "");
    setIsModalOpen(true);
  };

  const confirmDeleteStudent = (id: string) => {
    setStudentToDelete(id);
    setIsDeleteStudentModalOpen(true);
  };

  const handleDelete = async () => {
    if (!studentToDelete) return;
    try {
      await deleteDoc(doc(db, "students", studentToDelete));
      setIsDeleteStudentModalOpen(false);
      setStudentToDelete(null);
    } catch (error: any) {
      console.error("Firestore Error: ", JSON.stringify({
        error: error.message,
        operationType: "delete",
        path: "students"
      }));
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    if (!user || !user.organizationId) return;

    if (!name.trim()) {
      setFormError("Student Name is required.");
      return;
    }
    
    if (!parentName.trim()) {
      setFormError("Parent Name is required.");
      return;
    }

    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (studentEmail && !emailRegex.test(studentEmail)) {
      setFormError("Please enter a valid Student Email.");
      return;
    }
    if (parentEmail && !emailRegex.test(parentEmail)) {
      setFormError("Please enter a valid Parent Email.");
      return;
    }

    const validatePhone = (phone: string) => {
      const digitCount = phone.replace(/\D/g, '').length;
      return digitCount >= 7 && digitCount <= 15;
    };

    if (studentPhone && !validatePhone(studentPhone)) {
      setFormError("Please enter a valid Student Phone number (7-15 digits).");
      return;
    }
    if (parentPhone && !validatePhone(parentPhone)) {
      setFormError("Please enter a valid Parent Phone number (7-15 digits).");
      return;
    }
    if (emergencyContactPhone && !validatePhone(emergencyContactPhone)) {
      setFormError("Please enter a valid Emergency Contact Phone number (7-15 digits).");
      return;
    }

    if (feeAmount && isNaN(parseFloat(feeAmount))) {
      setFormError("Fee Amount must be a valid number.");
      return;
    }

    setIsSubmitting(true);
    setSuccessMessage("");

    try {
      const studentData: any = {
        name,
        grade,
        subject,
        feeStructure,
        feeAmount: parseFloat(feeAmount) || 0,
        parentName,
        parentEmail,
        parentPhone,
        studentEmail,
        studentPhone,
        address,
        emergencyContactName,
        emergencyContactPhone,
        organizationId: user.organizationId,
      };

      console.log("Saving student data:", studentData);

      if (editingId) {
        await updateDoc(doc(db, "students", editingId), studentData);
        setSuccessMessage("Student updated successfully!");
      } else {
        studentData.tutorId = user.id;
        studentData.parentId = ""; // Would link to actual parent user ID in a real app
        studentData.studentUserId = ""; // Would link to actual student user ID in a real app
        studentData.status = "active";
        studentData.createdAt = new Date().toISOString();
        await addDoc(collection(db, "students"), studentData);
        setSuccessMessage("Student added successfully!");
      }

      setTimeout(() => {
        setIsModalOpen(false);
        resetForm();
        setSuccessMessage("");
        setIsSubmitting(false);
      }, 1500);
    } catch (error: any) {
      setIsSubmitting(false);
      setFormError("Error adding student: " + error.message);
      console.error("Firestore Error: ", JSON.stringify({
        error: error.message,
        operationType: editingId ? "update" : "create",
        path: "students"
      }));
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Registry & Progress</h1>
        <button 
          onClick={() => { resetForm(); setIsModalOpen(true); }}
          className="flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Student
        </button>
      </div>

      {/* Search and Filter Bar */}
      <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-100 flex items-center space-x-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400 w-5 h-5" />
          <input 
            type="text" 
            placeholder="Search students by name or parent name..." 
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
        <select 
          value={filterGrade}
          onChange={(e) => setFilterGrade(e.target.value)}
          className="px-4 py-2 border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="All Grades">All Grades</option>
          {uniqueGrades.map((grade: any) => (
            <option key={grade} value={grade}>{grade}</option>
          ))}
        </select>
      </div>

      {/* Data Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200">
            <thead className="bg-gray-50">
              <tr>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Name</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Subject</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Grade</th>
                <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Fee Structure</th>
                <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">Actions</th>
              </tr>
            </thead>
            <tbody className="bg-white divide-y divide-gray-200">
              {loading ? (
                <tr><td colSpan={5} className="px-6 py-12"><LoadingSpinner message="Loading students..." /></td></tr>
              ) : filteredStudents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-6 py-12 text-center">
                    <Users className="mx-auto h-12 w-12 text-gray-300" />
                    <h3 className="mt-2 text-sm font-medium text-gray-900">No students found</h3>
                    <p className="mt-1 text-sm text-gray-500">
                      {searchQuery || filterGrade !== "All Grades" ? "Try adjusting your search or filters." : "Get started by adding a new student."}
                    </p>
                  </td>
                </tr>
              ) : (
                filteredStudents.map((student) => (
                  <tr key={student.id} className="hover:bg-gray-50 transition-colors duration-150">
                    <td className="px-6 py-4 whitespace-nowrap">
                      <Link to={`/students/${student.id}`} className="text-sm font-medium text-indigo-600 hover:text-indigo-900">{student.name}</Link>
                      <div className="text-sm text-gray-500">{student.parentName || 'No Parent Linked'}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="text-sm text-gray-900">{student.subject}</div>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                        {student.grade}
                      </span>
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                      ${student.feeAmount}/{student.feeStructure}
                    </td>
                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                      <button onClick={() => handleViewDocs(student)} className="text-blue-600 hover:text-blue-900 mr-4" title="View Documents">
                        <FileText className="w-4 h-4" />
                      </button>
                      <button onClick={() => handleEdit(student)} className="text-indigo-600 hover:text-indigo-900 mr-4">
                        <Edit2 className="w-4 h-4" />
                      </button>
                      <button onClick={() => confirmDeleteStudent(student.id)} className="text-red-600 hover:text-red-900">
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

      {/* Documents Modal */}
      {isDocsModalOpen && selectedStudentForDocs && (
        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75" onClick={closeDocsModal}></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-20 inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-4xl sm:w-full">
              <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4 max-h-[80vh] overflow-y-auto">
                <div className="flex justify-between items-center mb-6">
                  <h3 className="text-lg leading-6 font-medium text-gray-900">
                    Documents for {selectedStudentForDocs.name}
                  </h3>
                  <button onClick={closeDocsModal} className="text-gray-400 hover:text-gray-500">
                    <span className="sr-only">Close</span>
                    <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  {/* Upload Section */}
                  <div className="md:col-span-1 bg-gray-50 p-4 rounded-lg">
                    <h4 className="text-sm font-medium text-gray-900 mb-4">Upload New Document</h4>
                    {uploadError && (
                      <div className="mb-4 p-3 bg-red-50 text-red-700 text-sm rounded-md border border-red-200">
                        {uploadError}
                      </div>
                    )}
                    <form onSubmit={handleUploadDoc} className="space-y-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">File</label>
                        <div className="mt-1 flex justify-center px-6 pt-5 pb-6 border-2 border-gray-300 border-dashed rounded-md bg-white">
                          <div className="space-y-1 text-center">
                            <Upload className="mx-auto h-12 w-12 text-gray-400" />
                            <div className="flex text-sm text-gray-600">
                              <label htmlFor="file-upload" className="relative cursor-pointer bg-white rounded-md font-medium text-indigo-600 hover:text-indigo-500 focus-within:outline-none focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-indigo-500">
                                <span>Upload a file</span>
                                <input id="file-upload" name="file-upload" type="file" className="sr-only" onChange={(e) => setDocFile(e.target.files ? e.target.files[0] : null)} />
                              </label>
                            </div>
                            <p className="text-xs text-gray-500">{docFile ? docFile.name : "PDF, DOC, IMG up to 10MB"}</p>
                          </div>
                        </div>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Category</label>
                        <select value={docCategory} onChange={(e) => setDocCategory(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                          <option value="homework">Homework</option>
                          <option value="test">Test/Quiz</option>
                          <option value="report">Progress Report</option>
                          <option value="other">Other</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Notes</label>
                        <textarea value={docNotes} onChange={(e) => setDocNotes(e.target.value)} rows={3} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="Optional notes..." />
                      </div>
                      <button type="submit" disabled={!docFile} className="w-full inline-flex justify-center py-2 px-4 border border-transparent shadow-sm text-sm font-medium rounded-md text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50">
                        Upload Document
                      </button>
                    </form>
                  </div>

                  {/* Documents List */}
                  <div className="md:col-span-2">
                    <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
                      <ul className="divide-y divide-gray-200">
                        {studentDocs.length === 0 ? (
                          <li className="px-6 py-12 text-center text-gray-500">
                            No documents found for this student.
                          </li>
                        ) : (
                          studentDocs.map((doc) => (
                            <li key={doc.id} className="px-4 py-4 flex items-center justify-between hover:bg-gray-50">
                              <div className="flex items-center">
                                <div className="flex-shrink-0 h-10 w-10 rounded-lg bg-indigo-100 flex items-center justify-center text-indigo-600">
                                  <FileText className="h-5 w-5" />
                                </div>
                                <div className="ml-4">
                                  <div className="text-sm font-medium text-gray-900">{doc.fileName}</div>
                                  <div className="text-sm text-gray-500">
                                    <span className="capitalize">{doc.category}</span> • {new Date(doc.createdAt).toLocaleDateString()}
                                  </div>
                                  {doc.notes && <div className="text-xs text-gray-400 mt-1">{doc.notes}</div>}
                                </div>
                              </div>
                              <div className="flex items-center space-x-2">
                                <a 
                                  href={doc.fileUrl} 
                                  download={doc.fileName}
                                  className="text-gray-400 hover:text-gray-600 p-2"
                                  target="_blank"
                                  rel="noopener noreferrer"
                                >
                                  <Download className="w-4 h-4" />
                                </a>
                                <button onClick={() => confirmDeleteDoc(doc.id)} className="text-red-400 hover:text-red-600 p-2">
                                  <Trash2 className="w-4 h-4" />
                                </button>
                              </div>
                            </li>
                          ))
                        )}
                      </ul>
                    </div>
                  </div>
                </div>
              </div>
              <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                <button type="button" onClick={closeDocsModal} className="w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm">
                  Close
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Add/Edit Student Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75" onClick={() => setIsModalOpen(false)}></div>
            </div>
            <span className="hidden sm:inline-block sm:align-middle sm:h-screen" aria-hidden="true">&#8203;</span>
            <div className="relative z-20 inline-block align-bottom bg-white rounded-lg text-left overflow-hidden shadow-xl transform transition-all sm:my-8 sm:align-middle sm:max-w-lg sm:w-full">
              <form onSubmit={handleSubmit}>
                <div className="bg-white px-4 pt-5 pb-4 sm:p-6 sm:pb-4 max-h-[70vh] overflow-y-auto">
                  <h3 className="text-lg leading-6 font-medium text-gray-900 mb-4">
                    {editingId ? "Edit Student" : "Add New Student"}
                  </h3>
                  {formError && (
                    <div className="mb-4 p-2 bg-red-50 text-red-700 rounded text-sm text-center">
                      {formError}
                    </div>
                  )}
                  {successMessage && (
                    <div className="mb-4 p-2 bg-green-50 text-green-700 rounded text-sm text-center">
                      {successMessage}
                    </div>
                  )}
                  <div className="space-y-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Student Name</label>
                      <input type="text" required value={name} onChange={e => setName(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Student Email</label>
                        <input type="email" value={studentEmail} onChange={e => setStudentEmail(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="student@example.com" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Student Phone</label>
                        <input type="tel" value={studentPhone} onChange={e => setStudentPhone(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                      </div>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Address</label>
                      <textarea value={address} onChange={e => setAddress(e.target.value)} rows={2} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="Full Address" />
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Grade/Level</label>
                        <input type="text" value={grade} onChange={e => setGrade(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="e.g. 10th Grade" />
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Subject</label>
                        <input type="text" value={subject} onChange={e => setSubject(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" placeholder="e.g. Math" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Fee Structure</label>
                        <select value={feeStructure} onChange={e => setFeeStructure(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm">
                          <option value="hourly">Hourly</option>
                          <option value="monthly">Monthly</option>
                          <option value="term">Per Term</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700">Amount ($)</label>
                        <input type="number" value={feeAmount} onChange={e => setFeeAmount(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                      </div>
                    </div>
                    
                    <div className="border-t border-gray-200 pt-4 mt-4">
                      <h4 className="text-sm font-medium text-gray-900 mb-2">Parent Information</h4>
                      <div className="space-y-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Parent Name</label>
                          <input type="text" required value={parentName} onChange={e => setParentName(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                        </div>
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Email</label>
                            <input type="email" value={parentEmail} onChange={e => setParentEmail(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                          </div>
                          <div>
                            <label className="block text-sm font-medium text-gray-700">Phone</label>
                            <input type="tel" value={parentPhone} onChange={e => setParentPhone(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                          </div>
                        </div>
                      </div>
                    </div>
                    
                    <div className="border-t border-gray-200 pt-4 mt-4">
                      <h4 className="text-sm font-medium text-gray-900 mb-2">Emergency Contact</h4>
                      <div className="grid grid-cols-2 gap-4">
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Contact Name</label>
                          <input type="text" value={emergencyContactName} onChange={e => setEmergencyContactName(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                        </div>
                        <div>
                          <label className="block text-sm font-medium text-gray-700">Contact Phone</label>
                          <input type="tel" value={emergencyContactPhone} onChange={e => setEmergencyContactPhone(e.target.value)} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm" />
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
                <div className="bg-gray-50 px-4 py-3 sm:px-6 sm:flex sm:flex-row-reverse">
                  <button type="submit" disabled={isSubmitting} className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-indigo-600 text-base font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50">
                    {isSubmitting ? "Saving..." : (editingId ? "Save Changes" : "Add Student")}
                  </button>
                  <button type="button" disabled={isSubmitting} onClick={() => setIsModalOpen(false)} className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm disabled:opacity-50">
                    Cancel
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
      {/* Delete Student Modal */}
      {isDeleteStudentModalOpen && (
        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75" onClick={() => setIsDeleteStudentModalOpen(false)}></div>
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
                      Delete Student
                    </h3>
                    <div className="mt-2">
                      <p className="text-sm text-gray-500">
                        Are you sure you want to delete this student? This action cannot be undone.
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
                  onClick={() => setIsDeleteStudentModalOpen(false)}
                  className="mt-3 w-full inline-flex justify-center rounded-md border border-gray-300 shadow-sm px-4 py-2 bg-white text-base font-medium text-gray-700 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 sm:mt-0 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Delete Document Modal */}
      {isDeleteDocModalOpen && (
        <div className="fixed inset-0 z-10 overflow-y-auto">
          <div className="flex items-end justify-center min-h-screen pt-4 px-4 pb-20 text-center sm:block sm:p-0">
            <div className="fixed inset-0 transition-opacity" aria-hidden="true">
              <div className="absolute inset-0 bg-gray-500 opacity-75" onClick={() => setIsDeleteDocModalOpen(false)}></div>
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
                  onClick={handleDeleteDoc}
                  className="w-full inline-flex justify-center rounded-md border border-transparent shadow-sm px-4 py-2 bg-red-600 text-base font-medium text-white hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-red-500 sm:ml-3 sm:w-auto sm:text-sm"
                >
                  Delete
                </button>
                <button
                  type="button"
                  onClick={() => setIsDeleteDocModalOpen(false)}
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
