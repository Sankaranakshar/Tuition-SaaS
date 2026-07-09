import { useState, useEffect } from "react";
import { BookOpen, FileText, Download, Award } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { format, parseISO } from "date-fns";
import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

const ASSESSMENT_SELECT =
  "id, studentId:student_id, organizationId:organization_id, date, title, type, score, totalScore:total_score, maxScore:max_score, feedback, comments, createdAt:created_at";

export default function AcademicProgress() {
  const { user } = useAuth();
  const [assessments, setAssessments] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!user) return;

    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("assessments")
        .select(ASSESSMENT_SELECT)
        .eq("student_id", user.id)
        .limit(50);
      if (cancelled) return;
      if (error) {
        console.error("Supabase Error (Assessments): ", error);
        setLoading(false);
        return;
      }
      const rows = (data || []) as any[];
      setAssessments(rows.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()));
      setLoading(false);
    };

    load();

    const channel = supabase
      .channel(`assessments-${user.id}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "assessments", filter: `student_id=eq.${user.id}` }, load)
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const generateProgressReport = () => {
    const doc = new jsPDF();
    
    doc.setFontSize(20);
    doc.text("Academic Progress Report", 14, 22);
    
    doc.setFontSize(12);
    doc.text(`Student: ${user?.name || 'Student'}`, 14, 32);
    doc.text(`Date Generated: ${format(new Date(), 'MMM d, yyyy')}`, 14, 40);

    const tableData = assessments.map(assessment => {
      const maxScore = assessment.totalScore || assessment.maxScore || 100;
      const percentage = Math.round((Number(assessment.score) / Number(maxScore)) * 100);
      return [
        assessment.date ? format(parseISO(assessment.date), 'MMM d, yyyy') : 'N/A',
        assessment.title || 'Untitled Assessment',
        assessment.type,
        `${assessment.score}/${maxScore} (${percentage}%)`,
        assessment.feedback || assessment.comments || '-'
      ];
    });

    autoTable(doc, {
      startY: 50,
      head: [['Date', 'Assessment', 'Type', 'Score', 'Feedback']],
      body: tableData,
      theme: 'grid',
      headStyles: { fillColor: [79, 70, 229] }, // Indigo 600
    });

    doc.save(`progress_report_${format(new Date(), 'yyyy-MM-dd')}.pdf`);
  };

  if (loading) return <div>Loading academic progress...</div>;

  return (
    <div className="space-y-6 max-w-7xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Academic Progress</h1>
        <button 
          onClick={generateProgressReport}
          className="flex items-center px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors"
        >
          <Download className="w-4 h-4 mr-2" />
          Download Monthly Report
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            <Award className="w-5 h-5 mr-2 text-indigo-500" />
            Gradebook
          </h2>
        </div>
        
        {assessments.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="min-w-full divide-y divide-gray-200">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Date</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Assessment</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Type</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Score</th>
                  <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Feedback</th>
                </tr>
              </thead>
              <tbody className="bg-white divide-y divide-gray-200">
                {assessments.map((assessment) => {
                  const maxScore = assessment.totalScore || assessment.maxScore || 100;
                  const percentage = Math.round((Number(assessment.score) / Number(maxScore)) * 100);
                  let statusColor = 'text-green-600 bg-green-50';
                  if (percentage < 60) statusColor = 'text-red-600 bg-red-50';
                  else if (percentage < 80) statusColor = 'text-yellow-600 bg-yellow-50';

                  return (
                    <tr key={assessment.id} className="hover:bg-gray-50 transition-colors duration-150">
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {assessment.date ? format(parseISO(assessment.date), 'MMM d, yyyy') : 'N/A'}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{assessment.title || 'Untitled Assessment'}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {assessment.type}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="flex items-center">
                          <span className="text-sm font-bold text-gray-900 mr-2">{assessment.score}/{maxScore}</span>
                          <span className={`px-2 py-0.5 rounded text-xs font-medium ${statusColor}`}>
                            {percentage}%
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-4 text-sm text-gray-500 max-w-xs truncate">
                        {assessment.feedback || assessment.comments || '-'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-6 py-12 text-center">
            <FileText className="mx-auto h-12 w-12 text-gray-300" />
            <h3 className="mt-2 text-sm font-medium text-gray-900">No grades yet</h3>
            <p className="mt-1 text-sm text-gray-500">Your assessments and grades will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}
