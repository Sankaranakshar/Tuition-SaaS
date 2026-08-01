import express from "express";
import { pool } from "../db.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { authenticateToken, requirePlatformAdmin, type AuthRequest } from "../middleware/auth.ts";
import { writePlatformAudit } from "../utils/platformAudit.ts";
import { writeAudit } from "../utils/audit.ts";
import {
  setFeatureFlagRequestSchema,
  impersonateRequestSchema,
  type ListOrgsResponse,
  type ImpersonateResponse,
} from "../../shared/schemas/admin.ts";

// Stage 3 super-admin console (DEV_PLAN §5, old E16.2). Every route here is
// platform-level, not org-scoped — requirePlatformAdmin checks the
// `platform_admins` allowlist, completely independent of any org's own RBAC
// (see that middleware's comment and 20260719120000_super_admin.sql).
const router = express.Router();
router.use(authenticateToken, requirePlatformAdmin);

router.get("/orgs", async (_req: AuthRequest, res, next) => {
  try {
    // Pre-aggregated joins rather than three correlated subqueries per row.
    // The old shape re-scanned students, organization_members and (worst)
    // audit_events once for every organization — 3N index lookups over the
    // platform's largest table, growing with org count on a console page
    // that has no pagination.
    const { rows } = await pool.query(`
      select
        o.id,
        o.name,
        o.created_at,
        coalesce(s.plan, 'free') as plan,
        coalesce(s.status, 'active') as subscription_status,
        s.student_limit,
        coalesce(st.n, 0) as active_student_count,
        coalesce(om.n, 0) as member_count,
        ae.last_activity_at
      from organizations o
      left join subscriptions s on s.organization_id = o.id
      left join (
        select organization_id, count(*)::int as n from students
        where is_deleted = false and status = 'active' group by organization_id
      ) st on st.organization_id = o.id
      left join (
        select organization_id, count(*)::int as n from organization_members group by organization_id
      ) om on om.organization_id = o.id
      left join (
        select organization_id, max(created_at) as last_activity_at from audit_events group by organization_id
      ) ae on ae.organization_id = o.id
      order by o.created_at desc
    `);

    const body: ListOrgsResponse = {
      orgs: rows.map((r) => ({
        id: r.id,
        name: r.name,
        createdAt: new Date(r.created_at).toISOString(),
        plan: r.plan,
        subscriptionStatus: r.subscription_status,
        studentLimit: r.student_limit,
        activeStudentCount: r.active_student_count,
        memberCount: r.member_count,
        lastActivityAt: r.last_activity_at ? new Date(r.last_activity_at).toISOString() : null,
      })),
    };
    res.json(body);
  } catch (err) { next(err); }
});

router.get("/orgs/:orgId/members", async (req: AuthRequest, res, next) => {
  try {
    const { orgId } = req.params;
    const { data: members, error } = await supabaseAdmin
      .from("organization_members")
      .select("user_id, role")
      .eq("organization_id", orgId);
    if (error) throw error;

    // organization_members and profiles both reference auth.users
    // independently (no direct FK between the two), so PostgREST can't
    // embed profiles(...) in the query above — fetch them separately.
    const userIds = (members || []).map((m) => m.user_id);
    const { data: profiles, error: profileErr } = userIds.length
      ? await supabaseAdmin.from("profiles").select("id, name, email").in("id", userIds)
      : { data: [], error: null };
    if (profileErr) throw profileErr;
    const profileById = new Map((profiles || []).map((p) => [p.id, p]));

    res.json({
      members: (members || []).map((m) => ({
        user_id: m.user_id,
        role: m.role,
        profiles: profileById.get(m.user_id) ?? null,
      })),
    });
  } catch (err) { next(err); }
});

// Toggle a feature flag for one org. `feature_flags` already existed but
// nothing ever wrote to it — this is its first real write path.
router.put("/orgs/:orgId/feature-flags", async (req: AuthRequest, res, next) => {
  try {
    const { orgId } = req.params;
    const { key, enabled } = setFeatureFlagRequestSchema.parse(req.body);

    const { error } = await supabaseAdmin
      .from("feature_flags")
      .upsert({ organization_id: orgId, key, enabled }, { onConflict: "organization_id,key" });
    if (error) throw error;

    await writePlatformAudit(req.user!.id, "feature_flag.set", { targetOrganizationId: orgId, payload: { key, enabled } });
    await writeAudit(orgId, req.user!.id, "platform_admin.feature_flag_set", "feature_flags", `${orgId}_${key}`, { key, enabled });
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Audited "become this user" — generates a real Supabase magic link via the
// GoTrue admin API rather than hand-rolling session creation. Visiting the
// link logs the platform admin's browser in as the target user, so this is
// genuine impersonation, not a read-only view — logged twice: once to
// platform_admin_actions (the platform's own record) and once to the
// target org's own audit_events (transparency — org staff can see it too).
router.post("/impersonate", async (req: AuthRequest, res, next) => {
  try {
    const { userId } = impersonateRequestSchema.parse(req.body);

    const { data: profile, error: profileErr } = await supabaseAdmin
      .from("profiles")
      .select("email, organization_id")
      .eq("id", userId)
      .maybeSingle();
    if (profileErr) throw profileErr;
    if (!profile?.email) {
      return res.status(404).json({ error: { code: "not_found", message: "User has no profile/email on record" } });
    }

    const { data: linkData, error: linkErr } = await supabaseAdmin.auth.admin.generateLink({
      type: "magiclink",
      email: profile.email,
    });
    if (linkErr) throw linkErr;

    await writePlatformAudit(req.user!.id, "impersonate", {
      targetUserId: userId,
      targetOrganizationId: profile.organization_id ?? undefined,
      payload: { email: profile.email },
    });
    if (profile.organization_id) {
      await writeAudit(profile.organization_id, req.user!.id, "platform_admin.impersonate", "profiles", userId, {
        note: "A ClassStackr platform admin generated a login link for this account for support purposes.",
      });
    }

    const body: ImpersonateResponse = { actionLink: linkData.properties.action_link };
    res.json(body);
  } catch (err) { next(err); }
});

export default router;
