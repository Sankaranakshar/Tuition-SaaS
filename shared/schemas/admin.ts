import { z } from "zod";

// Contracts for server/routes/admin.ts (Stage 3 super-admin console,
// DEV_PLAN §5). Every route behind these schemas requires
// requirePlatformAdmin — see server/middleware/auth.ts.

export const orgHealthSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  createdAt: z.string(),
  plan: z.string(),
  subscriptionStatus: z.string(),
  studentLimit: z.number().int().nullable(),
  activeStudentCount: z.number().int(),
  memberCount: z.number().int(),
  lastActivityAt: z.string().nullable(),
});
export type OrgHealth = z.infer<typeof orgHealthSchema>;

export const listOrgsResponseSchema = z.object({ orgs: z.array(orgHealthSchema) });
export type ListOrgsResponse = z.infer<typeof listOrgsResponseSchema>;

export const setFeatureFlagRequestSchema = z.object({
  key: z.string().min(1).max(60),
  enabled: z.boolean(),
});
export type SetFeatureFlagRequest = z.infer<typeof setFeatureFlagRequestSchema>;

export const impersonateRequestSchema = z.object({
  userId: z.string().uuid(),
});
export type ImpersonateRequest = z.infer<typeof impersonateRequestSchema>;

export const impersonateResponseSchema = z.object({ actionLink: z.string() });
export type ImpersonateResponse = z.infer<typeof impersonateResponseSchema>;
