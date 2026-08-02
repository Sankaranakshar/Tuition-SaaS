import { useState, useEffect } from "react";
import { User, Mail, Phone, MapPin, Users, Edit2, Save } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { StatusChip } from "../components/kit";

export default function Profile() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [isEditing, setIsEditing] = useState(false);
  const [formData, setFormData] = useState<any>({});

  useEffect(() => {
    if (!user) return;

    const fetchProfile = async () => {
      try {
        const { data, error } = await supabase.from("profiles").select("*").eq("id", user.id).maybeSingle();
        if (error) throw error;
        if (data) {
          const mapped = { id: data.id, ...data, phone_number: data.phone };
          setProfile(mapped);
          setFormData(mapped);
        }
      } catch (error) {
        console.error("Error fetching profile:", error);
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [user]);

  const handleSave = async () => {
    if (!user) return;
    try {
      // Only profile fields; spreading the whole row back would trip RLS
      // (role/organizationId are not client-writable).
      const { error } = await supabase.from("profiles").update({
        name: formData.name || "",
        phone: formData.phone_number || "",
        school: formData.school || "",
        grade: formData.grade || "",
        updated_at: new Date().toISOString(),
      }).eq("id", user.id);
      if (error) throw error;
      setProfile(formData);
      setIsEditing(false);
    } catch (error) {
      console.error("Error updating profile:", error);
    }
  };

  if (loading) return <div className="text-sm text-[var(--cs-text-muted)]">Loading profile...</div>;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-[var(--cs-text)]">Account Details</h1>
        {isEditing ? (
          <button onClick={handleSave} className="flex items-center rounded-[6px] bg-[var(--cs-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 transition-opacity">
            <Save className="w-4 h-4 mr-2" />
            Save Changes
          </button>
        ) : (
          <button onClick={() => setIsEditing(true)} className="flex items-center rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] px-4 py-2 text-sm font-medium text-[var(--cs-text)] hover:bg-[var(--cs-bg)] transition-colors">
            <Edit2 className="w-4 h-4 mr-2" />
            Edit Profile
          </button>
        )}
      </div>

      <div className="bg-[var(--cs-surface)] rounded-[10px] border border-[var(--cs-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--cs-border)] flex justify-between items-center">
          <h2 className="text-lg font-semibold text-[var(--cs-text)] flex items-center">
            <User className="w-5 h-5 mr-2 text-[var(--cs-accent)]" />
            Personal Info
          </h2>
        </div>

        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Full Name</label>
            {isEditing ? (
              <input type="text" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]" />
            ) : (
              <p className="mt-1 text-sm text-[var(--cs-text)] font-medium flex items-center"><User className="w-4 h-4 mr-2 text-[var(--cs-text-muted)]" /> {profile?.name || 'Not provided'}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Email Address</label>
            <p className="mt-1 text-sm text-[var(--cs-text)] font-medium flex items-center"><Mail className="w-4 h-4 mr-2 text-[var(--cs-text-muted)]" /> {profile?.email || 'Not provided'}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Phone Number</label>
            {isEditing ? (
              <input type="text" value={formData.phone_number || ''} onChange={e => setFormData({...formData, phone_number: e.target.value})} className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]" />
            ) : (
              <p className="mt-1 text-sm text-[var(--cs-text)] font-medium flex items-center"><Phone className="w-4 h-4 mr-2 text-[var(--cs-text-muted)]" /> {profile?.phone_number || 'Not provided'}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-[var(--cs-text-muted)]">School / Institution</label>
            {isEditing ? (
              <input type="text" value={formData.school || ''} onChange={e => setFormData({...formData, school: e.target.value})} className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]" />
            ) : (
              <p className="mt-1 text-sm text-[var(--cs-text)] font-medium flex items-center"><MapPin className="w-4 h-4 mr-2 text-[var(--cs-text-muted)]" /> {profile?.school || 'Not provided'}</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-[var(--cs-surface)] rounded-[10px] border border-[var(--cs-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--cs-border)] flex justify-between items-center">
          <h2 className="text-lg font-semibold text-[var(--cs-text)] flex items-center">
            <Users className="w-5 h-5 mr-2 text-[var(--cs-accent)]" />
            Family Linking
          </h2>
        </div>

        <div className="p-6">
          <p className="text-sm text-[var(--cs-text-muted)] mb-4">Manage linked parent/guardian profiles and emergency contacts.</p>

          <div className="bg-[var(--cs-bg)] p-4 rounded-[6px] border border-[var(--cs-border)] flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-[var(--cs-accent-soft)] rounded-full flex items-center justify-center text-[var(--cs-accent)] font-bold mr-4">
                P
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--cs-text)]">Parent / Guardian</p>
                <p className="text-xs text-[var(--cs-text-muted)]">parent@example.com</p>
              </div>
            </div>
            <StatusChip label="Linked" tone="positive" />
          </div>
        </div>
      </div>
    </div>
  );
}
