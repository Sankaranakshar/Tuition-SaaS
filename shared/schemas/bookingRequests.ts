import { z } from "zod";

// Request/response contracts for server/routes/sessionRequests.ts (booking
// requests, EXECUTION_PLAN.md Step 5). Named "booking request" throughout
// this file, not "session request", to avoid colliding with
// scheduling.ts's unrelated createSessionRequestSchema (that one is just
// this codebase's "XRequest = HTTP body for endpoint X" convention applied
// to class_sessions — nothing to do with the session_requests table).
//
// A request targets exactly one of two shapes, mirroring the DB's
// session_requests_target_xor constraint: join an existing recurring class
// (templateId) or book a one-on-one with a tutor at a specific time
// (tutorId + requestedStartTime/EndTime).
const joinTemplateShape = z.object({
  studentId: z.string().uuid(),
  templateId: z.string().uuid(),
  notes: z.string().max(2000).optional(),
});
const bookTutorShape = z.object({
  studentId: z.string().uuid(),
  tutorId: z.string().uuid(),
  requestedStartTime: z.string().min(1),
  requestedEndTime: z.string().min(1),
  notes: z.string().max(2000).optional(),
});
export const createBookingRequestSchema = z.union([joinTemplateShape, bookTutorShape]);
export type CreateBookingRequest = z.infer<typeof createBookingRequestSchema>;

export const declineBookingRequestSchema = z.object({ responseNote: z.string().max(2000).optional() });
export type DeclineBookingRequest = z.infer<typeof declineBookingRequestSchema>;

export const proposeAlternativeSchema = z.union([
  z.object({ proposedTemplateId: z.string().uuid(), responseNote: z.string().max(2000).optional() }),
  z.object({ proposedStartTime: z.string().min(1), proposedEndTime: z.string().min(1), responseNote: z.string().max(2000).optional() }),
]);
export type ProposeAlternative = z.infer<typeof proposeAlternativeSchema>;

export const respondToProposalSchema = z.object({ accept: z.boolean() });
export type RespondToProposal = z.infer<typeof respondToProposalSchema>;
