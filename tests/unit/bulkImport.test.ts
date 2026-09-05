import { describe, it, expect } from "vitest";
import { suggestColumnMapping, parseImportRows, detectDuplicates } from "../../server/utils/bulkImport.ts";

describe("suggestColumnMapping", () => {
  it("maps common header aliases to fields", () => {
    expect(suggestColumnMapping(["Name", "Phone", "Parent Name", "Parent Phone", "Grade", "Subject"])).toEqual([
      "name", "phone", "parentName", "parentPhone", "grade", "subject",
    ]);
  });

  it("returns null for a header it doesn't recognize", () => {
    expect(suggestColumnMapping(["Name", "Favourite Colour"])).toEqual(["name", null]);
  });
});

describe("parseImportRows", () => {
  const mapping = ["name", "phone", "parentName", "parentPhone"] as const as (import("../../server/utils/bulkImport.ts").ImportField | null)[];

  it("maps rows per the confirmed mapping, numbering rows from the spreadsheet's own row 2", () => {
    const result = parseImportRows([
      ["Aarav Mehta", "9876543210", "Sunita Mehta", "9876500000"],
    ], mapping);
    expect(result.errors).toEqual([]);
    expect(result.rows).toEqual([
      { rowIndex: 2, record: { name: "Aarav Mehta", phone: "9876543210", parentName: "Sunita Mehta", parentPhone: "9876500000" } },
    ]);
  });

  it("skips a fully blank row silently", () => {
    const result = parseImportRows([["", ""], ["Riya", "111"]], mapping);
    expect(result.rows).toEqual([{ rowIndex: 3, record: { name: "Riya", phone: "111" } }]);
    expect(result.errors).toEqual([]);
  });

  it("reports a missing name as a per-row error, not a whole-file failure", () => {
    const result = parseImportRows([["", "111"], ["Riya", "222"]], mapping);
    expect(result.errors).toEqual([{ rowIndex: 2, message: "Missing a name." }]);
    expect(result.rows).toEqual([{ rowIndex: 3, record: { name: "Riya", phone: "222" } }]);
  });

  it("ignores a column mapped to null", () => {
    const result = parseImportRows([["Riya", "some notes"]], ["name", null]);
    expect(result.rows).toEqual([{ rowIndex: 2, record: { name: "Riya" } }]);
  });
});

describe("detectDuplicates", () => {
  it("flags a row matching an existing student's name AND phone", () => {
    const rows = [{ rowIndex: 2, record: { name: "Aarav Mehta", phone: "9876543210" } }];
    const existing = [{ id: "s1", name: "Aarav Mehta", phone: "9876543210" }];
    expect(detectDuplicates(rows, existing)).toEqual([
      { rowIndex: 2, name: "Aarav Mehta", phone: "9876543210", matchedStudentId: "s1", matchedStudentName: "Aarav Mehta" },
    ]);
  });

  it("is case/whitespace/punctuation insensitive on both name and phone", () => {
    const rows = [{ rowIndex: 2, record: { name: "  aarav   mehta ", phone: "+91 98765-43210" } }];
    const existing = [{ id: "s1", name: "Aarav Mehta", phone: "9876543210" }];
    expect(detectDuplicates(rows, existing)).toHaveLength(1);
  });

  it("does NOT flag a phone match alone — siblings can share a parent's phone", () => {
    const rows = [{ rowIndex: 2, record: { name: "Kavya Mehta", phone: "9876543210" } }];
    const existing = [{ id: "s1", name: "Aarav Mehta", phone: "9876543210" }];
    expect(detectDuplicates(rows, existing)).toEqual([]);
  });

  it("does NOT flag a name match alone with no phone on either side", () => {
    const rows = [{ rowIndex: 2, record: { name: "Aarav Mehta" } }];
    const existing = [{ id: "s1", name: "Aarav Mehta", phone: null }];
    expect(detectDuplicates(rows, existing)).toEqual([]);
  });

  it("flags a within-file duplicate against the first occurrence, not the DB", () => {
    const rows = [
      { rowIndex: 2, record: { name: "Aarav Mehta", phone: "9876543210" } },
      { rowIndex: 3, record: { name: "Aarav Mehta", phone: "9876543210" } },
    ];
    expect(detectDuplicates(rows, [])).toEqual([
      { rowIndex: 3, name: "Aarav Mehta", phone: "9876543210", matchedRowIndex: 2 },
    ]);
  });
});
