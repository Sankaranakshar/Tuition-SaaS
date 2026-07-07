import { useState, useEffect } from "react";
import { FileText, Download, Upload, Folder, File } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { collection, query, where, orderBy, onSnapshot, addDoc, serverTimestamp, doc, updateDoc } from "firebase/firestore";
import { db } from "../firebase";
import LoadingSpinner from "../components/LoadingSpinner";

export default function StudyMaterial() {
  const { user } = useAuth();
  const [materials, setMaterials] = useState<any[]>([]);
  const [assignments, setAssignments] = useState<any[]>([]);
  const [loadingMaterials, setLoadingMaterials] = useState(true);
  const [loadingAssignments, setLoadingAssignments] = useState(true);

  useEffect(() => {
    if (!user?.organizationId || !user?.id) return;

    // Fetch materials (documents)
    const qMaterials = query(
      collection(db, "documents"),
      where("organizationId", "==", user.organizationId),
      where("studentId", "==", user.id),
      orderBy("createdAt", "desc")
    );

    const unsubscribeMaterials = onSnapshot(qMaterials, (snapshot) => {
      const materialsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setMaterials(materialsData);
      setLoadingMaterials(false);
    }, (error) => {
      console.error("Error fetching materials:", error);
      setLoadingMaterials(false);
    });

    // Fetch assignments (assessments with type 'assignment')
    const qAssignments = query(
      collection(db, "assessments"),
      where("organizationId", "==", user.organizationId),
      where("studentId", "==", user.id),
      where("type", "==", "assignment"),
      orderBy("dueDate", "asc")
    );

    const unsubscribeAssignments = onSnapshot(qAssignments, (snapshot) => {
      const assignmentsData = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      setAssignments(assignmentsData);
      setLoadingAssignments(false);
    }, (error) => {
      console.error("Error fetching assignments:", error);
      setLoadingAssignments(false);
    });

    return () => {
      unsubscribeMaterials();
      unsubscribeAssignments();
    };
  }, [user]);

  const handleUploadAssignment = async (assignmentId: string) => {
    try {
      await updateDoc(doc(db, "assessments", assignmentId), {
        status: 'submitted',
        updatedAt: serverTimestamp()
      });
    } catch (error) {
      console.error("Error uploading assignment:", error);
    }
  };

  if (loadingMaterials || loadingAssignments) {
    return <LoadingSpinner />;
  }

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Study Material & Submissions</h1>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Document Center */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <Folder className="w-5 h-5 mr-2 text-indigo-500" />
              Document Center
            </h2>
          </div>
          
          {materials.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {materials.map((material) => (
                <li key={material.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div className="flex items-center">
                    <div className="p-2 bg-indigo-50 rounded-lg text-indigo-600 mr-4">
                      <File className="w-6 h-6" />
                    </div>
                    <div>
                      <p className="text-sm font-medium text-gray-900">{material.fileName || material.title}</p>
                      <p className="text-xs text-gray-500 mt-1">{material.category || material.subject} • {material.fileSize ? `${(material.fileSize / 1024 / 1024).toFixed(2)} MB` : 'Unknown size'} • {material.createdAt ? new Date(material.createdAt.toDate ? material.createdAt.toDate() : material.createdAt).toLocaleDateString() : 'Unknown date'}</p>
                    </div>
                  </div>
                  <button className="p-2 text-gray-400 hover:text-indigo-600 transition-colors">
                    <Download className="w-5 h-5" />
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Folder className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-sm font-medium text-gray-900">No materials yet</h3>
              <p className="text-sm text-gray-500 mt-1">Study materials shared with you will appear here.</p>
            </div>
          )}
        </div>

        {/* Submissions */}
        <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
            <h2 className="text-lg font-semibold text-gray-900 flex items-center">
              <Upload className="w-5 h-5 mr-2 text-indigo-500" />
              Submissions
            </h2>
          </div>
          
          {assignments.length > 0 ? (
            <ul className="divide-y divide-gray-100">
              {assignments.map((assignment) => (
                <li key={assignment.id} className="px-6 py-4 flex items-center justify-between hover:bg-gray-50 transition-colors">
                  <div>
                    <p className="text-sm font-medium text-gray-900">{assignment.title}</p>
                    <p className="text-xs text-gray-500 mt-1">Due: {assignment.dueDate ? new Date(assignment.dueDate).toLocaleString() : 'No due date'}</p>
                  </div>
                  <div className="flex items-center space-x-3">
                    <span className={`px-2.5 py-1 rounded-full text-xs font-medium ${
                      assignment.status === 'submitted' ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
                    }`}>
                      {assignment.status === 'submitted' ? 'Submitted' : 'Pending'}
                    </span>
                    {assignment.status === 'pending' && (
                      <button 
                        onClick={() => handleUploadAssignment(assignment.id)}
                        className="flex items-center px-3 py-1.5 bg-indigo-50 text-indigo-600 text-xs font-medium rounded-md hover:bg-indigo-100 transition-colors"
                      >
                        <Upload className="w-3 h-3 mr-1" />
                        Upload
                      </button>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <div className="p-8 text-center">
              <div className="w-16 h-16 bg-gray-50 rounded-full flex items-center justify-center mx-auto mb-4">
                <Upload className="w-8 h-8 text-gray-400" />
              </div>
              <h3 className="text-sm font-medium text-gray-900">No assignments</h3>
              <p className="text-sm text-gray-500 mt-1">You don't have any pending assignments.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
