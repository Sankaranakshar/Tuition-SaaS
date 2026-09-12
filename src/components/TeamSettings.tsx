import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../context/AuthContext";
import { supabase } from "../supabase";
import { toast } from "sonner";
import { UserPlus, Copy } from "lucide-react";
import { createStaffInvite, getTutorRates, setTutorRate, type InvitableStaffRole } from "../lib/api";
import { Button } from "./kit";

const SELECT_CLASS =
  "mt-1 block rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface)] px-3 py-1.5 text-[13px] text-[var(--cs-text)] outline-none transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] focus:border-[var(--cs-focus)] focus:ring-2 focus:ring-[var(--cs-focus)]/30";
const RATE_FIELD_CLASS =
  "w-24 rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface)] px-2 py-1 text-[13px] text-[var(--cs-text)] outline-none transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] focus:border-[var(--cs-focus)] focus:ring-2 focus:ring-[var(--cs-focus)]/30";

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

  // B-08 (EXECUTION_PLAN.md Step 21): tutor pay rates, owner/admin only.
  // Rupees in the input (matches every other money field this settings form
  // exposes), converted to paise at the API boundary.
  const [rates, setRates] = useState<Record<string, number>>({});
  const [rateDrafts, setRateDrafts] = useState<Record<string, string>>({});
  const [savingRateFor, setSavingRateFor] = useState<string | null>(null);

  const isOwner = user?.organizationRole === "owner";
  const canInvite = isOwner || user?.organizationRole === "admin";
  const canSetRates = canInvite;

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

  useEffect(() => {
    if (!canSetRates) return;
    getTutorRates()
      .then((res) => {
        const byTutor: Record<string, number> = {};
        const drafts: Record<string, string> = {};
        for (const r of res.rates) {
          byTutor[r.tutorId] = r.hourlyRatePaise;
          drafts[r.tutorId] = String(r.hourlyRatePaise / 100);
        }
        setRates(byTutor);
        setRateDrafts(drafts);
      })
      .catch(() => {});
  }, [canSetRates, user?.organizationId]);

  const saveRate = async (tutorId: string) => {
    const rupees = parseFloat(rateDrafts[tutorId] || "0");
    if (Number.isNaN(rupees) || rupees < 0) {
      toast.error("Enter a valid, non-negative rate");
      return;
    }
    const hourlyRatePaise = Math.round(rupees * 100);
    setSavingRateFor(tutorId);
    try {
      await setTutorRate(tutorId, hourlyRatePaise);
      setRates((prev) => ({ ...prev, [tutorId]: hourlyRatePaise }));
      toast.success("Pay rate saved");
    } catch (err: any) {
      toast.error("Could not save pay rate", { description: err.message });
    } finally {
      setSavingRateFor(null);
    }
  };

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
      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <div className="border-b border-[var(--cs-border)] px-4 py-3">
          <h2 className="text-sm font-semibold text-[var(--cs-text)]">Team members</h2>
          <p className="mt-1 text-xs text-[var(--cs-text-muted)]">Everyone with access to this organization.</p>
        </div>
        <div className="p-4">
          {loading ? (
            <p className="text-sm text-[var(--cs-text-muted)]">Loading…</p>
          ) : members.length === 0 ? (
            <p className="text-sm text-[var(--cs-text-muted)]">No members yet.</p>
          ) : (
            <ul className="divide-y divide-[var(--cs-border)]">
              {members.map((m) => (
                <li key={m.userId} className="flex items-center justify-between py-3 gap-4">
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--cs-text)]">{m.name}</div>
                    <div className="text-xs text-[var(--cs-text-muted)]">{m.email}</div>
                  </div>
                  <div className="flex items-center gap-3">
                    {canSetRates && m.role === "tutor" && (
                      <div className="flex items-center gap-1.5">
                        <label htmlFor={`rate-${m.userId}`} className="text-xs text-[var(--cs-text-muted)]">
                          Pay rate (₹/hr)
                        </label>
                        <input
                          id={`rate-${m.userId}`}
                          type="number"
                          min={0}
                          step="0.01"
                          value={rateDrafts[m.userId] ?? ""}
                          onChange={(e) => setRateDrafts((prev) => ({ ...prev, [m.userId]: e.target.value }))}
                          className={RATE_FIELD_CLASS}
                        />
                        <Button
                          variant="ghost"
                          onClick={() => saveRate(m.userId)}
                          disabled={savingRateFor === m.userId || rateDrafts[m.userId] === String((rates[m.userId] ?? 0) / 100)}
                        >
                          {savingRateFor === m.userId ? "Saving…" : "Save"}
                        </Button>
                      </div>
                    )}
                    <span className="inline-flex items-center rounded-full bg-[var(--cs-surface-2)] px-2.5 py-0.5 text-xs font-medium capitalize text-[var(--cs-text-muted)]">
                      {ROLE_LABELS[m.role] || m.role}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <div className="border-b border-[var(--cs-border)] px-4 py-3">
          <h2 className="flex items-center gap-2 text-sm font-semibold text-[var(--cs-text)]">
            <UserPlus className="h-5 w-5" strokeWidth={1.75} /> Invite a staff member
          </h2>
          <p className="mt-1 text-xs text-[var(--cs-text-muted)]">Generate a one-time link that grants the selected role once redeemed.</p>
        </div>
        <div className="space-y-4 p-4">
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
                className={SELECT_CLASS}
              >
                <option value="tutor">Tutor</option>
                <option value="frontdesk">Front Desk</option>
                <option value="accountant">Accountant</option>
                {isOwner && <option value="admin">Admin</option>}
              </select>
            </div>
            <Button onClick={generateInvite} disabled={generating}>
              {generating ? "Generating…" : "Generate invite link"}
            </Button>
          </div>

          {inviteLink && (
            <div className="space-y-1">
              <div className="flex gap-2">
                <input readOnly value={inviteLink} className="w-full rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] bg-[var(--cs-surface-2)] px-3 py-2 text-xs text-[var(--cs-text-muted)]" />
                <Button variant="ghost" onClick={copyLink} icon={Copy} aria-label="Copy invite link" />
              </div>
              {expiresAt && <p className="text-xs text-[var(--cs-text-muted)]">Expires {new Date(expiresAt).toLocaleDateString()}</p>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
