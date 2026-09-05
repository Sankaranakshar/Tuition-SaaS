import { describe, it, expect } from "vitest";
import { resolveErasurePolicy, DEFAULT_ERASURE_POLICY } from "../../shared/erasure.ts";
import { canConfirmErase } from "../../src/lib/erasure.ts";

describe("resolveErasurePolicy (B-11)", () => {
  it("defaults to 'block' when settings has no erasure key", () => {
    expect(resolveErasurePolicy(undefined)).toEqual(DEFAULT_ERASURE_POLICY);
    expect(resolveErasurePolicy(null)).toEqual({ walletPolicy: "block" });
  });

  it("reads an explicit 'writeoff'", () => {
    expect(resolveErasurePolicy({ walletPolicy: "writeoff" })).toEqual({ walletPolicy: "writeoff" });
  });

  it("treats any other value as 'block' (fail safe — never move money on garbage)", () => {
    expect(resolveErasurePolicy({ walletPolicy: "delete-everything" })).toEqual({ walletPolicy: "block" });
    expect(resolveErasurePolicy({ walletPolicy: 42 })).toEqual({ walletPolicy: "block" });
    expect(resolveErasurePolicy("writeoff")).toEqual({ walletPolicy: "block" });
  });
});

describe("canConfirmErase", () => {
  it("requires an exact, case-sensitive match ignoring surrounding whitespace", () => {
    expect(canConfirmErase("Aarav Mehta", "Aarav Mehta")).toBe(true);
    expect(canConfirmErase("Aarav Mehta", "  Aarav Mehta  ")).toBe(true);
    expect(canConfirmErase("Aarav Mehta", "aarav mehta")).toBe(false);
    expect(canConfirmErase("Aarav Mehta", "Aarav")).toBe(false);
    expect(canConfirmErase("Aarav Mehta", "")).toBe(false);
    expect(canConfirmErase("", "")).toBe(false);
  });
});
