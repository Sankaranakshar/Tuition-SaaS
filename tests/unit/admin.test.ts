import { describe, it, expect } from "vitest";
import { daysSinceActivity, isStale, sortByStaleness, usageFraction } from "../../src/lib/admin";
import type { OrgHealth } from "../../shared/schemas/admin";

const NOW = new Date("2026-07-19T12:00:00Z");

function org(overrides: Partial<OrgHealth>): OrgHealth {
  return {
    id: "org-1",
    name: "Org",
    createdAt: "2026-01-01T00:00:00Z",
    plan: "free",
    subscriptionStatus: "active",
    studentLimit: 15,
    activeStudentCount: 0,
    memberCount: 1,
    lastActivityAt: null,
    ...overrides,
  };
}

describe("daysSinceActivity", () => {
  it("returns null when there's no activity yet", () => {
    expect(daysSinceActivity(null, NOW)).toBeNull();
  });

  it("computes whole days elapsed", () => {
    expect(daysSinceActivity("2026-07-17T12:00:00Z", NOW)).toBe(2);
  });

  it("never goes negative for a timestamp in the future (clock skew)", () => {
    expect(daysSinceActivity("2026-07-20T12:00:00Z", NOW)).toBe(0);
  });
});

describe("isStale", () => {
  it("treats never-active orgs as stale", () => {
    expect(isStale(null, NOW)).toBe(true);
  });

  it("treats recent activity as not stale", () => {
    expect(isStale("2026-07-18T12:00:00Z", NOW)).toBe(false);
  });

  it("treats 14+ days of silence as stale", () => {
    expect(isStale("2026-07-05T12:00:00Z", NOW)).toBe(true);
  });
});

describe("sortByStaleness", () => {
  it("puts least-recently-active orgs first, never-active orgs at the very top", () => {
    const orgs = [
      org({ id: "recent", lastActivityAt: "2026-07-19T00:00:00Z" }),
      org({ id: "never", lastActivityAt: null }),
      org({ id: "old", lastActivityAt: "2026-07-01T00:00:00Z" }),
    ];
    expect(sortByStaleness(orgs).map((o) => o.id)).toEqual(["never", "old", "recent"]);
  });
});

describe("usageFraction", () => {
  it("computes a 0-1 fraction against the cap", () => {
    expect(usageFraction(3, 15)).toBeCloseTo(0.2);
  });

  it("caps at 1 even over the limit", () => {
    expect(usageFraction(20, 15)).toBe(1);
  });

  it("is 0 for an unlimited plan", () => {
    expect(usageFraction(500, null)).toBe(0);
  });
});
