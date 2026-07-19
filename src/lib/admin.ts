import type { OrgHealth } from "../../shared/schemas/admin";

// Pure formatting/derivation helpers for the super-admin console
// (src/pages/PlatformAdmin.tsx). Kept out of the page component per this
// codebase's standing rule (pure lib + thin page).

const STALE_DAYS = 14;

/** Days since an org's most recent audit_events entry, or null if it has none yet. */
export function daysSinceActivity(lastActivityAt: string | null, now: Date): number | null {
  if (!lastActivityAt) return null;
  const ms = now.getTime() - new Date(lastActivityAt).getTime();
  return Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
}

/** Orgs with no activity in the last STALE_DAYS days (or none ever) — the support/churn-risk signal. */
export function isStale(lastActivityAt: string | null, now: Date): boolean {
  const days = daysSinceActivity(lastActivityAt, now);
  return days === null || days >= STALE_DAYS;
}

/** Sorts orgs least-recently-active first, so the console surfaces support-attention candidates up top. */
export function sortByStaleness(orgs: OrgHealth[]): OrgHealth[] {
  return [...orgs].sort((a, b) => {
    const da = a.lastActivityAt ? new Date(a.lastActivityAt).getTime() : -Infinity;
    const db = b.lastActivityAt ? new Date(b.lastActivityAt).getTime() : -Infinity;
    return da - db;
  });
}

export function usageFraction(activeStudentCount: number, studentLimit: number | null): number {
  if (studentLimit === null || studentLimit <= 0) return 0;
  return Math.min(1, activeStudentCount / studentLimit);
}
