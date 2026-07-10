import { z } from "zod";

// Request/response contracts for server/routes/scheduling.ts (DEV_PLAN §2a
// Step 0.2). Any new class_sessions write path must still go through
// resolveUserIds() server-side — these schemas only cover the wire shape.

export const enrollRequestSchema = z.object({
  studentId: z.string().uuid(),
  templateId: z.string().uuid(),
});
export type EnrollRequest = z.infer<typeof enrollRequestSchema>;
export const enrollResponseSchema = z.object({ ok: z.literal(true), enrollmentId: z.string().uuid() });
export type EnrollResponse = z.infer<typeof enrollResponseSchema>;

export const createSessionRequestSchema = z.object({
  templateId: z.string().uuid(),
  tutorId: z.string().uuid(),
  studentIds: z.array(z.string().uuid()).optional(),
  startTime: z.string().min(1),
  endTime: z.string().min(1),
  isOnline: z.boolean().optional(),
  roomNumber: z.string().optional(),
});
export type CreateSessionRequest = z.infer<typeof createSessionRequestSchema>;
export const createSessionResponseSchema = z.object({ ok: z.literal(true), sessionId: z.string().uuid() });
export type CreateSessionResponse = z.infer<typeof createSessionResponseSchema>;

export const materializeResponseSchema = z.object({
  ok: z.literal(true),
  created: z.array(z.string()),
  conflicts: z.array(z.object({ templateId: z.string().uuid(), date: z.string() })),
});
export type MaterializeResponse = z.infer<typeof materializeResponseSchema>;
