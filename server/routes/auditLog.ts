import express from "express";
import { pool } from "../db.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { authenticateToken, type AuthRequest } from "../middleware/auth.ts";
import { auditLogQuerySchema, type ListAuditEventsResponse } from "../../shared/schemas/auditLog.ts";

// Tech Debt #31 / old Epic 16.4: the audit log viewer. audit_events has been
// written to by every privileged mutation since Epic 3 (§8 invariant #2)
// but nothing has ever read it back. Unlike admin.ts's routes this is NOT
// platform-admin-gated end to end — it has two access tiers on the same
// endpoint, matching audit_events_select's own RLS policy
// (20260709021100_rls_role_matrix_fixes.sql):
//   - platform admin (platform_admins allowlist): every org, optional
//     ?orgId= filter, same as admin.ts's org-health view.
//   - org owner/admin/accountant: their own org only, orgId is ignored
//     (always pinned server-side to req.user.organizationId).
// Read-only — no write path is added, the data already exists.
const router = express.Router();
router.use(authenticateToken);

const ORG_SCOPED_ROLES = new Set(["owner", "admin", "accountant"]);

router.get("/", async (req: AuthRequest, res, next) => {
  try {
    const query = auditLogQuerySchema.parse(req.query);
    const userId = req.user!.id;

    const { data: platformAdminRow, error: platformAdminErr } = await supabaseAdmin
      .from("platform_admins")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (platformAdminErr) throw platformAdminErr;

    let orgId: string | null;
    if (platformAdminRow) {
      orgId = query.orgId ?? null;
    } else {
      if (!req.user!.organizationId || !ORG_SCOPED_ROLES.has(req.user!.role ?? "")) {
        return res.status(403).json({ error: { code: "forbidden", message: "Not authorized to view the audit log" } });
      }
      orgId = req.user!.organizationId;
    }

    const params = [
      orgId,
      query.actorId ?? null,
      query.entityType ?? null,
      query.from ?? null,
      query.to ?? null,
    ];
    const whereClause = `
      where ($1::uuid is null or ae.organization_id = $1)
        and ($2::uuid is null or ae.actor_id = $2)
        and ($3::text is null or ae.payload ->> 'entityType' = $3)
        and ($4::timestamptz is null or ae.created_at >= $4)
        and ($5::timestamptz is null or ae.created_at <= $5)
    `;

    const [{ rows }, { rows: countRows }] = await Promise.all([
      pool.query(
        `
        select
          ae.id,
          ae.organization_id,
          o.name as organization_name,
          ae.actor_id,
          p.name as actor_name,
          p.email as actor_email,
          ae.action,
          ae.payload ->> 'entityType' as entity_type,
          ae.payload ->> 'entityId' as entity_id,
          ae.payload,
          ae.created_at
        from audit_events ae
        join organizations o on o.id = ae.organization_id
        left join profiles p on p.id = ae.actor_id
        ${whereClause}
        order by ae.created_at desc
        limit $6 offset $7
        `,
        [...params, query.limit, query.offset]
      ),
      pool.query(`select count(*)::int as total from audit_events ae ${whereClause}`, params),
    ]);

    const body: ListAuditEventsResponse = {
      events: rows.map((r) => ({
        id: r.id,
        organizationId: r.organization_id,
        organizationName: r.organization_name,
        actorId: r.actor_id,
        actorName: r.actor_name,
        actorEmail: r.actor_email,
        action: r.action,
        entityType: r.entity_type,
        entityId: r.entity_id,
        payload: r.payload,
        createdAt: new Date(r.created_at).toISOString(),
      })),
      total: countRows[0]?.total ?? 0,
    };
    res.json(body);
  } catch (err) { next(err); }
});

export default router;
