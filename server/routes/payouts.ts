import express from "express";
import { pool, withTransaction } from "../db.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { authenticateToken, requireOrg, requireRole, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";
import { getPayoutSettings } from "../utils/payouts.ts";
import { computeTdsPaise } from "../../shared/payouts.ts";
import { renderPayoutStatementPdf } from "../utils/payoutStatementPdf.ts";
import {
  setCompensationRateRequestSchema,
  runPayoutRequestSchema,
} from "../../shared/schemas/payouts.ts";

// B-08 (MASTER_PLAN.md §3 R2 / EXECUTION_PLAN.md Step 21): tutor payouts and
// earnings ledger. Earnings themselves accrue inside server/routes/billing.ts's
// POST /attendance transaction, not here — this router covers the rate a
// centre pays a tutor, reading a tutor's own/staff-visible earnings, and
// running/settling a payout.
const router = express.Router();
router.use(authenticateToken, requireOrg);

// Payroll, not day-to-day operations — narrower than billing.ts's CAN_MONEY
// (which includes frontdesk).
const CAN_PAYOUT = ["owner", "admin", "accountant"] as const;

// Rate-setting is narrower still: owner/admin only, matching tutor_profiles'
// is_org_admin-only precedent for anything one tutor could otherwise
// self-serve or have a peer (accountant/frontdesk) set on their behalf.
router.put("/tutors/:tutorId/rate", requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const uid = req.user!.id;
    const { tutorId } = req.params;
    const body = setCompensationRateRequestSchema.parse(req.body);

    const { data: member } = await supabaseAdmin
      .from("organization_members").select("role")
      .eq("organization_id", orgId).eq("user_id", tutorId).maybeSingle();
    if (!member || member.role !== "tutor") {
      return res.status(404).json({ error: { code: "not_found", message: "Not a tutor in this organization" } });
    }

    const { error } = await supabaseAdmin.from("tutor_compensation_rates").upsert(
      {
        tutor_id: tutorId,
        organization_id: orgId,
        hourly_rate_paise: body.hourlyRatePaise,
        updated_by: uid,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "tutor_id,organization_id" }
    );
    if (error) throw error;

    await writeAudit(orgId, uid, "tutor.compensation_rate.update", "tutor_compensation_rates", tutorId, {
      hourlyRatePaise: body.hourlyRatePaise,
    });
    res.json({ ok: true, tutorId, hourlyRatePaise: body.hourlyRatePaise });
  } catch (err) { next(err); }
});

// Every configured rate in the org, for TeamSettings.tsx's member list.
router.get("/rates", requireRole(...CAN_PAYOUT), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const { data, error } = await supabaseAdmin
      .from("tutor_compensation_rates")
      .select("tutor_id, hourly_rate_paise")
      .eq("organization_id", orgId);
    if (error) throw error;
    res.json({ ok: true, rates: (data || []).map((r) => ({ tutorId: r.tutor_id, hourlyRatePaise: r.hourly_rate_paise })) });
  } catch (err) { next(err); }
});

// The caller's own earnings — any tutor, for their own Settings tab.
router.get("/me/earnings", async (req: AuthRequest, res, next) => {
  try {
    if (req.user!.role !== "tutor") {
      return res.status(403).json({ error: { code: "forbidden", message: "Only tutors have an earnings ledger" } });
    }
    const orgId = req.user!.organizationId!;
    const uid = req.user!.id;
    const [ledgerRes, payoutsRes] = await Promise.all([
      pool.query(
        `select id, session_id, session_start, duration_minutes, rate_paise_per_hour, amount_paise, payout_id
         from tutor_earnings_ledger where organization_id = $1 and tutor_id = $2
         order by session_start desc limit 200`,
        [orgId, uid]
      ),
      pool.query(
        `select id, period_start, period_end, gross_paise, tds_percent, tds_paise, net_paise, status, paid_at, created_at
         from tutor_payouts where organization_id = $1 and tutor_id = $2 order by created_at desc`,
        [orgId, uid]
      ),
    ]);
    res.json({
      ok: true,
      earnings: ledgerRes.rows.map((r) => ({
        id: r.id, sessionId: r.session_id, sessionStart: r.session_start,
        durationMinutes: r.duration_minutes, ratePaisePerHour: r.rate_paise_per_hour,
        amountPaise: r.amount_paise, payoutId: r.payout_id,
      })),
      payouts: payoutsRes.rows.map((p) => ({
        id: p.id, periodStart: p.period_start, periodEnd: p.period_end,
        grossPaise: p.gross_paise, tdsPercent: Number(p.tds_percent), tdsPaise: p.tds_paise,
        netPaise: p.net_paise, status: p.status, paidAt: p.paid_at, createdAt: p.created_at,
      })),
    });
  } catch (err) { next(err); }
});

