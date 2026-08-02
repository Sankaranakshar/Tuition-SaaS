import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../supabase";
import { toast } from "sonner";
import { UserPlus, Copy } from "lucide-react";
import { createStaffInvite, type InvitableStaffRole } from "../lib/api";

// Tech Debt #1: no org could ever get a second staff member because there was
// no invite UI. Members list is a direct client read (org_members_select RLS
// lets any org member see their own org's roster); inviting is server-
// mediated via POST /members/invites (organization_members has no client
// write policy at all).
interface Member {
  userId: string;
  name: string;
  email: string;
  role: string;
}

const ROLE_LABELS: Record<string, string> = {
  owner: "Owner",
  admin: "Admin",
  tutor: "Tutor",
  frontdesk: "Front Desk",
  accountant: "Accountant",
};

export default function TeamSettings() {
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [inviteRole, setInviteRole] = useState<InvitableStaffRole>("tutor");
  const [generating, setGenerating] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<string | null>(null);

  const isOwner = user?.organizationRole === "owner";
  const canInvite = isOwner || user?.organizationRole === "admin";

  const loadMembers = useCallback(async () => {
    if (!user?.organizationId) return;
    setLoading(true);
    const { data: rows, error } = await supabase
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", user.organizationId);
    if (error) {
      setLoading(false);
      return;
    }
    const userIds = (rows || []).map((r: any) => r.user_id);
    const { data: profiles } = userIds.length
      ? await supabase.from("profiles").select("id, name, email").in("id", userIds)
      : { data: [] as any[] };
    const profileById = new Map((profiles || []).map((p: any) => [p.id, p]));
    setMembers(
      (rows || []).map((r: any) => ({
        userId: r.user_id,
        role: r.role,
        name: profileById.get(r.user_id)?.name || "Unnamed",
        email: profileById.get(r.user_id)?.email || "",
      }))
    );
    setLoading(false);
  }, [user?.organizationId]);

  useEffect(() => {
    loadMembers();
  }, [loadMembers]);

  const generateInvite = async () => {
    setGenerating(true);
    setInviteLink(null);
    try {
      const result = await createStaffInvite(inviteRole);
      setInviteLink(`${window.location.origin}/onboarding?staffInvite=${result.token}`);
      setExpiresAt(result.expiresAt);
    } catch (err: any) {
      toast.error("Could not generate invite", { description: err.message });
    } finally {
      setGenerating(false);
    }
  };

  const copyLink = async () => {
    if (!inviteLink) return;
    await navigator.clipboard.writeText(inviteLink);
    toast.success("Link copied");
  };

  if (!canInvite) {
    return <div className="p-4 text-sm text-[var(--cs-text-muted)]">You do not have permission to manage the team.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-[var(--cs-surface)] rounded-[10px] shadow-sm border border-[var(--cs-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--cs-border)]">
          <h2 className="text-lg font-semibold text-[var(--cs-text)]">Team Members</h2>
          <p className="mt-1 text-sm text-[var(--cs-text-muted)]">Everyone with access to this organization.</p>
        </div>
        <div className="p-6">
          {loading ? (
            <p className="text-sm text-[var(--cs-text-muted)]">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-[var(--cs-text-muted)]">No members yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--cs-border)]">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium text-[var(--cs-text)]">{m.name}</div>
                    <div className="text-xs text-[var(--cs-text-muted)]">{m.email}</div>
                  </div>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-[var(--cs-bg)] text-[var(--cs-text-muted)] capitalize">
                    {ROLE_LABELS[m.role] || m.role}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-[var(--cs-surface)] rounded-[10px] shadow-sm border border-[var(--cs-border)] overflow-hidden">
        <div className="px-6 py-4 border-b border-[var(--cs-border)]">
          <h2 className="text-lg font-semibold text-[var(--cs-text)] flex items-center gap-2">
            <UserPlus className="w-5 h-5" /> Invite a staff member
          </h2>
          <p className="mt-1 text-sm text-[var(--cs-text-muted)]">Generate a one-time link that grants the selected role once redeemed.</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-end gap-3">
            <div>
              <label htmlFor="team-invite-role" className="block text-sm font-medium text-[var(--cs-text-muted)]">Role</label>
              <select
                id="team-invite-role"
                value={inviteRole}
                onChange={(e) => {
                  setInviteRole(e.target.value as InvitableStaffRole);
                  setInviteLink(null);
                }}
                className="mt-1 block rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-2 px-3 text-sm outline-none focus:border-[var(--cs-accent)]"
              >
                <option value="tutor">Tutor</option>
                <option value="frontdesk">Front Desk</option>
                <option value="accountant">Accountant</option>
                {isOwner && <option value="admin">Admin</option>}
              </select>
            </div>
            <button
              onClick={generateInvite}
              disabled={generating}
              className="rounded-[6px] bg-[var(--cs-accent)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate invite link"}
            </button>
          </div>

          {inviteLink && (
            <div className="space-y-1">
              <div className="flex gap-2">
                <input readOnly value={inviteLink} className="w-full rounded-[6px] border border-[var(--cs-border)] bg-[var(--cs-bg)] px-3 py-2 text-xs text-[var(--cs-text-muted)]" />
                <button onClick={copyLink} className="shrink-0 rounded-[6px] border border-[var(--cs-border)] px-3 py-2 text-[var(--cs-text-muted)] hover:bg-[var(--cs-bg)]">
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              {expiresAt && <p className="text-xs text-[var(--cs-text-muted)]">Expires {new Date(expiresAt).toLocaleDateString()}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
