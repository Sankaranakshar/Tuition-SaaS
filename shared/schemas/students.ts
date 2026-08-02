import { z } from "zod";

// Request contracts for server/routes/students.ts (DEV_PLAN Tech Debt #8).

export const studentInviteRequestSchema = z.object({ studentId: z.string().uuid() });
export type StudentInviteRequest = z.infer<typeof studentInviteRequestSchema>;

export const studentRedeemRequestSchema = z.object({ token: z.string().min(10) });
export type StudentRedeemRequest = z.infer<typeof studentRedeemRequestSchema>;
