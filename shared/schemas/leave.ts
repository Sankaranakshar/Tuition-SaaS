import { z } from "zod";

// Request/response contracts for server/routes/leave.ts (B-13,
// EXECUTION_PLAN.md Step 23).

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD");

export const createLeaveRequestSchema = z.object({
  // Omitted -> defaults to the caller (a tutor requesting their own leave).
  // Staff (owner/admin) may pass it to log leave on a tutor's behalf.
  tutorId: z.string().uuid().optional(),
  startDate: dateString,
  endDate: dateString,
  reason: z.string().max(500).optional(),
});
export type CreateLeaveRequest = z.infer<typeof createLeaveRequestSchema>;

export const decideLeaveRequestSchema = z.object({
  action: z.enum(["approve", "reject", "cancel"]),
});
export type DecideLeaveRequest = z.infer<typeof decideLeaveRequestSchema>;

export const reassignSubstituteRequestSchema = z.object({
  substituteTutorId: z.string().uuid(),
  // Omitted -> every currently-scheduled session the leave affects.
  sessionIds: z.array(z.string().uuid()).optional(),
});
export type ReassignSubstituteRequest = z.infer<typeof reassignSubstituteRequestSchema>;

export interface LeaveRequestRow {
  id: string;
  tutorId: string;
  startDate: string;
  endDate: string;
  reason: string | null;
  status: "pending" | "approved" | "rejected" | "cancelled";
  requestedBy: string;
  decidedBy: string | null;
  decidedAt: string | null;
  createdAt: string;
}

export interface AffectedSessionRow {
  id: string;
  startTime: string;
  endTime: string;
  studentIds: string[];
}

export interface ReassignResult {
  sessionId: string;
  ok: boolean;
  error?: string;
}
