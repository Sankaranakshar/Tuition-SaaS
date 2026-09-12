// B-06c (EXECUTION_PLAN.md Step 17): which org a multi-membership user is
// currently "acting in" client-side, mirroring server/middleware/auth.ts's
// loadMembership() resolution so a client independently lands on the same
// default the server would pick with no X-Organization-Id header.
//
// Zod-free on purpose (same rule as shared/creditExpiry.ts / shared/consent.ts):
// imported directly by the client (AuthContext.tsx), and a shared/ file that
// builds Zod schemas drags Zod into the browser bundle.

export interface OrganizationMembership {
  organizationId: string;
  organizationName: string | null;
  role: string;
}

/**
 * Resolution order: the persisted choice, if it's still in the fetched
 * membership list -> else the earliest-created membership (first entry,
 * since callers pass `organizations` already ordered earliest-first by
 * `GET /api/v1/members/me/organizations` — today's behavior for a
 * single-org user, so this is a no-op for them) -> else null if the caller
 * has no memberships at all (the bootstrap flow handles that case).
 */
export function resolveActiveOrganizationId(
  persistedOrgId: string | null,
  organizations: OrganizationMembership[]
): string | null {
  if (persistedOrgId && organizations.some((org) => org.organizationId === persistedOrgId)) {
    return persistedOrgId;
  }
  return organizations[0]?.organizationId ?? null;
}
