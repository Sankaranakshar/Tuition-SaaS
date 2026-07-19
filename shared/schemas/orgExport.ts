import { z } from "zod";

// Contracts for server/routes/orgExport.ts (Stage 3 org export/offboarding,
// DEV_PLAN §5, old E16.3). Export routes (GET) stream a file download and
// have no JSON response schema — see src/lib/api.ts's blob-download
// functions, matching downloadInvoicePdf's pattern.

export const offboardRequestSchema = z.object({
  // The caller must type the org's exact current name to confirm — same
  // "type to confirm" pattern as other irreversible-ish SaaS actions.
  confirmOrgName: z.string().min(1),
});
export type OffboardRequest = z.infer<typeof offboardRequestSchema>;

export const offboardResponseSchema = z.object({ ok: z.literal(true) });
export type OffboardResponse = z.infer<typeof offboardResponseSchema>;