// The staff-side view used to size a payout run before running it.
router.get("/earnings", requireRole(...CAN_PAYOUT), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const tutorId = req.query.tutorId as string;
    if (!tutorId) {
      return res.status(422).json({ error: { code: "validation", message: "tutorId is required" } });
    }
    const from = (req.query.from as string) || "1970-01-01";
    const to = (req.query.to as string) || "9999-12-31";
    const { rows } = await pool.query(
      `select id, session_id, session_start, duration_minutes, rate_paise_per_hour, amount_paise, payout_id
       from tutor_earnings_ledger
       where organization_id = $1 and tutor_id = $2 and session_start >= $3 and session_start < $4
       order by session_start desc`,
      [orgId, tutorId, from, to]
    );
    res.json({
      ok: true,
      earnings: rows.map((r) => ({
        id: r.id, sessionId: r.session_id, sessionStart: r.session_start,
        durationMinutes: r.duration_minutes, ratePaisePerHour: r.rate_paise_per_hour,
        amountPaise: r.amount_paise, payoutId: r.payout_id,
      })),
    });
  } catch (err) { next(err); }
});

// Aggregates a tutor's unpaid earnings for a period into one payout run,
// TDS-deducted per the org's settings.payouts.tdsPercent (0% if unconfigured).
router.post("/payout-runs", requireRole(...CAN_PAYOUT), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const uid = req.user!.id;
    const body = runPayoutRequestSchema.parse(req.body);

    const settings = await getPayoutSettings(orgId);

    const payout = await withTransaction(async (client) => {
      const unpaidRes = await client.query(
        `select id, amount_paise from tutor_earnings_ledger
         where organization_id = $1 and tutor_id = $2 and payout_id is null
           and session_start >= $3 and session_start < $4
         for update`,
        [orgId, body.tutorId, body.periodStart, body.periodEnd]
      );
      if (unpaidRes.rowCount === 0) {
        throw Object.assign(new Error("No unpaid earnings in this period"), { status: 422, code: "nothing_to_pay" });
      }
      const grossPaise = unpaidRes.rows.reduce((sum, r) => sum + r.amount_paise, 0);
      const tdsPaise = computeTdsPaise(grossPaise, settings.tdsPercent);
      const netPaise = grossPaise - tdsPaise;

      const payoutRes = await client.query(
        `insert into tutor_payouts
           (organization_id, tutor_id, period_start, period_end, gross_paise, tds_percent, tds_paise, net_paise, status, run_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, 'issued', $9)
         returning id, period_start, period_end, gross_paise, tds_percent, tds_paise, net_paise, status, paid_at, created_at`,
        [orgId, body.tutorId, body.periodStart, body.periodEnd, grossPaise, settings.tdsPercent, tdsPaise, netPaise, uid]
      );
      const payoutId = payoutRes.rows[0].id;
      await client.query(
        `update tutor_earnings_ledger set payout_id = $1 where id = any($2::uuid[])`,
        [payoutId, unpaidRes.rows.map((r) => r.id)]
      );
      return payoutRes.rows[0];
    });

    await writeAudit(orgId, uid, "payout.run", "tutor_payouts", payout.id, {
      tutorId: body.tutorId, periodStart: body.periodStart, periodEnd: body.periodEnd, grossPaise: payout.gross_paise,
    });

    res.status(201).json({
      ok: true,
      payout: {
        id: payout.id, tutorId: body.tutorId, periodStart: payout.period_start, periodEnd: payout.period_end,
        grossPaise: payout.gross_paise, tdsPercent: Number(payout.tds_percent), tdsPaise: payout.tds_paise,
        netPaise: payout.net_paise, status: payout.status, paidAt: payout.paid_at, createdAt: payout.created_at,
      },
    });
  } catch (err) { next(err); }
});

