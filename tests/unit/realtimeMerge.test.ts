import { describe, it, expect } from "vitest";
import { applyRealtimeChange, type RealtimeMergeConfig } from "../../src/hooks/realtimeMerge";

interface Row {
  id: string;
  name: string;
  at: string;
}

function row(id: string, name = id, at = "2026-01-01T00:00:00Z"): Row {
  return { id, name, at };
}

const baseConfig: RealtimeMergeConfig<Row> = {
  mapRow: (raw: any) => ({ id: raw.id, name: raw.name, at: raw.at }),
  getId: (r) => r.id,
};

describe("applyRealtimeChange", () => {
  it("updates a row in place on UPDATE, preserving position", () => {
    const current = [row("a"), row("b"), row("c")];
    const result = applyRealtimeChange(
      current,
      { eventType: "UPDATE", new: { id: "b", name: "b-renamed", at: "2026-01-01T00:00:00Z" }, old: { id: "b" } },
      baseConfig
    );
    expect(result.refetch).toBe(false);
    expect(result.data.map((r) => r.name)).toEqual(["a", "b-renamed", "c"]);
  });

  it("appends a new row on INSERT when no compare is given", () => {
    const current = [row("a")];
    const result = applyRealtimeChange(
      current,
      { eventType: "INSERT", new: { id: "b", name: "b", at: "2026-01-01T00:00:00Z" }, old: {} },
      baseConfig
    );
    expect(result.refetch).toBe(false);
    expect(result.data.map((r) => r.id)).toEqual(["a", "b"]);
  });

  it("inserts a new row at the correct sorted index when compare is given", () => {
    const current = [row("a", "a", "2026-01-03T00:00:00Z"), row("c", "c", "2026-01-01T00:00:00Z")];
    const config: RealtimeMergeConfig<Row> = {
      ...baseConfig,
      compare: (x, y) => (x.at < y.at ? 1 : x.at > y.at ? -1 : 0), // newest first
    };
    const result = applyRealtimeChange(
      current,
      { eventType: "INSERT", new: { id: "b", name: "b", at: "2026-01-02T00:00:00Z" }, old: {} },
      config
    );
    expect(result.data.map((r) => r.id)).toEqual(["a", "b", "c"]);
  });

  it("removes a row on DELETE by matching the default getId-derived key", () => {
    const current = [row("a"), row("b")];
    const result = applyRealtimeChange(current, { eventType: "DELETE", new: {}, old: { id: "a" } }, baseConfig);
    expect(result.refetch).toBe(false);
    expect(result.data.map((r) => r.id)).toEqual(["b"]);
  });

  it("falls back to refetch on DELETE when getDeleteKey can't recover the identity", () => {
    // Simulates a table (e.g. wallets) keyed by a field other than the DB
    // primary key, where the default replica identity means `old` on DELETE
    // only carries the PK — not enough to know which list entry to drop.
    const current = [{ studentId: "s1", balance: 5 }];
    const config: RealtimeMergeConfig<{ studentId: string; balance: number }> = {
      mapRow: (raw: any) => ({ studentId: raw.student_id, balance: raw.balance_credits }),
      getId: (r) => r.studentId,
      getDeleteKey: () => undefined, // old = { id: <wallet uuid> }, no student_id present
    };
    const result = applyRealtimeChange(
      current,
      { eventType: "DELETE", new: {}, old: { id: "wallet-uuid" } },
      config
    );
    expect(result.refetch).toBe(true);
    expect(result.data).toBe(current); // untouched
  });

  it("ignores an INSERT/UPDATE for a row that never belonged to this view and isn't tracked", () => {
    const current = [row("a")];
    const config: RealtimeMergeConfig<Row> = {
      ...baseConfig,
      belongsToView: (raw: any) => raw.tutor_id === "me",
    };
    const result = applyRealtimeChange(
      current,
      { eventType: "INSERT", new: { id: "z", name: "z", at: "x", tutor_id: "someone-else" }, old: {} },
      config
    );
    expect(result.refetch).toBe(false);
    expect(result.data).toBe(current);
  });

  it("drops a tracked row that left view/scope and requests a refetch", () => {
    const current = [row("a"), row("b")];
    const config: RealtimeMergeConfig<Row> = {
      ...baseConfig,
      belongsToView: (raw: any) => raw.tutor_id === "me",
    };
    const result = applyRealtimeChange(
      current,
      { eventType: "UPDATE", new: { id: "b", name: "b", at: "x", tutor_id: "reassigned" }, old: { id: "b" } },
      config
    );
    expect(result.refetch).toBe(true);
    expect(result.data.map((r) => r.id)).toEqual(["a"]);
  });

  it("requests a refetch on UPDATE for a row that now belongs in view but wasn't tracked locally", () => {
    const current = [row("a")];
    const config: RealtimeMergeConfig<Row> = {
      ...baseConfig,
      belongsToView: () => true,
    };
    const result = applyRealtimeChange(
      current,
      { eventType: "UPDATE", new: { id: "new-to-us", name: "n", at: "x" }, old: { id: "new-to-us" } },
      config
    );
    expect(result.refetch).toBe(true);
    expect(result.data).toBe(current);
  });

  it("treats a bounds check (e.g. a schedule week range) the same as any other belongsToView exit", () => {
    const weekStart = "2026-07-06T00:00:00Z";
    const weekEnd = "2026-07-13T00:00:00Z";
    const config: RealtimeMergeConfig<Row> = {
      ...baseConfig,
      belongsToView: (raw: any) => raw.at >= weekStart && raw.at < weekEnd,
    };
    const current = [row("session-1", "s1", "2026-07-08T00:00:00Z")];
    // Rescheduled to next week — should disappear from this week's view and trigger a refetch.
    const result = applyRealtimeChange(
      current,
      { eventType: "UPDATE", new: { id: "session-1", name: "s1", at: "2026-07-15T00:00:00Z" }, old: { id: "session-1" } },
      config
    );
    expect(result.refetch).toBe(true);
    expect(result.data).toEqual([]);
  });
});
