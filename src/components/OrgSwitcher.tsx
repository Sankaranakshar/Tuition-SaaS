import { useRef, useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronDown, Check } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { switchActiveOrganization } from "../lib/api";

// B-07 (EXECUTION_PLAN.md Step 20): the rail's reserved org-switcher slot
// (previously a dashed placeholder in Layout.tsx). A no-op for anyone with
// zero or one membership — matches Step 17's rule that multi-org plumbing
// must not change a single-org user's experience at all.
export default function OrgSwitcher() {
  const { user, activeOrganizationId, setActiveOrganizationId, checkAuth } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [switching, setSwitching] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const organizations = user?.organizations ?? [];
  if (organizations.length < 2) return null;

  const active = organizations.find((org) => org.organizationId === activeOrganizationId) ?? organizations[0];

  const handleSwitch = async (organizationId: string) => {
    if (organizationId === activeOrganizationId || switching) {
      setOpen(false);
      return;
    }
    setSwitching(true);
    try {
      await switchActiveOrganization(organizationId);
      setActiveOrganizationId(organizationId);
      // Re-resolves `user` end to end (organizationId/organizationRole and
      // the org list itself) from the server — every org-scoped hook derives
      // its query params reactively from `user`, so this alone is enough to
      // refresh the whole app to the new org's data (src/hooks/useRealtimeList.ts
      // re-subscribes on [orgId, table] changing). No page reload needed.
      await checkAuth();
      setOpen(false);
      navigate("/app");
    } catch (error) {
      console.error("Failed to switch organization", error);
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className="relative mb-2 mt-1.5 w-full" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={switching}
        title={active?.organizationName || "Organization"}
        className="flex h-[30px] w-full items-center justify-center gap-0.5 rounded-[var(--cs-radius-control)] border border-[var(--cs-border-strong)] px-1 text-[10px] font-medium text-[var(--cs-text-muted)] transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] hover:bg-[var(--cs-surface-2)] hover:text-[var(--cs-text)] disabled:opacity-60"
      >
        <span className="max-w-[54px] truncate">{active?.organizationName || "Org"}</span>
        <ChevronDown className="h-3 w-3 shrink-0" strokeWidth={1.75} />
      </button>

      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-56 rounded-[var(--cs-radius-container)] border border-[var(--cs-border)] bg-[var(--cs-surface)] py-1 shadow-[var(--cs-shadow-pop)]">
          <div className="border-b border-[var(--cs-border)] px-3 py-2 text-xs font-medium text-[var(--cs-text-muted)]">
            Switch organization
          </div>
          {organizations.map((org) => (
            <button
              key={org.organizationId}
              onClick={() => handleSwitch(org.organizationId)}
              className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm transition-colors duration-[var(--cs-motion-fast)] ease-[var(--cs-ease-out)] ${
                org.organizationId === activeOrganizationId
                  ? "bg-[var(--cs-accent-soft)] font-medium text-[var(--cs-accent)]"
                  : "text-[var(--cs-text)] hover:bg-[var(--cs-surface-2)]"
              }`}
            >
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{org.organizationName || "Untitled org"}</span>
                <span className="text-[11px] capitalize text-[var(--cs-text-muted)]">{org.role}</span>
              </span>
              {org.organizationId === activeOrganizationId && (
                <Check className="h-4 w-4 shrink-0" strokeWidth={1.75} />
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
