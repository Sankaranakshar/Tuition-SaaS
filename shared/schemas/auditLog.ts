import { z } from "zod";

// Contracts for server/routes/auditLog.ts (Tech Debt #31, old Epic 16.4 —
// the audit log viewer). Unlike admin.ts's routes, this endpoint is NOT
// platform-admin-only: a platform admin sees every org's events, an
// org owner/admin/accountant sees only their own org's (matching
// audit_events_select's RLS policy, 20260709021100_rls_role_matrix_fixes.sql).
// orgId is accepted only for the platform-admin path — an org-scoped caller
// is always pinned to their own req.user.organizationId server-side.

export const auditLogQuerySchema = z.object({
  orgId: z.string().uuid().optional(),
  actorId: z.string().uuid().optional(),
  entityType: z.string().min(1).max(60).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
export type AuditLogQuery = z.infer<typeof auditLogQuerySchema>;

export const auditEventSchema = z.object({
  id: z.string().uuid(),
  organizationId: z.string().uuid(),
  organizationName: z.string().nullable(),
  actorId: z.string().uuid().nullable(),
  actorName: z.string().nullable(),
  actorEmail: z.string().nullable(),
  action: z.string(),
  entityType: z.string().nullable(),
  entityId: z.string().nullable(),
  payload: z.record(z.string(), z.unknown()),
  createdAt: z.string(),
});
export type AuditEvent = z.infer<typeof auditEventSchema>;

export const listAuditEventsResponseSchema = z.object({
  events: z.array(auditEventSchema),
  total: z.number().int(),
});
export type ListAuditEventsResponse = z.infer<typeof listAuditEventsResponseSchema>;
