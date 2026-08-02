import { z } from "zod";

// Request contracts for server/routes/parents.ts (DEV_PLAN Tech Debt #8).

export const parentInviteRequestSchema = z.object({ studentId: z.string().uuid() });
export type ParentInviteRequest = z.infer<typeof parentInviteRequestSchema>;

// consent is DPDP capture — required, not optional (server/routes/parents.ts's own comment).
export const parentRedeemRequestSchema = z.object({
  token: z.string().min(10),
  consent: z.literal(true),
});
export type ParentRedeemRequest = z.infer<typeof parentRedeemRequestSchema>;
