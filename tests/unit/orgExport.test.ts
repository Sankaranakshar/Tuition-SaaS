import { describe, it, expect } from "vitest";
import { canConfirmOffboard } from "../../src/lib/orgExport";

describe("canConfirmOffboard", () => {
  it("accepts an exact match", () => {
    expect(canConfirmOffboard("Bright Minds Learning Center", "Bright Minds Learning Center")).toBe(true);
  });

  it("tolerates surrounding whitespace in the typed input", () => {
    expect(canConfirmOffboard("Bright Minds", "  Bright Minds  ")).toBe(true);
  });

  it("rejects a case mismatch", () => {
    expect(canConfirmOffboard("Bright Minds", "bright minds")).toBe(false);
  });

  it("rejects a partial match", () => {
    expect(canConfirmOffboard("Bright Minds Learning Center", "Bright Minds")).toBe(false);
  });

  it("rejects an empty or whitespace-only input", () => {
    expect(canConfirmOffboard("Bright Minds", "")).toBe(false);
    expect(canConfirmOffboard("Bright Minds", "   ")).toBe(false);
  });
});
