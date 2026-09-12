import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { User, Mail, Phone, MapPin, Users, Edit2, Save } from "lucide-react";
import { supabase } from "../supabase";
import { useAuth } from "../context/AuthContext";
import { StatusChip, Button, Field, Input } from "../components/kit";

export default function Profile() {
  const { t } = useTranslation();
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

  if (loading) return <div className="text-sm text-[var(--cs-text-muted)]">{t("profile.loading")}</div>;

  return (
    <div className="mx-auto max-w-4xl space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--cs-text)]">{t("profile.title")}</h1>
        {isEditing ? (
          <Button icon={Save} onClick={handleSave}>{t("profile.saveChanges")}</Button>
        ) : (
          <Button variant="ghost" icon={Edit2} onClick={() => setIsEditing(true)}>{t("profile.editProfile")}</Button>
        )}
      </div>

      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <h2 className="border-b border-[var(--cs-border)] px-4 py-3 text-sm font-semibold text-[var(--cs-text)]">
          {t("profile.personalInfo")}
        </h2>

        <div className="grid grid-cols-1 gap-6 p-6 md:grid-cols-2">
          {isEditing ? (
            <Field
              label={t("profile.fullName")}
              renderControl={(id) => (
                <Input id={id} value={formData.name || ""} onChange={(e) => setFormData({ ...formData, name: e.target.value })} />
              )}
            />
          ) : (
            <div>
              <p className="text-xs font-medium text-[var(--cs-text-muted)]">{t("profile.fullName")}</p>
              <p className="mt-1 flex items-center text-sm font-medium text-[var(--cs-text)]">
                <User className="mr-2 h-4 w-4 text-[var(--cs-text-muted)]" strokeWidth={1.75} /> {profile?.name || t("profile.notProvided")}
              </p>
            </div>
          )}

          <div>
            <p className="text-xs font-medium text-[var(--cs-text-muted)]">{t("profile.email")}</p>
            <p className="mt-1 flex items-center text-sm font-medium text-[var(--cs-text)]">
              <Mail className="mr-2 h-4 w-4 text-[var(--cs-text-muted)]" strokeWidth={1.75} /> {profile?.email || t("profile.notProvided")}
            </p>
          </div>

          {isEditing ? (
            <Field
              label={t("profile.phone")}
              renderControl={(id) => (
                <Input id={id} value={formData.phone_number || ""} onChange={(e) => setFormData({ ...formData, phone_number: e.target.value })} />
              )}
            />
          ) : (
            <div>
              <p className="text-xs font-medium text-[var(--cs-text-muted)]">{t("profile.phone")}</p>
              <p className="mt-1 flex items-center text-sm font-medium text-[var(--cs-text)]">
                <Phone className="mr-2 h-4 w-4 text-[var(--cs-text-muted)]" strokeWidth={1.75} /> {profile?.phone_number || t("profile.notProvided")}
              </p>
            </div>
          )}

          {isEditing ? (
            <Field
              label={t("profile.school")}
              renderControl={(id) => (
                <Input id={id} value={formData.school || ""} onChange={(e) => setFormData({ ...formData, school: e.target.value })} />
              )}
            />
          ) : (
            <div>
              <p className="text-xs font-medium text-[var(--cs-text-muted)]">{t("profile.school")}</p>
              <p className="mt-1 flex items-center text-sm font-medium text-[var(--cs-text)]">
                <MapPin className="mr-2 h-4 w-4 text-[var(--cs-text-muted)]" strokeWidth={1.75} /> {profile?.school || t("profile.notProvided")}
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <h2 className="border-b border-[var(--cs-border)] px-4 py-3 text-sm font-semibold text-[var(--cs-text)]">
          {t("profile.familyLinking")}
        </h2>

        <div className="p-6">
          <p className="mb-4 text-sm text-[var(--cs-text-muted)]">{t("profile.familyLinkingDescription")}</p>

          <div className="flex items-center justify-between rounded-[var(--cs-radius-control)] border border-[var(--cs-border)] bg-[var(--cs-surface-2)] p-4">
            <div className="flex items-center">
              <div className="mr-4 flex h-10 w-10 items-center justify-center rounded-full bg-[var(--cs-accent-soft)] font-semibold text-[var(--cs-accent)]">
                <Users className="h-4 w-4" strokeWidth={1.75} />
              </div>
              <div>
                <p className="text-sm font-medium text-[var(--cs-text)]">{t("profile.parentGuardian")}</p>
                <p className="text-xs text-[var(--cs-text-muted)]">parent@example.com</p>
              </div>
            </div>
            <StatusChip label={t("profile.linked")} tone="positive" />
          </div>
        </div>
      </div>
    </div>
  );
}
