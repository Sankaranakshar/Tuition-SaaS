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
