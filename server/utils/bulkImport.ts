// B-09 bulk import (EXECUTION_PLAN.md Step 6). Pure parsing/dedup logic,
// no DB, no Express — the route (server/routes/students.ts) does the file
// format sniffing and the DB reads/writes, this file only shapes rows.
//
// Dedup rule (there is no real spec for this anywhere in REDESIGN.md,
// despite EXECUTION_PLAN.md's Step 6 citing a §5.4 that does not exist —
// confirmed by reading the file. This is a founder decision made directly
// during Step 6's implementation): a row is a duplicate only when BOTH its
// normalized name AND normalized phone match an existing student or an
// earlier row in the same file. A phone match alone is not enough — two
// siblings can legitimately share one parent's phone number. Every flagged
// duplicate requires an explicit per-row resolution ("skip" or "import")
// from staff before it is committed; none are auto-imported and none are
// auto-skipped.

export const IMPORT_FIELDS = ["name", "phone", "parentName", "parentPhone", "grade", "subject"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export type ImportRecord = Partial<Record<ImportField, string>>;

const HEADER_ALIASES: Record<string, ImportField> = {
  name: "name",
  studentname: "name",
  student: "name",
  fullname: "name",
  phone: "phone",
  studentphone: "phone",
  mobile: "phone",
  studentmobile: "phone",
  contactnumber: "phone",
  parent: "parentName",
  parentname: "parentName",
  guardian: "parentName",
  guardianname: "parentName",
  parentphone: "parentPhone",
  guardianphone: "parentPhone",
  parentmobile: "parentPhone",
  guardianmobile: "parentPhone",
  grade: "grade",
  class: "grade",
  standard: "grade",
  level: "grade",
  subject: "subject",
  subjects: "subject",
}

function normalizeHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[^a-z]/g, "");
}

/** Best-effort mapping suggestion for the column-mapping UI, index-aligned with `headers`. Staff confirm or override every entry before anything is parsed for real. */
export function suggestColumnMapping(headers: string[]): (ImportField | null)[] {
  return headers.map((h) => HEADER_ALIASES[normalizeHeader(h)] ?? null);
}

export interface ParsedRow {
  rowIndex: number; // 1-based, matching the spreadsheet's own row numbers (row 1 is the header)
  record: ImportRecord;
}

export interface RowError {
  rowIndex: number;
  message: string;
}

export interface ParseImportRowsResult {
  rows: ParsedRow[];
  errors: RowError[];
}

/** Applies a confirmed column mapping to already-parsed spreadsheet data rows (header row excluded by the caller), matching parseStudentsCsvRows' (src/lib/onboarding.ts) row-numbering and blank-row-skip conventions so the two pipelines read the same way. */
export function parseImportRows(dataRows: string[][], mapping: (ImportField | null)[]): ParseImportRowsResult {
  const rows: ParsedRow[] = [];
  const errors: RowError[] = [];

  dataRows.forEach((row, i) => {
    const rowIndex = i + 2; // +1 for 0-index, +1 for the header row
    if (row.every((cell) => !cell?.trim())) return; // skip blank lines

    const record: ImportRecord = {};
    mapping.forEach((field, colIndex) => {
      if (!field) return;
      const value = row[colIndex]?.trim();
      if (value) record[field] = value;
    });

    if (!record.name) {
      errors.push({ rowIndex, message: "Missing a name." });
      return;
    }
    rows.push({ rowIndex, record });
  });

  return { rows, errors };
}

function normalizeName(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/** Digits only, trimmed to the last 10 (India's mobile number length) so a
 *  "+91"/"091" country/trunk prefix on one side doesn't defeat a real match.
 *  Returns null (not comparable) if nothing is left. */
function normalizePhone(phone: string | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  if (!digits) return null;
  return digits.slice(-10);
}

function dedupeKey(record: ImportRecord): string | null {
  const phone = normalizePhone(record.phone);
  if (!record.name || !phone) return null; // can't dedup without both — see file header
  return `${normalizeName(record.name)}|${phone}`;
}

export interface ExistingStudent {
  id: string;
  name: string;
  phone: string | null;
}

export interface DuplicateFlag {
  rowIndex: number;
  name: string;
  phone: string | null;
  matchedStudentId?: string;
  matchedStudentName?: string;
  matchedRowIndex?: number;
}

/** Flags rows whose name+phone match either an existing org student or an earlier row in the same file. Order matters: within-file duplicates are flagged against the first occurrence, not every occurrence. */
export function detectDuplicates(rows: ParsedRow[], existingStudents: ExistingStudent[]): DuplicateFlag[] {
  const existingByKey = new Map<string, ExistingStudent>();
  for (const s of existingStudents) {
    const key = dedupeKey({ name: s.name, phone: s.phone ?? undefined });
    if (key) existingByKey.set(key, s);
  }

  const duplicates: DuplicateFlag[] = [];
  const seenInFile = new Map<string, number>();

  for (const { rowIndex, record } of rows) {
    const key = dedupeKey(record);
    if (!key) continue;

    const existing = existingByKey.get(key);
    if (existing) {
      duplicates.push({ rowIndex, name: record.name!, phone: record.phone ?? null, matchedStudentId: existing.id, matchedStudentName: existing.name });
      continue;
    }
    const earlierRow = seenInFile.get(key);
    if (earlierRow !== undefined) {
      duplicates.push({ rowIndex, name: record.name!, phone: record.phone ?? null, matchedRowIndex: earlierRow });
      continue;
    }
    seenInFile.set(key, rowIndex);
  }

  return duplicates;
}
