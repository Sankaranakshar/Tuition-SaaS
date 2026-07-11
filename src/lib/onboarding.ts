// Pure derivations for the three-beat Onboarding rebuild (DEV_PLAN §2a Stage
// 2 item 5, REDESIGN §6.7). No React, no Supabase — every function takes
// plain data and returns plain data, matching the today.ts pattern. The page
// (src/pages/Onboarding.tsx) is the only place these get wired to Supabase
// writes and the CSV file input.

export type OrgMode = "solo" | "center";

/** The auto-generated org name for a solo tutor who never enters one — extracted from AuthContext.tsx's inline default so it's reusable and testable. */
export function defaultOrgName(name: string | null | undefined, email: string | null | undefined): string {
  return `${name || email || "My"}'s Tutoring`;
}

export type TemplateGalleryType = "BATCH";

export interface TemplateGalleryPreset {
  id: string;
  labelKey: string;
  namePlaceholder: string;
  type: TemplateGalleryType;
  daysOfWeek: number[]; // 0=Sun..6=Sat
  durationMinutes: number;
  capacity: number;
}

// REDESIGN §6.7's own example is "Class 10 Maths batch, Mon/Wed/Fri" — a
// recurring batch. Keeping every preset a BATCH (rather than mixing in
// ONE_ON_ONE) means the final-submit path only has one write sequence to get
// right (create → materialize → enroll), matching Calendar.tsx's proven order
// exactly instead of branching on class type during onboarding too.
export const TEMPLATE_GALLERY: TemplateGalleryPreset[] = [
  {
    id: "weekday-evening",
    labelKey: "onboarding.presetWeekdayEvening",
    namePlaceholder: "Class 10 Maths batch",
    type: "BATCH",
    daysOfWeek: [1, 3, 5], // Mon/Wed/Fri
    durationMinutes: 60,
    capacity: 10,
  },
  {
    id: "weekend",
    labelKey: "onboarding.presetWeekend",
    namePlaceholder: "Weekend batch",
    type: "BATCH",
    daysOfWeek: [6, 0], // Sat/Sun
    durationMinutes: 90,
    capacity: 10,
  },
  {
    id: "daily",
    labelKey: "onboarding.presetDaily",
    namePlaceholder: "Daily crash course",
    type: "BATCH",
    daysOfWeek: [1, 2, 3, 4, 5],
    durationMinutes: 45,
    capacity: 15,
  },
];

export interface ClassTemplatePayloadInput {
  preset: TemplateGalleryPreset;
  name: string;
  startHour: number;
  startMinute: number;
  organizationId: string;
  tutorId: string;
  studentIds: string[];
}

/** The exact class_templates insert-row shape — mirrors Calendar.tsx's handleCreateTemplateAndSessions, with student_ids populated at insert time (not a follow-up update) so a same-pass materialize resolves student_user_ids/parent_user_ids correctly (see server/routes/scheduling.ts's materializeTemplate). */
export function buildClassTemplatePayload(input: ClassTemplatePayloadInput) {
  return {
    organization_id: input.organizationId,
    course_id: null,
    tutor_id: input.tutorId,
    name: input.name.trim() || input.preset.namePlaceholder,
    type: input.preset.type,
    pricing_model: "PER_SESSION",
    fee_amount: 500,
    capacity: input.preset.capacity,
    days_of_week: input.preset.daysOfWeek,
    start_hour: input.startHour,
    start_minute: input.startMinute,
    duration_minutes: input.preset.durationMinutes,
    is_online: false,
    room_number: null,
    student_ids: input.studentIds,
  };
}

export interface ManualStudentRow {
  name: string;
  phone?: string;
}

/** Validates one of beat 3's two manual student-entry rows. Empty rows (both fields blank) are valid — they're just skipped, not required. */
export function validateManualStudentRow(row: ManualStudentRow): string[] {
  const errors: string[] = [];
  if (!row.name.trim() && row.phone?.trim()) {
    errors.push("A name is required when a phone number is entered.");
  }
  return errors;
}

export interface CsvStudentRow {
  name: string;
  phone?: string;
  parentName?: string;
  parentPhone?: string;
}

export interface ParseStudentsCsvResult {
  students: CsvStudentRow[];
  errors: string[];
}

const HEADER_ALIASES: Record<string, keyof CsvStudentRow> = {
  name: "name",
  studentname: "name",
  student: "name",
  phone: "phone",
  studentphone: "phone",
  parent: "parentName",
  parentname: "parentName",
  guardian: "parentName",
  parentphone: "parentPhone",
  guardianphone: "parentPhone",
};

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z]/g, "");
}

/**
 * Maps already-CSV-parsed raw rows (header row + data rows, e.g. from
 * papaparse) into student records, matching on a small set of header
 * aliases rather than requiring an exact column name. Kept pure/testable —
 * the actual CSV-text-to-string[][] parsing is the one non-pure line in the
 * page (a dynamic `import("papaparse")`).
 */
export function parseStudentsCsvRows(rows: string[][]): ParseStudentsCsvResult {
  if (rows.length === 0) return { students: [], errors: ["The CSV file is empty."] };

  const [headerRow, ...dataRows] = rows;
  const columnMap = headerRow.map((h) => HEADER_ALIASES[normalizeHeader(h)] ?? null);

  if (!columnMap.includes("name")) {
    return { students: [], errors: ['Could not find a "name" column in the CSV header.'] };
  }

  const students: CsvStudentRow[] = [];
  const errors: string[] = [];

  dataRows.forEach((row, i) => {
    if (row.every((cell) => !cell?.trim())) return; // skip blank lines
    const record: Partial<CsvStudentRow> = {};
    columnMap.forEach((field, colIndex) => {
      if (field) record[field] = row[colIndex]?.trim();
    });
    if (!record.name) {
      errors.push(`Row ${i + 2}: missing a name, skipped.`);
      return;
    }
    students.push({
      name: record.name,
      phone: record.phone || undefined,
      parentName: record.parentName || undefined,
      parentPhone: record.parentPhone || undefined,
    });
  });

  return { students, errors };
}
