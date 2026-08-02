import { describe, it, expect } from "vitest";
import { rupeesToPaise, paiseToRupees } from "../../shared/money";

describe("rupeesToPaise", () => {
  it("converts whole rupees exactly", () => {
    expect(rupeesToPaise(500)).toBe(50000);
  });
  it("converts fractional rupees without float drift", () => {
    expect(rupeesToPaise(123.45)).toBe(12345);
    expect(rupeesToPaise(0.1)).toBe(10);
  });
  it("rounds to the nearest paisa", () => {
    expect(rupeesToPaise(1.004)).toBe(100);
    expect(rupeesToPaise(1.006)).toBe(101);
  });
  it("handles zero", () => {
    expect(rupeesToPaise(0)).toBe(0);
  });
});

describe("paiseToRupees", () => {
  it("converts integer paise back to rupees", () => {
    expect(paiseToRupees(50000)).toBe(500);
    expect(paiseToRupees(12345)).toBe(123.45);
  });
  it("handles zero", () => {
    expect(paiseToRupees(0)).toBe(0);
  });
  it("round-trips with rupeesToPaise for typical fee amounts", () => {
    for (const rupees of [100, 250.5, 999.99, 1500]) {
      expect(paiseToRupees(rupeesToPaise(rupees))).toBeCloseTo(rupees, 9);
    }
  });
});
