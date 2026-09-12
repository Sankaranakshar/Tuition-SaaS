import { Fragment, useEffect, useState } from "react";
import { toast } from "sonner";
import { ShieldAlert, ExternalLink, Flag } from "lucide-react";
import { listOrgsForAdmin, listOrgMembersForAdmin, setOrgFeatureFlag, impersonateUser, type OrgMember } from "../lib/api";
import { useIsPlatformAdmin } from "../hooks/usePlatformAdmin";
import { daysSinceActivity, isStale, sortByStaleness, usageFraction } from "../lib/admin";
import { formatPlanPrice, PLAN_CATALOG } from "../lib/subscription";
import type { OrgHealth } from "../../shared/schemas/admin";
import { EmptyState, SkeletonRow } from "../components/kit";

// Stage 3 super-admin console (DEV_PLAN §5, old E16.2). Gated by
// requirePlatformAdmin server-side on every request this page makes — the
// client-side useIsPlatformAdmin() check below only controls whether this
// page renders at all, it is not itself a security boundary.
export default function PlatformAdmin() {
  const isPlatformAdmin = useIsPlatformAdmin();
  const [orgs, setOrgs] = useState<OrgHealth[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedOrgId, setExpandedOrgId] = useState<string | null>(null);
  const [members, setMembers] = useState<OrgMember[]>([]);
  const [membersLoading, setMembersLoading] = useState(false);

  useEffect(() => {
    if (!isPlatformAdmin) return;
    setLoading(true);
    listOrgsForAdmin()
      .then((res) => setOrgs(sortByStaleness(res.orgs)))
      .catch((err) => setError(err?.message || "Failed to load organizations"))
      .finally(() => setLoading(false));
  }, [isPlatformAdmin]);

  const toggleExpanded = async (orgId: string) => {
    if (expandedOrgId === orgId) {
      setExpandedOrgId(null);
      return;
    }
    setExpandedOrgId(orgId);
    setMembersLoading(true);
    try {
      const res = await listOrgMembersForAdmin(orgId);
      setMembers(res.members);
    } catch (err: any) {
      toast.error(err?.message || "Failed to load members");
    } finally {
      setMembersLoading(false);
    }
  };

  const handleImpersonate = async (userId: string, label: string) => {
    try {
      const res = await impersonateUser(userId);
      await navigator.clipboard.writeText(res.actionLink).catch(() => {});
      toast.success(`Login link for ${label} copied to clipboard`, {
        description: "Logged to this org's audit trail and the platform admin log.",
      });
      window.open(res.actionLink, "_blank", "noopener,noreferrer");
    } catch (err: any) {
      toast.error(err?.message || "Failed to generate a login link");
    }
  };

  const handleBetaFlag = async (orgId: string, enabled: boolean) => {
    try {
      await setOrgFeatureFlag(orgId, "beta", enabled);
      toast.success(enabled ? "Beta features enabled" : "Beta features disabled");
    } catch (err: any) {
      toast.error(err?.message || "Failed to update feature flag");
    }
  };

  if (!isPlatformAdmin) {
    return (
      <div className="p-8">
        <EmptyState
          icon={ShieldAlert}
          title="Not authorized"
          description="This page is restricted to ClassStackr platform admins."
        />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-[20px] font-semibold tracking-[-0.01em] text-[var(--cs-text)]">Platform admin</h1>
        <p className="text-sm text-[var(--cs-text-muted)]">Every organization on ClassStackr, sorted by least-recently-active first.</p>
      </div>

      {error && <div className="rounded-[var(--cs-radius-control)] bg-[var(--cs-danger-soft)] p-3 text-sm text-[var(--cs-danger)]">{error}</div>}

      <div className="overflow-hidden rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)]">
        <table className="min-w-full divide-y divide-[var(--cs-border)] text-sm">
          <thead className="bg-[var(--cs-surface-2)] text-left text-xs font-medium uppercase tracking-wide text-[var(--cs-text-faint)]">
            <tr>
              <th className="px-4 py-2">Organization</th>
              <th className="px-4 py-2">Plan</th>
              <th className="px-4 py-2">Students</th>
              <th className="px-4 py-2">Members</th>
              <th className="px-4 py-2">Last activity</th>
              <th className="px-4 py-2"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--cs-border)]">
            {loading && Array.from({ length: 4 }).map((_, i) => (
              <tr key={i}><td colSpan={6} className="px-4 py-3"><SkeletonRow /></td></tr>
            ))}
            {!loading && orgs.length === 0 && (
              <tr><td colSpan={6}><EmptyState title="No organizations yet" description="Nothing has signed up." /></td></tr>
            )}
            {orgs.map((org) => {
              const stale = isStale(org.lastActivityAt, new Date());
              const days = daysSinceActivity(org.lastActivityAt, new Date());
              const fraction = usageFraction(org.activeStudentCount, org.studentLimit);
              return (
                <Fragment key={org.id}>
                  <tr className="cursor-pointer transition-colors duration-[var(--cs-motion-fast)] hover:bg-[var(--cs-surface-2)]" onClick={() => toggleExpanded(org.id)}>
                    <td className="px-4 py-3 font-medium text-[var(--cs-text)]">{org.name}</td>
                    <td className="px-4 py-3 text-[var(--cs-text-muted)]">
                      {PLAN_CATALOG[org.plan as keyof typeof PLAN_CATALOG]?.name || org.plan}
                      <span className="text-[var(--cs-text-faint)]"> · {formatPlanPrice(PLAN_CATALOG[org.plan as keyof typeof PLAN_CATALOG]?.pricePaise ?? 0)}</span>
                    </td>
                    <td className="px-4 py-3 text-[var(--cs-text-muted)]">
                      {org.activeStudentCount}{org.studentLimit !== null ? ` / ${org.studentLimit}` : ""}
                      {fraction >= 0.8 && <span className="ml-2 text-xs text-[var(--cs-text-muted)]">near cap</span>}
                    </td>
                    <td className="px-4 py-3 text-[var(--cs-text-muted)]">{org.memberCount}</td>
                    <td className="px-4 py-3">
                      <span className={stale ? "font-medium text-[var(--cs-danger)]" : "text-[var(--cs-text-muted)]"}>
                        {days === null ? "Never" : days === 0 ? "Today" : `${days}d ago`}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        onClick={(e) => { e.stopPropagation(); handleBetaFlag(org.id, true); }}
                        className="inline-flex items-center gap-1 text-xs text-[var(--cs-text-muted)] transition-colors duration-[var(--cs-motion-fast)] hover:text-[var(--cs-accent)]"
                        title="Enable beta features for this org"
                      >
                        <Flag className="w-3.5 h-3.5" strokeWidth={1.75} /> Beta
                      </button>
                    </td>
                  </tr>
                  {expandedOrgId === org.id && (
                    <tr>
                      <td colSpan={6} className="bg-[var(--cs-surface-2)] px-4 py-3">
                        {membersLoading ? (
                          <SkeletonRow />
                        ) : (
                          <div className="space-y-1">
                            {members.map((m) => (
                              <div key={m.user_id} className="flex items-center justify-between py-1 text-sm">
                                <span className="text-[var(--cs-text)]">
                                  {m.profiles?.name || m.profiles?.email || m.user_id}
                                  <span className="ml-2 capitalize text-[var(--cs-text-faint)]">{m.role}</span>
                                </span>
                                <button
                                  onClick={(e) => { e.stopPropagation(); handleImpersonate(m.user_id, m.profiles?.name || m.profiles?.email || m.user_id); }}
                                  className="inline-flex items-center gap-1 text-xs text-[var(--cs-accent)] transition-colors duration-[var(--cs-motion-fast)] hover:text-[var(--cs-accent-hover)]"
                                >
                                  <ExternalLink className="w-3.5 h-3.5" strokeWidth={1.75} /> Log in as
                                </button>
                              </div>
                            ))}
                            {members.length === 0 && <p className="text-sm text-[var(--cs-text-muted)]">No members.</p>}
                          </div>
                        )}
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
