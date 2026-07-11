import { describe, it, expect } from "vitest";
import {
  defaultOrgName,
  buildClassTemplatePayload,
  validateManualStudentRow,
  parseStudentsCsvRows,
  TEMPLATE_GALLERY,
} from "../../src/lib/onboarding";

describe("defaultOrgName", () => {
  it("uses the name when present", () => {
    expect(defaultOrgName("Priya", "priya@example.com")).toBe("Priya's Tutoring");
  });

  it("falls back to email when name is missing", () => {
    expect(defaultOrgName(null, "priya@example.com")).toBe("priya@example.com's Tutoring");
  });

  it("falls back to 'My' when both are missing", () => {
    expect(defaultOrgName(null, null)).toBe("My's Tutoring");
  });
});

describe("buildClassTemplatePayload", () => {
  it("builds the exact class_templates insert shape for a preset, with student_ids populated at insert time", () => {
    const preset = TEMPLATE_GALLERY[0];
    const payload = buildClassTemplatePayload({
      preset,
      name: "Class 10 Maths batch",
      startHour: 16,
      startMinute: 30,
      organizationId: "org1",
      tutorId: "tutor1",
      studentIds: ["s1", "s2"],
    });
    expect(payload).toMatchObject({
      organization_id: "org1",
      course_id: null,
      tutor_id: "tutor1",
      name: "Class 10 Maths batch",
      type: "BATCH",
      pricing_model: "PER_SESSION",
      capacity: preset.capacity,
      days_of_week: preset.daysOfWeek,
      start_hour: 16,
      start_minute: 30,
      duration_minutes: preset.durationMinutes,
      is_online: false,
      room_number: null,
      student_ids: ["s1", "s2"],
    });
  });

  it("falls back to the preset's placeholder name when the user leaves the name blank", () => {
    const payload = buildClassTemplatePayload({
      preset: TEMPLATE_GALLERY[1],
      name: "   ",
      startHour: 10,
      startMinute: 0,
      organizationId: "org1",
      tutorId: "tutor1",
      studentIds: [],
    });
    expect(payload.name).toBe(TEMPLATE_GALLERY[1].namePlaceholder);
  });
});

describe("validateManualStudentRow", () => {
  it("allows a fully empty row (it's just skipped, not required)", () => {
    expect(validateManualStudentRow({ name: "" })).toEqual([]);
  });

  it("allows a row with just a name", () => {
    expect(validateManualStudentRow({ name: "Aarav" })).toEqual([]);
  });

  it("requires a name when a phone number is entered", () => {
    expect(validateManualStudentRow({ name: "", phone: "9999999999" })).toHaveLength(1);
  });
});

describe("parseStudentsCsvRows", () => {
  it("maps a standard header to student records", () => {
    const rows = [
      ["Name", "Phone", "Parent", "Parent Phone"],
      ["Aarav Mehta", "9000000001", "Sunita Mehta", "9000000002"],
      ["Riya Kapoor", "9000000003", "", ""],
    ];
    const { students, errors } = parseStudentsCsvRows(rows);
    expect(errors).toEqual([]);
    expect(students).toEqual([
      { name: "Aarav Mehta", phone: "9000000001", parentName: "Sunita Mehta", parentPhone: "9000000002" },
      { name: "Riya Kapoor", phone: "9000000003", parentName: undefined, parentPhone: undefined },
    ]);
  });

  it("recognizes header aliases (Student Name, Guardian, etc.)", () => {
    const rows = [
      ["Student Name", "Guardian"],
      ["Zed", "Mrs. Sharma"],
    ];
    const { students, errors } = parseStudentsCsvRows(rows);
    expect(errors).toEqual([]);
    expect(students).toEqual([{ name: "Zed", phone: undefined, parentName: "Mrs. Sharma", parentPhone: undefined }]);
  });

  it("skips blank lines and reports rows missing a name", () => {
    const rows = [
      ["Name", "Phone"],
      ["", ""],
      ["", "9000000009"],
      ["Aarav", "9000000001"],
    ];
    const { students, errors } = parseStudentsCsvRows(rows);
    expect(students).toEqual([{ name: "Aarav", phone: "9000000001", parentName: undefined, parentPhone: undefined }]);
    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("Row 3");
  });

  it("errors out cleanly when there's no recognizable name column", () => {
    const rows = [["Foo", "Bar"], ["1", "2"]];
    const { students, errors } = parseStudentsCsvRows(rows);
    expect(students).toEqual([]);
    expect(errors[0]).toContain("name");
  });

  it("errors out on an empty file", () => {
    const { students, errors } = parseStudentsCsvRows([]);
    expect(students).toEqual([]);
    expect(errors).toHaveLength(1);
  });
});
