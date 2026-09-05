import { z } from "zod";

// Request contracts for server/routes/students.ts (DEV_PLAN Tech Debt #8).

export const studentInviteRequestSchema = z.object({ studentId: z.string().uuid() });
export type StudentInviteRequest = z.infer<typeof studentInviteRequestSchema>;

export const studentRedeemRequestSchema = z.object({ token: z.string().min(10) });
export type StudentRedeemRequest = z.infer<typeof studentRedeemRequestSchema>;

// B-11 / EXECUTION_PLAN.md Step 10: per-student erasure (DPDP right to
// erasure). Type-to-confirm the student's exact current name, re-checked
// server-side — same "confirm to destroy" pattern as org offboarding
// (shared/schemas/orgExport.ts). Irreversible.
export const eraseStudentRequestSchema = z.object({
  confirmName: z.string().min(1),
});
export type EraseStudentRequest = z.infer<typeof eraseStudentRequestSchema>;

export interface EraseStudentResponse {
  ok: true;
  // Non-null only when the org's erasure policy is "writeoff" and the wallet
  // actually held a balance — the magnitude that was written off.
  walletWriteOff: { credits: number; paise: number } | null;
  deleted: {
    studentNotes: number;
    assessments: number;
    enrollments: number;
    parentLinks: number;
    sessionRequests: number;
    documents: number;
    invites: number;
  };
}

// B-09 bulk import (EXECUTION_PLAN.md Step 6). The pure row-shaping/dedup
// logic lives in server/utils/bulkImport.ts; these are just the request/
// response shapes for POST /api/v1/students/import{,/inspect}. Multer puts
// non-file multipart fields on req.body as strings, so `mapping` and
// `resolutions` arrive JSON-encoded and get JSON.parse'd before hitting
// these schemas — see the route.
export const IMPORT_FIELDS = ["name", "phone", "parentName", "parentPhone", "grade", "subject"] as const;
export type ImportField = (typeof IMPORT_FIELDS)[number];

export const bulkImportMappingSchema = z.array(z.enum(IMPORT_FIELDS).nullable());
export type BulkImportMapping = z.infer<typeof bulkImportMappingSchema>;

// Keyed by the row's rowIndex (as a string, since it travels through JSON).
export const bulkImportResolutionsSchema = z.record(z.string(), z.enum(["skip", "import"]));
export type BulkImportResolutions = z.infer<typeof bulkImportResolutionsSchema>;

export interface BulkImportInspectResponse {
  ok: true;
  headers: string[];
  sampleRows: string[][];
  totalRows: number;
  suggestedMapping: (ImportField | null)[];
}

export interface BulkImportRowError {
  rowIndex: number;
  message: string;
}

export interface BulkImportDuplicate {
  rowIndex: number;
  name: string;
  phone: string | null;
  matchedStudentId?: string;
  matchedStudentName?: string;
  matchedRowIndex?: number;
}

export interface BulkImportCandidate {
  rowIndex: number;
  name: string;
  phone?: string;
  parentName?: string;
  parentPhone?: string;
  grade?: string;
  subject?: string;
}

export interface BulkImportPreviewResponse {
  ok: true;
  dryRun: true;
  totalRows: number;
  toCreate: BulkImportCandidate[];
  duplicates: BulkImportDuplicate[];
  errors: BulkImportRowError[];
}

export interface BulkImportCommitResponse {
  ok: true;
  dryRun: false;
  createdCount: number;
  created: { rowIndex: number; studentId: string; name: string }[];
  skippedDuplicates: BulkImportDuplicate[];
  errors: BulkImportRowError[];
}
