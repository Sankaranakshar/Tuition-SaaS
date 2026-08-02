import { z } from "zod";

// Request contracts for server/routes/members.ts (DEV_PLAN Tech Debt #8).
// The role list mirrors server/middleware/auth.ts's Role type and the
// organization_members.role check constraint (supabase/migrations) — a
// shared/ file can't import from server/, so keep these three in sync by
// hand if a role is ever added or removed.
const ORG_ROLES = ["owner", "admin", "tutor", "frontdesk", "accountant", "parent", "student"] as const;
export type OrgRole = (typeof ORG_ROLES)[number];

export const setMemberRoleRequestSchema = z.object({
  userId: z.string().uuid(),
  role: z.enum(ORG_ROLES),
});
export type SetMemberRoleRequest = z.infer<typeof setMemberRoleRequestSchema>;

export const bootstrapOrgRequestSchema = z.object({ organizationName: z.string().min(2).max(120) });
export type BootstrapOrgRequest = z.infer<typeof bootstrapOrgRequestSchema>;

// Staff invites (Tech Debt #1): 'owner' is deliberately excluded — there is
// exactly one, created via bootstrap — as are 'parent'/'student', which have
// their own dedicated invite systems (shared/schemas/parents.ts, students.ts).
const INVITABLE_STAFF_ROLES = ["admin", "tutor", "frontdesk", "accountant"] as const;
export type InvitableStaffRole = (typeof INVITABLE_STAFF_ROLES)[number];

export const createStaffInviteRequestSchema = z.object({ role: z.enum(INVITABLE_STAFF_ROLES) });
export type CreateStaffInviteRequest = z.infer<typeof createStaffInviteRequestSchema>;

export const staffRedeemRequestSchema = z.object({ token: z.string().min(10) });
export type StaffRedeemRequest = z.infer<typeof staffRedeemRequestSchema>;
