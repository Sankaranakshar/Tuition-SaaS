import { describe, it, expect } from "vitest";
import { resolveActiveOrganizationId, type OrganizationMembership } from "../../shared/activeOrganization.ts";

const orgA: OrganizationMembership = { organizationId: "org-a", organizationName: "Org A", role: "owner" };
const orgB: OrganizationMembership = { organizationId: "org-b", organizationName: "Org B", role: "tutor" };

describe("resolveActiveOrganizationId (B-06c, EXECUTION_PLAN.md Step 17)", () => {
  it("keeps the persisted choice when it's still in the membership list", () => {
    expect(resolveActiveOrganizationId("org-b", [orgA, orgB])).toBe("org-b");
  });

  it("falls back to the earliest (first) membership when nothing is persisted", () => {
    expect(resolveActiveOrganizationId(null, [orgA, orgB])).toBe("org-a");
  });

  it("falls back to the earliest membership when the persisted org is no longer in the list (e.g. removed)", () => {
    expect(resolveActiveOrganizationId("org-c", [orgA, orgB])).toBe("org-a");
  });

  it("returns null when the caller has no memberships at all", () => {
    expect(resolveActiveOrganizationId(null, [])).toBeNull();
    expect(resolveActiveOrganizationId("org-a", [])).toBeNull();
  });

  it("is a no-op for a single-org user regardless of what's persisted", () => {
    expect(resolveActiveOrganizationId(null, [orgA])).toBe("org-a");
    expect(resolveActiveOrganizationId("org-a", [orgA])).toBe("org-a");
    expect(resolveActiveOrganizationId("stale-org", [orgA])).toBe("org-a");
  });
});
