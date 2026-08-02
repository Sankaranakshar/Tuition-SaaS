import { z } from "zod";

// Request contract for server/routes/documents.ts (DEV_PLAN Tech Debt #8).
// Validates the non-file multipart fields; the file itself is handled by
// multer ahead of this and is not part of the schema.

export const documentMetaRequestSchema = z.object({
  studentId: z.string().uuid(),
  category: z.string().min(1),
  notes: z.string().optional().default(""),
});
export type DocumentMetaRequest = z.infer<typeof documentMetaRequestSchema>;
