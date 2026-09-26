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

// ---- Activation analytics (C-07, EXECUTION_PLAN.md Step 32) ----

const DAY_MS = 24 * 60 * 60 * 1000;

export type ActivationStatus =
  | { kind: "activated"; activatedAt: string }
  | { kind: "in_window"; daysLeft: number }
  | { kind: "not_activated" };

/** Where an org stands against the 14-day activation window, as of `now`. */
export function activationStatus(row: { activatedAt: string | null; windowEndsAt: string }, now: Date): ActivationStatus {
  if (row.activatedAt) return { kind: "activated", activatedAt: row.activatedAt };
  const msLeft = new Date(row.windowEndsAt).getTime() - now.getTime();
  if (msLeft > 0) return { kind: "in_window", daysLeft: Math.ceil(msLeft / DAY_MS) };
  return { kind: "not_activated" };
}

/** 0.4567 -> "46%"; null -> "–" (a step whose previous step is empty has no rate). */
export function formatRate(rate: number | null): string {
  return rate === null ? "–" : `${Math.round(rate * 100)}%`;
}

/** A cohort cell: "2 of 3 (67%)", or "–" for a week that hasn't happened yet. */
export function formatCohortCell(retained: number | null, size: number): string {
  if (retained === null) return "–";
  return size > 0 ? `${retained} of ${size} (${Math.round((retained / size) * 100)}%)` : "0";
}

/** "2026-09" -> "Sep 2026". */
export function formatMonthKey(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-IN", { month: "short", year: "numeric", timeZone: "UTC" });
}

/** "student_story" -> "Student story". */
export function featureLabel(feature: string): string {
  const s = feature.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}
