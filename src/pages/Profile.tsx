import { useState, useEffect } from "react";
import { User, Mail, Phone, MapPin, Users, Edit2, Save } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";

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

  if (loading) return <div>Loading profile...</div>;

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      <div className="flex justify-between items-center">
        <h1 className="text-2xl font-bold text-gray-900">Account Details</h1>
        {isEditing ? (
          <button onClick={handleSave} className="flex items-center px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-md hover:bg-indigo-700 transition-colors">
            <Save className="w-4 h-4 mr-2" />
            Save Changes
          </button>
        ) : (
          <button onClick={() => setIsEditing(true)} className="flex items-center px-4 py-2 bg-white border border-gray-300 text-gray-700 text-sm font-medium rounded-md hover:bg-gray-50 transition-colors">
            <Edit2 className="w-4 h-4 mr-2" />
            Edit Profile
          </button>
        )}
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            <User className="w-5 h-5 mr-2 text-indigo-500" />
            Personal Info
          </h2>
        </div>
        
        <div className="p-6 grid grid-cols-1 md:grid-cols-2 gap-6">
          <div>
            <label className="block text-sm font-medium text-gray-500">Full Name</label>
            {isEditing ? (
              <input type="text" value={formData.name || ''} onChange={e => setFormData({...formData, name: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 sm:text-sm" />
            ) : (
              <p className="mt-1 text-sm text-gray-900 font-medium flex items-center"><User className="w-4 h-4 mr-2 text-gray-400" /> {profile?.name || 'Not provided'}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500">Email Address</label>
            <p className="mt-1 text-sm text-gray-900 font-medium flex items-center"><Mail className="w-4 h-4 mr-2 text-gray-400" /> {profile?.email || 'Not provided'}</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500">Phone Number</label>
            {isEditing ? (
              <input type="text" value={formData.phone_number || ''} onChange={e => setFormData({...formData, phone_number: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 sm:text-sm" />
            ) : (
              <p className="mt-1 text-sm text-gray-900 font-medium flex items-center"><Phone className="w-4 h-4 mr-2 text-gray-400" /> {profile?.phone_number || 'Not provided'}</p>
            )}
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-500">School / Institution</label>
            {isEditing ? (
              <input type="text" value={formData.school || ''} onChange={e => setFormData({...formData, school: e.target.value})} className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm py-2 px-3 sm:text-sm" />
            ) : (
              <p className="mt-1 text-sm text-gray-900 font-medium flex items-center"><MapPin className="w-4 h-4 mr-2 text-gray-400" /> {profile?.school || 'Not provided'}</p>
            )}
          </div>
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100 flex justify-between items-center">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center">
            <Users className="w-5 h-5 mr-2 text-indigo-500" />
            Family Linking
          </h2>
        </div>
        
        <div className="p-6">
          <p className="text-sm text-gray-500 mb-4">Manage linked parent/guardian profiles and emergency contacts.</p>
          
          <div className="bg-gray-50 p-4 rounded-lg border border-gray-200 flex items-center justify-between">
            <div className="flex items-center">
              <div className="w-10 h-10 bg-indigo-100 rounded-full flex items-center justify-center text-indigo-600 font-bold mr-4">
                P
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">Parent / Guardian</p>
                <p className="text-xs text-gray-500">parent@example.com</p>
              </div>
            </div>
            <span className="px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800">Linked</span>
          </div>
        </div>
      </div>
    </div>
  );
}
