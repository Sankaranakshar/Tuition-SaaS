import { useState, useEffect } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../supabase";
import { Save, AlertCircle, CheckCircle } from "lucide-react";

export default function TutorProfileSettings() {
  const { user } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [success, setSuccess] = useState("");
  
  const [profile, setProfile] = useState({
    full_name: "",
    bio: "",
    subjects: "",
    grades: "",
    experience_years: 0,
    qualification: "",
    teaching_mode: "online",
    location: "",
    price_model: "hourly",
    price_range_min: 0,
    price_range_max: 0,
    max_batch_size: 1
  });

  useEffect(() => {
    if (!user?.id) return;
    
    const fetchProfile = async () => {
      try {
        const { data, error } = await supabase.from("tutor_profiles").select("*").eq("user_id", user.id).maybeSingle();
        if (error) throw error;
        if (data) {
          setProfile({
            full_name: data.full_name || user.name || "",
            bio: data.bio || "",
            subjects: Array.isArray(data.subjects) ? data.subjects.join(", ") : "",
            grades: Array.isArray(data.grades) ? data.grades.join(", ") : "",
            experience_years: data.experience_years || 0,
            qualification: data.qualification || "",
            teaching_mode: data.teaching_mode || "online",
            location: data.location || "",
            price_model: data.price_model || "hourly",
            price_range_min: data.price_range_min || 0,
            price_range_max: data.price_range_max || 0,
            max_batch_size: data.max_batch_size || 1
          });
        } else {
          setProfile(prev => ({ ...prev, full_name: user.name || "" }));
        }
      } catch (err) {
        console.error("Error fetching tutor profile:", err);
      }
    };
    fetchProfile();
  }, [user?.id, user?.name]);

  const handleSave = async () => {
    if (!user?.id) return;
    setLoading(true);
    setError("");
    setSuccess("");
    
    try {
      const profileData = {
        user_id: user.id,
        organization_id: user.organizationId,
        full_name: profile.full_name,
        bio: profile.bio,
        subjects: profile.subjects.split(",").map(s => s.trim()).filter(Boolean),
        grades: profile.grades.split(",").map(s => s.trim()).filter(Boolean),
        experience_years: Number(profile.experience_years),
        qualification: profile.qualification,
        teaching_mode: profile.teaching_mode,
        location: profile.location,
        price_model: profile.price_model,
        price_range_min: Number(profile.price_range_min),
        price_range_max: Number(profile.price_range_max),
        max_batch_size: Number(profile.max_batch_size),
      };

      const { error } = await supabase.from("tutor_profiles").upsert(profileData, { onConflict: "user_id" });
      if (error) throw error;
      setSuccess("Tutor profile saved successfully.");
    } catch (err: any) {
      setError(err.message || "Failed to save profile.");
    } finally {
      setLoading(false);
    }
  };

  const handleChange = (field: string, value: any) => {
    setProfile(prev => ({ ...prev, [field]: value }));
  };

  if (!user || (user.role !== 'admin' && user.role !== 'tutor')) {
    return <div className="p-4 text-[var(--cs-text-muted)]">You do not have permission to view tutor profiles.</div>;
  }

  return (
    <div className="space-y-6">
      {error && (
        <div className="bg-red-50 border border-red-200 text-[var(--cs-danger)] px-4 py-3 rounded-[6px] text-sm flex items-center">
          <AlertCircle className="w-5 h-5 mr-2" />
          {error}
        </div>
      )}

      {success && (
        <div className="bg-green-50 border border-green-200 text-[var(--cs-ok)] px-4 py-3 rounded-[6px] text-sm flex items-center">
          <CheckCircle className="w-5 h-5 mr-2" />
          {success}
        </div>
      )}

      <div className="bg-[var(--cs-surface)] rounded-[10px] border border-[var(--cs-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--cs-border)] flex justify-between items-center bg-[var(--cs-bg)]">
          <div>
            <h2 className="text-lg font-semibold text-[var(--cs-text)]">Tutor Marketplace Profile</h2>
            <p className="text-sm text-[var(--cs-text-muted)]">This information will be displayed on your public profile in the tutor marketplace.</p>
          </div>
          <button
            onClick={handleSave}
            disabled={loading}
            className="flex items-center rounded-[6px] bg-[var(--cs-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            <Save className="w-4 h-4 mr-2" />
            {loading ? "Saving..." : "Save Profile"}
          </button>
        </div>

        <div className="p-6 space-y-8">
          {/* Basic Info */}
          <section>
            <h3 className="text-md font-semibold text-[var(--cs-text)] mb-4 border-b border-[var(--cs-border)] pb-2">Basic Information</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Full Name</label>
                <input
                  type="text"
                  value={profile.full_name}
                  onChange={(e) => handleChange('full_name', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                  placeholder="e.g. Jane Doe"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Bio</label>
                <p className="text-xs text-[var(--cs-text-muted)] mb-1">A short description about yourself, your teaching style, and what makes you unique.</p>
                <textarea
                  rows={4}
                  value={profile.bio}
                  onChange={(e) => handleChange('bio', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                  placeholder="I am a passionate math tutor with over 5 years of experience..."
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Years of Experience</label>
                <input
                  type="number"
                  min="0"
                  value={profile.experience_years}
                  onChange={(e) => handleChange('experience_years', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Highest Qualification</label>
                <input
                  type="text"
                  value={profile.qualification}
                  onChange={(e) => handleChange('qualification', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                  placeholder="e.g. M.Sc. in Mathematics"
                />
              </div>
            </div>
          </section>

          {/* Teaching Details */}
          <section>
            <h3 className="text-md font-semibold text-[var(--cs-text)] mb-4 border-b border-[var(--cs-border)] pb-2">Teaching Details</h3>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Subjects Taught (comma separated)</label>
                <input
                  type="text"
                  value={profile.subjects}
                  onChange={(e) => handleChange('subjects', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                  placeholder="e.g. Algebra, Physics, Chemistry"
                />
              </div>
              <div className="md:col-span-2">
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Grades/Levels (comma separated)</label>
                <input
                  type="text"
                  value={profile.grades}
                  onChange={(e) => handleChange('grades', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                  placeholder="e.g. High School, College, Grade 10"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Teaching Mode</label>
                <select
                  value={profile.teaching_mode}
                  onChange={(e) => handleChange('teaching_mode', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                >
                  <option value="online">Online Only</option>
                  <option value="offline">In-Person Only</option>
                  <option value="hybrid">Hybrid (Online & In-Person)</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Location / City</label>
                <input
                  type="text"
                  value={profile.location}
                  onChange={(e) => handleChange('location', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                  placeholder="e.g. San Francisco, CA"
                />
              </div>
            </div>
          </section>

          {/* Pricing & Capacity */}
          <section>
            <h3 className="text-md font-semibold text-[var(--cs-text)] mb-4 border-b border-[var(--cs-border)] pb-2">Pricing & Capacity</h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Pricing Model</label>
                <select
                  value={profile.price_model}
                  onChange={(e) => handleChange('price_model', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                >
                  <option value="hourly">Hourly Rate</option>
                  <option value="per_session">Per Session</option>
                  <option value="monthly">Monthly Retainer</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Min Price</label>
                <input
                  type="number"
                  min="0"
                  value={profile.price_range_min}
                  onChange={(e) => handleChange('price_range_min', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Max Price</label>
                <input
                  type="number"
                  min="0"
                  value={profile.price_range_max}
                  onChange={(e) => handleChange('price_range_max', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-[var(--cs-text-muted)]">Max Batch Size</label>
                <p className="text-xs text-[var(--cs-text-muted)] mb-1">Maximum students per group session.</p>
                <input
                  type="number"
                  min="1"
                  value={profile.max_batch_size}
                  onChange={(e) => handleChange('max_batch_size', e.target.value)}
                  className="mt-1 block w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
                />
              </div>
            </div>
          </section>

        </div>
      </div>
    </div>
  );
}