router.get("/payout-runs", async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const role = req.user!.role;
    const isPayoutStaff = (CAN_PAYOUT as readonly string[]).includes(role || "");
    const queryTutorId = req.query.tutorId as string | undefined;

    let tutorId: string;
    if (isPayoutStaff && queryTutorId) {
      tutorId = queryTutorId;
    } else if (role === "tutor") {
      tutorId = req.user!.id;
    } else {
      return res.status(403).json({ error: { code: "forbidden", message: "No access to payout runs" } });
    }

    const { rows } = await pool.query(
      `select id, tutor_id, period_start, period_end, gross_paise, tds_percent, tds_paise, net_paise, status, paid_at, created_at
       from tutor_payouts where organization_id = $1 and tutor_id = $2 order by created_at desc`,
      [orgId, tutorId]
    );
    res.json({
      ok: true,
      payouts: rows.map((p) => ({
        id: p.id, tutorId: p.tutor_id, periodStart: p.period_start, periodEnd: p.period_end,
        grossPaise: p.gross_paise, tdsPercent: Number(p.tds_percent), tdsPaise: p.tds_paise,
        netPaise: p.net_paise, status: p.status, paidAt: p.paid_at, createdAt: p.created_at,
      })),
    });
  } catch (err) { next(err); }
});

// Records that the bank transfer happened outside the product — no
// Razorpay payout API integration (HANDOFF §7's founder deferral of all
// external integrations), same posture as B-05's manual-payment recording.
router.post("/payout-runs/:id/mark-paid", requireRole(...CAN_PAYOUT), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const { data: payout, error } = await supabaseAdmin
      .from("tutor_payouts").select("id, organization_id, status").eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!payout || payout.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Payout not found" } });
    }
    if (payout.status === "paid") {
      return res.status(422).json({ error: { code: "already_paid", message: "Payout is already marked paid" } });
    }
    const { error: updateErr } = await supabaseAdmin
      .from("tutor_payouts").update({ status: "paid", paid_at: new Date().toISOString() }).eq("id", payout.id);
    if (updateErr) throw updateErr;

    await writeAudit(orgId, req.user!.id, "payout.mark_paid", "tutor_payouts", payout.id, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

router.get("/payout-runs/:id/statement", async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const role = req.user!.role;

    const { data: payout, error } = await supabaseAdmin
      .from("tutor_payouts").select("*").eq("id", req.params.id).maybeSingle();
    if (error) throw error;
    if (!payout || payout.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Payout not found" } });
    }
    const isPayoutStaff = (CAN_PAYOUT as readonly string[]).includes(role || "");
    if (!isPayoutStaff && payout.tutor_id !== req.user!.id) {
      return res.status(403).json({ error: { code: "forbidden", message: "No access to this statement" } });
    }

    const [{ data: org }, { data: tutor }, { rows: lines }] = await Promise.all([
      supabaseAdmin.from("organizations").select("name, address, phone, email").eq("id", orgId).maybeSingle(),
      supabaseAdmin.from("profiles").select("name, email").eq("id", payout.tutor_id).maybeSingle(),
      pool.query(
        `select session_start, duration_minutes, rate_paise_per_hour, amount_paise
         from tutor_earnings_ledger where payout_id = $1 order by session_start asc`,
        [payout.id]
      ),
    ]);

    const pdf = renderPayoutStatementPdf({
      payout: {
        periodStart: payout.period_start, periodEnd: payout.period_end, status: payout.status,
        grossPaise: payout.gross_paise, tdsPercent: Number(payout.tds_percent), tdsPaise: payout.tds_paise,
        netPaise: payout.net_paise, paidAt: payout.paid_at, createdAt: payout.created_at,
      },
      org: { name: org?.name || "Tuition Center", address: org?.address || null, phone: org?.phone || null, email: org?.email || null },
      tutor: { name: tutor?.name || null, email: tutor?.email || null },
      lines: lines.map((l) => ({
        sessionStart: l.session_start, durationMinutes: l.duration_minutes,
        ratePaisePerHour: l.rate_paise_per_hour, amountPaise: l.amount_paise,
      })),
    });

    const isoDate = (d: unknown) => new Date(d as string | number | Date).toISOString().slice(0, 10);
    const filename = `payout-${isoDate(payout.period_start)}-${isoDate(payout.period_end)}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(pdf.byteLength));
    res.setHeader("Cache-Control", "private, no-store");
    res.end(pdf);
  } catch (err) { next(err); }
});

export default router;
