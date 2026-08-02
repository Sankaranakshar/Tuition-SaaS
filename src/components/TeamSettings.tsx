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
    return <div className="p-4 text-sm text-gray-500">You do not have permission to manage the team.</div>;
  }

  return (
    <div className="space-y-6">
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900">Team Members</h2>
          <p className="mt-1 text-sm text-gray-500">Everyone with access to this organization.</p>
        </div>
        <div className="p-6">
          {loading ? (
            <p className="text-sm text-gray-500">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-gray-500">No members yet.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between py-3">
                  <div>
                    <div className="text-sm font-medium text-gray-900">{m.name}</div>
                    <div className="text-xs text-gray-500">{m.email}</div>
                  </div>
                  <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700 capitalize">
                    {ROLE_LABELS[m.role] || m.role}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
            <UserPlus className="w-5 h-5" /> Invite a staff member
          </h2>
          <p className="mt-1 text-sm text-gray-500">Generate a one-time link that grants the selected role once redeemed.</p>
        </div>
        <div className="p-6 space-y-4">
          <div className="flex items-end gap-3">
            <div>
              <label htmlFor="team-invite-role" className="block text-sm font-medium text-gray-700">Role</label>
              <select
                id="team-invite-role"
                value={inviteRole}
                onChange={(e) => {
                  setInviteRole(e.target.value as InvitableStaffRole);
                  setInviteLink(null);
                }}
                className="mt-1 block rounded-md border border-gray-300 py-2 px-3 text-sm"
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
              className="rounded-md bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 disabled:opacity-50"
            >
              {generating ? "Generating…" : "Generate invite link"}
            </button>
          </div>

          {inviteLink && (
            <div className="space-y-1">
              <div className="flex gap-2">
                <input readOnly value={inviteLink} className="w-full rounded-md border border-gray-300 bg-gray-50 px-3 py-2 text-xs text-gray-700" />
                <button onClick={copyLink} className="shrink-0 rounded-md border border-gray-300 px-3 py-2 text-gray-500 hover:bg-gray-50">
                  <Copy className="h-4 w-4" />
                </button>
              </div>
              {expiresAt && <p className="text-xs text-gray-400">Expires {new Date(expiresAt).toLocaleDateString()}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
