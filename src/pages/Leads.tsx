import React, { useState, useEffect } from "react";
import { Plus, Search, Edit2, Trash2, Mail, Phone, UserPlus } from "lucide-react";
import { supabase } from "../supabase";
import { toast } from "sonner";
import { useAuth } from "../context/AuthContext";

import LoadingSpinner from "../components/LoadingSpinner";

const LEAD_STATUSES = ["New", "Contacted", "Trial Scheduled", "Enrolled", "Lost"];
const LEAD_SOURCES = ["Website", "Referral", "Walk-in", "Social Media", "Other"];

export default function Leads() {
  const { user } = useAuth();
  const [leads, setLeads] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");

  // Form state
  const [studentName, setStudentName] = useState("");
  const [parentName, setParentName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [grade, setGrade] = useState("");
  const [subject, setSubject] = useState("");
  const [source, setSource] = useState(LEAD_SOURCES[0]);
  const [status, setStatus] = useState(LEAD_STATUSES[0]);
  const [notes, setNotes] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState("");

  // Map a leads row (snake_case, contact_info jsonb) to the flat shape the
  // rest of this component reads/writes.
  const mapLead = (row: any) => {
    const contactInfo = row.contact_info || {};
    return {
      id: row.id,
      studentName: row.name,
      parentName: row.parent_name,
      email: contactInfo.email || "",
      phone: contactInfo.phone || "",
      grade: row.grade,
      subject: row.subject,
      source: row.source,
      status: row.status,
      notes: row.notes,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  };

  useEffect(() => {
    if (!user || !user.organizationId) return;
    let cancelled = false;

    const load = async () => {
      const { data, error } = await supabase
        .from("leads")
        .select("*")
        .eq("organization_id", user.organizationId)
        .order("created_at", { ascending: false })
        .limit(100);
      if (error) {
        console.error("Supabase Error: ", JSON.stringify({
          error: error.message,
          operationType: "list",
          path: "leads"
        }));
        return;
      }
      if (!cancelled) {
        setLeads((data || []).map(mapLead));
        setLoading(false);
      }
    };

    load();

    const channel = supabase
      .channel(`leads-${user.organizationId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `organization_id=eq.${user.organizationId}` },
        load
      )
      .subscribe();

    return () => {
      cancelled = true;
      supabase.removeChannel(channel);
    };
  }, [user]);

  const filteredLeads = leads.filter(lead => 
    lead.studentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lead.parentName.toLowerCase().includes(searchQuery.toLowerCase()) ||
    lead.email.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const resetForm = () => {
    setStudentName("");
    setParentName("");
    setEmail("");
    setPhone("");
    setGrade("");
    setSubject("");
    setSource(LEAD_SOURCES[0]);
    setStatus(LEAD_STATUSES[0]);
    setNotes("");
    setEditingId(null);
    setFormError("");
  };

  const handleOpenModal = (lead?: any) => {
    resetForm();
    if (lead) {
      setEditingId(lead.id);
      setStudentName(lead.studentName || "");
      setParentName(lead.parentName || "");
      setEmail(lead.email || "");
      setPhone(lead.phone || "");
      setGrade(lead.grade || "");
      setSubject(lead.subject || "");
      setSource(lead.source || LEAD_SOURCES[0]);
      setStatus(lead.status || LEAD_STATUSES[0]);
      setNotes(lead.notes || "");
    }
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError("");
    setIsSubmitting(true);

    if (!studentName || !parentName || !email) {
      setFormError("Student Name, Parent Name, and Email are required.");
      setIsSubmitting(false);
      return;
    }

    try {
      const leadData = {
        name: studentName,
        parent_name: parentName,
        contact_info: { email, phone },
        grade,
        subject,
        source,
        status,
        notes,
        organization_id: user?.organizationId,
        updated_at: new Date().toISOString()
      };

      if (editingId) {
        const { error } = await supabase.from("leads").update(leadData).eq("id", editingId);
        if (error) throw error;
      } else {
        const { data: inserted, error } = await supabase
          .from("leads")
          .insert(leadData)
          .select()
          .single();
        if (error) throw error;

        // Automated Follow-up: Send Welcome Message. Note: messages.receiver_id
        // is now a real FK to auth.users, so (unlike the old Firestore doc)
        // we can no longer stuff the lead id in there as a stand-in receiver —
        // leave it unset until leads get a real user record to message.
        const { error: msgError } = await supabase.from("messages").insert({
          organization_id: user?.organizationId,
          sender_id: user?.id,
          body: `Hi ${parentName}, thank you for your interest in our classes for ${studentName}! We'll be in touch shortly to schedule a trial class. (lead: ${inserted?.id})`,
        });
        if (msgError) throw msgError;
      }
      setIsModalOpen(false);
      resetForm();
    } catch (error: any) {
      console.error("Error saving lead:", error);
      setFormError(error.message || "Failed to save lead.");
    } finally {
      setIsSubmitting(false);
    }
  };

  // Undo, never confirm: the lead is archived immediately and the toast
  // offers a 5-second window to restore it.
  const handleDelete = async (id: string) => {
    const lead = leads.find((l) => l.id === id);
    try {
      const { error } = await supabase.from("leads").delete().eq("id", id);
      if (error) throw error;
      toast.success("Lead deleted", {
        action: lead
          ? {
              label: "Undo",
              onClick: async () => {
                await supabase.from("leads").insert({
                  id: lead.id,
                  name: lead.studentName,
                  parent_name: lead.parentName,
                  contact_info: { email: lead.email, phone: lead.phone },
                  grade: lead.grade,
                  subject: lead.subject,
                  source: lead.source,
                  status: lead.status,
                  notes: lead.notes,
                  organization_id: user?.organizationId,
                });
              },
            }
          : undefined,
      });
    } catch (error: any) {
      toast.error("Could not delete lead", { description: error.message });
    }
  };

  const handleStatusChange = async (id: string, newStatus: string) => {
    try {
      const { error } = await supabase
        .from("leads")
        .update({ status: newStatus, updated_at: new Date().toISOString() })
        .eq("id", id);
      if (error) throw error;
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  if (loading) {
    return <LoadingSpinner message="Loading leads..." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Sales Pipeline</h1>
          <p className="text-sm text-gray-500 mt-1">Manage prospective students and track follow-ups.</p>
        </div>
        <button
          onClick={() => handleOpenModal()}
          className="flex items-center px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 transition-colors"
        >
          <Plus className="w-4 h-4 mr-2" />
          Add Lead
        </button>
      </div>

      <div className="flex items-center space-x-4 bg-white p-4 rounded-lg border border-gray-200 shadow-sm">
        <div className="relative flex-1">
          <span className="absolute inset-y-0 left-0 flex items-center pl-3">
            <Search className="w-5 h-5 text-gray-400" />
          </span>
          <input
            type="text"
            placeholder="Search leads by name or email..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-10 pr-4 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:border-transparent"
          />
        </div>
      </div>

      {/* Kanban Board */}
      <div className="flex gap-6 overflow-x-auto pb-4">
        {LEAD_STATUSES.map(statusCol => {
          const colLeads = filteredLeads.filter(l => l.status === statusCol);
          return (
            <div key={statusCol} className="flex-shrink-0 w-80 bg-gray-50 rounded-lg border border-gray-200 flex flex-col max-h-[calc(100vh-240px)]">
              <div className="p-3 border-b border-gray-200 bg-gray-100 rounded-t-lg flex justify-between items-center">
                <h3 className="font-semibold text-gray-700">{statusCol}</h3>
                <span className="bg-white text-gray-600 text-xs font-medium px-2 py-1 rounded-full border border-gray-200">
                  {colLeads.length}
                </span>
              </div>
              <div className="p-3 overflow-y-auto flex-1 space-y-3">
                {colLeads.map(lead => (
                  <div key={lead.id} className="bg-white p-4 rounded-md shadow-sm border border-gray-200 hover:shadow-md hover:-translate-y-1 transition-all duration-200">
                    <div className="flex justify-between items-start mb-2">
                      <h4 className="font-medium text-gray-900">{lead.studentName}</h4>
                      <div className="flex space-x-1">
                        <button onClick={() => handleOpenModal(lead)} className="text-gray-400 hover:text-indigo-600">
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => handleDelete(lead.id)} className="text-gray-400 hover:text-red-600">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                    <p className="text-sm text-gray-600 mb-1 flex items-center">
                      <UserPlus className="w-3 h-3 mr-1" /> {lead.parentName}
                    </p>
                    <p className="text-xs text-gray-500 mb-1 flex items-center">
                      <Mail className="w-3 h-3 mr-1" /> {lead.email}
                    </p>
                    {lead.phone && (
                      <p className="text-xs text-gray-500 mb-3 flex items-center">
                        <Phone className="w-3 h-3 mr-1" /> {lead.phone}
                      </p>
                    )}
                    <div className="mt-3 pt-3 border-t border-gray-100 flex justify-between items-center">
                      <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-1 rounded">
                        {lead.source}
                      </span>
                      <select
                        value={lead.status}
                        onChange={(e) => handleStatusChange(lead.id, e.target.value)}
                        className="text-xs border-gray-300 rounded-md focus:ring-indigo-500 focus:border-indigo-500 py-1 pl-2 pr-6"
                      >
                        {LEAD_STATUSES.map(s => (
                          <option key={s} value={s}>{s}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                ))}
                {colLeads.length === 0 && (
                  <div className="text-center py-6 text-sm text-gray-400 border-2 border-dashed border-gray-200 rounded-md">
                    No leads
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Add/Edit Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
            <div className="p-6 border-b border-gray-200 flex justify-between items-center sticky top-0 bg-white z-10">
              <h2 className="text-xl font-bold text-gray-900">
                {editingId ? "Edit Lead" : "Add New Lead"}
              </h2>
              <button onClick={() => setIsModalOpen(false)} className="text-gray-400 hover:text-gray-500">
                &times;
              </button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-6">
              {formError && (
                <div className="bg-red-50 text-red-600 p-3 rounded-md text-sm">
                  {formError}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Student Name *</label>
                  <input
                    type="text"
                    required
                    value={studentName}
                    onChange={(e) => setStudentName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Parent Name *</label>
                  <input
                    type="text"
                    required
                    value={parentName}
                    onChange={(e) => setParentName(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Phone</label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Grade</label>
                  <input
                    type="text"
                    value={grade}
                    onChange={(e) => setGrade(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Subject of Interest</label>
                  <input
                    type="text"
                    value={subject}
                    onChange={(e) => setSubject(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Source</label>
                  <select
                    value={source}
                    onChange={(e) => setSource(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {LEAD_SOURCES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                  <select
                    value={status}
                    onChange={(e) => setStatus(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  >
                    {LEAD_STATUSES.map(s => (
                      <option key={s} value={s}>{s}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Notes</label>
                <textarea
                  rows={3}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-indigo-500"
                  placeholder="Any additional details or follow-up notes..."
                />
              </div>

              <div className="flex justify-end space-x-3 pt-4 border-t border-gray-200">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-md hover:bg-gray-50"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
                >
                  {isSubmitting ? "Saving..." : "Save Lead"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
