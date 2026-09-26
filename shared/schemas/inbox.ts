import { z } from "zod";

// Request/response contract for server/routes/inbox.ts (DEV_PLAN §2a Stage 2
// item 4, REDESIGN §6.5). Only the class-channel roster resolution needs a
// server route — it reuses scheduling.ts's resolveUserIds()-style lookup,
// which requires server-side student/parent-link access nothing else in
// Inbox needs. Every other Inbox write (send message, archive/snooze,
// mark-read, assign/grade homework) is a direct client insert/update under
// RLS, same posture as the page it replaces.

export const ensureClassChannelResponseSchema = z.object({
  ok: z.literal(true),
  conversationId: z.string().uuid(),
  participantCount: z.number().int().nonnegative(),
});
export type EnsureClassChannelResponse = z.infer<typeof ensureClassChannelResponseSchema>;

// D-06 follow-up (EXECUTION_PLAN.md Step 30): the tutors a parent may start
// a DM with, i.e. staff who actually teach one of their children. Resolved
// server-side because a parent can't read staff names under profiles /
// tutor_profiles RLS, and loosening that would expose every staff name in
// the org rather than just their own child's tutors.
export const tutorContactSchema = z.object({
  userId: z.string().min(1),
  name: z.string(),
  studentId: z.string().min(1),
  studentName: z.string(),
});
export const tutorContactsResponseSchema = z.object({
  ok: z.literal(true),
  tutors: z.array(tutorContactSchema),
});
export type TutorContactsResponse = z.infer<typeof tutorContactsResponseSchema>;
