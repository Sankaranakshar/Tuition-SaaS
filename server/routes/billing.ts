import express from "express";
import type { PoolClient } from "pg";
import { pool, withTransaction } from "../db.ts";
import { supabaseAdmin } from "../supabaseAdmin.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";
import { applyPayment, type InvoiceStatus } from "../utils/invoiceStatus.ts";
import { allocateInvoiceNumber } from "../utils/invoiceNumber.ts";
import { getGatewayCreds, createPaymentLink, fetchPaymentLink } from "../utils/razorpay.ts";
import { renderInvoicePdf, type InvoicePdfInvoice } from "../utils/invoicePdf.ts";
import {
  createInvoiceRequestSchema as createInvoiceSchema,
  topupRequestSchema as topupSchema,
  markAttendanceRequestSchema as attendanceSchema,
  cancelSessionRequestSchema as cancelSchema,
  recordManualPaymentRequestSchema as paymentSchema,
  refundRequestSchema as refundSchema,
} from "../../shared/schemas/billing.ts";

const router = express.Router();
router.use(authenticateToken, requireOrg);

const CAN_MARK = ["owner", "admin", "tutor", "frontdesk"] as const;
const CAN_MONEY = ["owner", "admin", "frontdesk"] as const;

// Free-form invoice with custom line items (e.g. a one-off charge outside
// the attendance-billing flow). Created directly as "unpaid" — draft/finalize
// is for the numbered-invoice workflow, this mirrors what the UI always did.
router.post("/invoices", requireRole(...CAN_MARK), async (req: AuthRequest, res, next) => {
  try {
    const body = createInvoiceSchema.parse(req.body);
    const orgId = req.user!.organizationId!;

    const subtotalPaise = body.items.reduce((sum, it) => sum + Math.round(it.amount * it.quantity * 100), 0);
    const taxPaise = Math.round((subtotalPaise * body.taxPercentage) / 100);
    const totalPaise = subtotalPaise + taxPaise;
    const items = body.items.map((it) => ({
      description: it.description, amountPaise: Math.round(it.amount * 100), quantity: it.quantity,
    }));

    const { data: inv, error } = await supabaseAdmin.from("invoices").insert({
      organization_id: orgId,
      tutor_id: req.user!.role === "tutor" ? req.user!.id : null,
      student_id: body.studentId,
      subtotal_paise: subtotalPaise,
      tax_paise: taxPaise,
      discount_paise: 0,
      total_paise: totalPaise,
      total_amount: totalPaise / 100,
      subtotal: subtotalPaise / 100,
      status: "unpaid",
      due_date: body.dueDate || null,
      items,
    }).select("id").single();
    if (error) throw error;

    await writeAudit(orgId, req.user!.id, "invoice.create", "invoices", inv.id, { studentId: body.studentId, totalPaise });
    res.status(201).json({ ok: true, invoiceId: inv.id });
  } catch (err) { next(err); }
});

// Wallet top-up: staff records a payment received in person/offline and
// credits it to the student's prepaid rupee balance (balance_currency).
// Deliberately staff-only, not self-service: instantly crediting your own
// wallet from the client would be a straightforward fraud vector — this is
// the same trust boundary as recordManualPayment, just crediting a wallet
// instead of settling an invoice. Note this also fixes a modeling bug in the
// old code, which added a raw amount into balanceCredits (meant for discrete
// session-credit packs, not currency) — a top-up is money, so it credits
// balance_currency here.
router.post("/wallets/topup", requireRole(...CAN_MONEY), async (req: AuthRequest, res, next) => {
  try {
    const body = topupSchema.parse(req.body);
    const orgId = req.user!.organizationId!;

    const outcome = await withTransaction(async (client) => {
      const existing = await client.query(
        `select 1 from wallet_ledger where organization_id = $1 and idempotency_key = $2`,
        [orgId, body.idempotencyKey]
      );
      if ((existing.rowCount ?? 0) > 0) return { duplicate: true };

      const walletRes = await client.query(
        `insert into wallets (organization_id, student_id) values ($1, $2)
         on conflict (organization_id, student_id) do update set student_id = excluded.student_id
         returning id`,
        [orgId, body.studentId]
      );
      await client.query(
        `update wallets set balance_currency = balance_currency + $1 where id = $2`,
        [body.amountPaise / 100, walletRes.rows[0].id]
      );
      await client.query(
        `insert into wallet_ledger (organization_id, student_id, type, credits, paise, reason, by, idempotency_key, at)
         values ($1, $2, 'credit_currency', 0, $3, 'topup', $4, $5, now())`,
        [orgId, body.studentId, body.amountPaise, req.user!.id, body.idempotencyKey]
      );
      return { duplicate: false };
    });

    if (!outcome.duplicate) {
      await writeAudit(orgId, req.user!.id, "wallet.topup", "wallets", body.studentId, { amountPaise: body.amountPaise, method: body.method });
    }
    res.status(outcome.duplicate ? 200 : 201).json({ ok: true, duplicate: outcome.duplicate });
  } catch (err) { next(err); }
});

// Marks attendance for a session and settles per-session billing atomically.
// Idempotent: attendance rows are keyed by unique (session_id, student_id),
// and billing only fires on the first transition into a billable status.
router.post("/attendance", requireRole(...CAN_MARK), async (req: AuthRequest, res, next) => {
  try {
    const { sessionId, records } = attendanceSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const actor = req.user!.id;

    const sessionRes = await pool.query(
      `select organization_id, tutor_id, template_id, start_time from class_sessions where id = $1`,
      [sessionId]
    );
    if (sessionRes.rowCount === 0) {
      return res.status(404).json({ error: { code: "not_found", message: "Session not found" } });
    }
    const session = sessionRes.rows[0];
    if (session.organization_id !== orgId) {
      return res.status(403).json({ error: { code: "forbidden", message: "Session belongs to another organization" } });
    }
    if (req.user!.role === "tutor" && session.tutor_id !== actor) {
      return res.status(403).json({ error: { code: "forbidden", message: "Tutors can only mark their own sessions" } });
    }
    const start = new Date(session.start_time);
    if (start.getTime() > Date.now()) {
      return res.status(422).json({ error: { code: "session_in_future", message: "Cannot mark attendance before the session starts" } });
    }
    if (Date.now() - start.getTime() > 7 * 24 * 3600 * 1000) {
      return res.status(422).json({ error: { code: "too_old", message: "Attendance can only be marked within 7 days of the session" } });
    }

    const templateRes = await pool.query(
      `select pricing_model, fee_amount, type from class_templates where id = $1`,
      [session.template_id]
    );
    const template = templateRes.rows[0] || null;
    const perSession = template?.pricing_model === "PER_SESSION";
    const BILLABLE = new Set(["present", "late"]);

    const result = await withTransaction(async (client: PoolClient) => {
      const billed: string[] = [];
      const invoiced: string[] = [];

      for (const r of records) {
        const prevRes = await client.query(
          `select billed from attendance_records where session_id = $1 and student_id = $2`,
          [sessionId, r.studentId]
        );
        const alreadyBilled = prevRes.rows[0]?.billed === true;
        const nowBillable = perSession && BILLABLE.has(r.status);
        const shouldBill = nowBillable && !alreadyBilled;

        await client.query(
          `insert into attendance_records
             (organization_id, session_id, student_id, template_id, tutor_id, session_start, status, billed, marked_by, marked_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())
           on conflict (session_id, student_id) do update set
             status = excluded.status, billed = excluded.billed, marked_by = excluded.marked_by, marked_at = now()`,
          [orgId, sessionId, r.studentId, session.template_id, session.tutor_id, session.start_time, r.status, alreadyBilled || shouldBill, actor]
        );

        if (shouldBill) {
          const feePaise = Math.round((template!.fee_amount || 0) * 100);
          // Row lock on the wallet serializes concurrent attendance-billing
          // for the same student within this transaction.
          const walletRes = await client.query(
            `select id, balance_credits, balance_currency from wallets where organization_id = $1 and student_id = $2 for update`,
            [orgId, r.studentId]
          );
          const w = walletRes.rows[0] || null;

          if (w && (w.balance_credits || 0) >= 1) {
            await client.query(`update wallets set balance_credits = balance_credits - 1 where id = $1`, [w.id]);
            await client.query(
              `insert into wallet_ledger (organization_id, student_id, type, credits, paise, reason, session_id, by, at)
               values ($1, $2, 'debit_credit', -1, 0, 'attendance', $3, $4, now())`,
              [orgId, r.studentId, sessionId, actor]
            );
            billed.push(r.studentId);
          } else if (w && Math.round((w.balance_currency || 0) * 100) >= feePaise) {
            await client.query(
              `update wallets set balance_currency = balance_currency - $1 where id = $2`,
              [feePaise / 100, w.id]
            );
            await client.query(
              `insert into wallet_ledger (organization_id, student_id, type, credits, paise, reason, session_id, by, at)
               values ($1, $2, 'debit_currency', 0, $3, 'attendance', $4, $5, now())`,
              [orgId, r.studentId, -feePaise, sessionId, actor]
            );
            billed.push(r.studentId);
          } else {
            // Insufficient balance: accrue an unpaid invoice, exactly once
            // (guarded by the `billed` flag on the attendance record).
            const due = new Date(Date.now() + 7 * 24 * 3600 * 1000);
            const items = [{ description: `${template!.type} session on ${start.toISOString().split("T")[0]}`, amountPaise: feePaise, quantity: 1 }];
            await client.query(
              `insert into invoices
                 (organization_id, tutor_id, student_id, subtotal_paise, total_paise, tax_paise, discount_paise, total_amount, subtotal, status, due_date, items, source)
               values ($1, $2, $3, $4, $4, 0, 0, $5, $5, 'unpaid', $6, $7, $8)`,
              [orgId, session.tutor_id, r.studentId, feePaise, feePaise / 100, due.toISOString().split("T")[0], JSON.stringify(items), JSON.stringify({ kind: "attendance", sessionId })]
            );
            invoiced.push(r.studentId);
          }
        }
      }

      await client.query(
        `update class_sessions set status = 'completed', attendance_marked_at = now(), attendance_marked_by = $1 where id = $2`,
        [actor, sessionId]
      );
      return { billed, invoiced };
    });

    await writeAudit(orgId, actor, "attendance.mark", "class_sessions", sessionId, {
      records: records.map((r) => `${r.studentId}:${r.status}`),
      ...result,
    });
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

router.post("/sessions/cancel", requireRole(...CAN_MARK), async (req: AuthRequest, res, next) => {
  try {
    const { sessionId } = cancelSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const { data: session, error } = await supabaseAdmin
      .from("class_sessions").select("organization_id, tutor_id").eq("id", sessionId).maybeSingle();
    if (error) throw error;
    if (!session || session.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Session not found" } });
    }
    if (req.user!.role === "tutor" && session.tutor_id !== req.user!.id) {
      return res.status(403).json({ error: { code: "forbidden", message: "Tutors can only cancel their own sessions" } });
    }
    const { error: updErr } = await supabaseAdmin
      .from("class_sessions")
      .update({ status: "cancelled", cancelled_at: new Date().toISOString(), cancelled_by: req.user!.id })
      .eq("id", sessionId);
    if (updErr) throw updErr;
    await writeAudit(orgId, req.user!.id, "session.cancel", "class_sessions", sessionId, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Record an offline payment against an invoice. Gateway payments arrive via
// webhooks (Stage 1 / Epic 6); both paths converge on the same ledger shape.
router.post("/payments/manual", requireRole(...CAN_MONEY), async (req: AuthRequest, res, next) => {
  try {
    const body = paymentSchema.parse(req.body);
    const orgId = req.user!.organizationId!;

    const outcome = await withTransaction(async (client) => {
      const existing = await client.query(
        `select invoice_status from payments where organization_id = $1 and idempotency_key = $2`,
        [orgId, body.idempotencyKey]
      );
      if ((existing.rowCount ?? 0) > 0) {
        return { duplicate: true, status: existing.rows[0].invoice_status as InvoiceStatus };
      }

      const invRes = await client.query(
        `select organization_id, student_id, status, total_paise, paid_paise from invoices where id = $1 for update`,
        [body.invoiceId]
      );
      if (invRes.rowCount === 0 || invRes.rows[0].organization_id !== orgId) {
        throw Object.assign(new Error("Invoice not found"), { status: 404, code: "not_found" });
      }
      const inv = invRes.rows[0];
      // Shared status machine: caps paid at total, reports overpayment, throws
      // on void/non-payable. Identical math to the gateway webhook path.
      const applied = applyPayment(
        { status: inv.status as InvoiceStatus, totalPaise: inv.total_paise, paidPaise: inv.paid_paise },
        body.amountPaise
      );

      await client.query(
        `insert into payments
           (organization_id, invoice_id, student_id, amount_paise, method, note, recorded_by, invoice_status, idempotency_key, at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, now())`,
        [orgId, body.invoiceId, inv.student_id, body.amountPaise, body.method, body.note || null, req.user!.id, applied.status, body.idempotencyKey]
      );
      await client.query(
        `update invoices set paid_paise = $1, status = $2, last_payment_at = now() where id = $3`,
        [applied.paidPaise, applied.status, body.invoiceId]
      );

      // Overpayment (e.g. round cash) becomes wallet credit on the ledger.
      if (applied.overpaidPaise > 0 && inv.student_id) {
        await client.query(
          `insert into wallet_ledger (organization_id, student_id, type, credits, paise, reason, invoice_id, by, at)
           values ($1, $2, 'credit_currency', 0, $3, 'overpayment', $4, $5, now())`,
          [orgId, inv.student_id, applied.overpaidPaise, body.invoiceId, req.user!.id]
        );
      }
      return { duplicate: false, status: applied.status };
    });

    if (!outcome.duplicate) {
      await writeAudit(orgId, req.user!.id, "payment.record_manual", "invoices", body.invoiceId, {
        amountPaise: body.amountPaise, method: body.method,
      });
    }
    res.status(outcome.duplicate ? 200 : 201).json({ ok: true, invoiceStatus: outcome.status, duplicate: outcome.duplicate });
  } catch (err) { next(err); }
});

// Invoices are never deleted; they are voided, leaving the audit trail intact.
router.post("/invoices/:invoiceId/void", requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const { data: inv, error } = await supabaseAdmin
      .from("invoices").select("organization_id, status").eq("id", req.params.invoiceId).maybeSingle();
    if (error) throw error;
    if (!inv || inv.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Invoice not found" } });
    }
    if (inv.status === "paid") {
      return res.status(422).json({ error: { code: "already_paid", message: "Paid invoices cannot be voided; issue a refund instead" } });
    }
    const { error: updErr } = await supabaseAdmin
      .from("invoices")
      .update({ status: "void", voided_at: new Date().toISOString(), voided_by: req.user!.id })
      .eq("id", req.params.invoiceId);
    if (updErr) throw updErr;
    await writeAudit(orgId, req.user!.id, "invoice.void", "invoices", req.params.invoiceId, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Finalize an invoice: assign a gap-free per-org number, snapshot GST/tax
// settings onto the immutable record, and move draft → sent. Idempotent: an
// already-numbered invoice returns its existing number untouched (E6.4).
router.post("/invoices/:invoiceId/finalize", requireRole(...CAN_MONEY), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;

    const { data: gw } = await supabaseAdmin.from("payment_gateways").select("tax").eq("organization_id", orgId).maybeSingle();
    const tax = gw?.tax || {};
    const slug: string = tax.invoicePrefix || orgId.slice(0, 6);

    const out = await withTransaction(async (client) => {
      const invRes = await client.query(
        `select organization_id, status, invoice_number from invoices where id = $1 for update`,
        [req.params.invoiceId]
      );
      if (invRes.rowCount === 0 || invRes.rows[0].organization_id !== orgId) {
        throw Object.assign(new Error("Invoice not found"), { status: 404, code: "not_found" });
      }
      const inv = invRes.rows[0];
      if (inv.status === "void") {
        throw Object.assign(new Error("Invoice is void"), { status: 422, code: "invoice_void" });
      }
      if (inv.invoice_number) {
        return { number: inv.invoice_number as string, alreadyFinalized: true };
      }
      const { number } = await allocateInvoiceNumber(client, orgId, slug);
      await client.query(
        `update invoices set invoice_number = $1, status = case when status = 'draft' then 'sent' else status end,
           finalized_at = now(), finalized_by = $2, gst_snapshot = $3
         where id = $4`,
        [number, req.user!.id, JSON.stringify({
          legalName: tax.legalName || null, gstin: tax.gstin || null, placeOfSupply: tax.placeOfSupply || null,
        }), req.params.invoiceId]
      );
      return { number, alreadyFinalized: false };
    });

    if (!out.alreadyFinalized) {
      await writeAudit(orgId, req.user!.id, "invoice.finalize", "invoices", req.params.invoiceId, { number: out.number });
    }
    res.json({ ok: true, invoiceNumber: out.number });
  } catch (err) { next(err); }
});

// Create (or return the existing) Razorpay payment link for an invoice's
// outstanding amount. Shared by the staff route and the parent-facing route
// below so both settle to the identical link/idempotency shape.
async function resolveInvoicePaymentLink(orgId: string, invoiceId: string) {
  const { data: inv, error } = await supabaseAdmin.from("invoices").select("*").eq("id", invoiceId).maybeSingle();
  if (error) throw error;
  if (!inv || inv.organization_id !== orgId) {
    throw Object.assign(new Error("Invoice not found"), { status: 404, code: "not_found" });
  }
  if (inv.status === "void" || inv.status === "paid") {
    throw Object.assign(new Error(`Invoice is ${inv.status}`), { status: 422, code: "not_payable" });
  }
  // Reuse a still-open link rather than minting duplicates.
  const existing = inv.payment_link;
  if (existing?.shortUrl && ["created", "issued", "partially_paid"].includes(existing.status)) {
    return { shortUrl: existing.shortUrl as string, reused: true };
  }

  const creds = await getGatewayCreds(orgId);
  if (!creds) {
    throw Object.assign(new Error("Connect Razorpay in settings first"), { status: 422, code: "gateway_not_connected" });
  }

  const outstanding = inv.total_paise - (inv.paid_paise || 0);
  if (outstanding <= 0) {
    throw Object.assign(new Error("Invoice has no outstanding balance"), { status: 422, code: "nothing_due" });
  }

  // Best-effort customer details for the hosted page.
  let customer: { name?: string; contact?: string; email?: string } = {};
  if (inv.student_id) {
    const { data: st } = await supabaseAdmin.from("students").select("name, parent_phone, phone, parent_email, email").eq("id", inv.student_id).maybeSingle();
    if (st) {
      customer = { name: st.name || undefined, contact: st.parent_phone || st.phone || undefined, email: st.parent_email || st.email || undefined };
    }
  }

  const items = (inv.items || []) as { description: string }[];
  const link = await createPaymentLink(creds, {
    amountPaise: outstanding,
    referenceId: invoiceId,
    description: `${inv.invoice_number || "Invoice"} · ${items[0]?.description || "Tuition fees"}`,
    customer,
    notes: { organizationId: orgId, invoiceId },
    callbackUrl: process.env.APP_URL ? `${process.env.APP_URL}/app/invoices` : undefined,
  });

  const { error: updErr } = await supabaseAdmin.from("invoices").update({
    payment_link: { id: link.id, shortUrl: link.shortUrl, status: link.status, amountPaise: outstanding, createdAt: new Date().toISOString() },
  }).eq("id", invoiceId);
  if (updErr) throw updErr;
  return { shortUrl: link.shortUrl as string, reused: false, linkId: link.id as string, amountPaise: outstanding };
}

router.post("/invoices/:invoiceId/payment-link", requireRole(...CAN_MONEY), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const result = await resolveInvoicePaymentLink(orgId, req.params.invoiceId);
    if (!result.reused) {
      await writeAudit(orgId, req.user!.id, "invoice.payment_link", "invoices", req.params.invoiceId, {
        linkId: result.linkId, amountPaise: result.amountPaise,
      });
    }
    res.json({ ok: true, shortUrl: result.shortUrl, reused: result.reused });
  } catch (err) { next(err); }
});

// Parent-facing equivalent (E10.3): same link resolution, but authorized by
// parent_links membership on the invoice's student rather than a staff role.
router.post("/invoices/:invoiceId/pay", async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    if (req.user!.role !== "parent") {
      return res.status(403).json({ error: { code: "forbidden", message: "This endpoint is for parent accounts" } });
    }
    const { data: inv, error } = await supabaseAdmin.from("invoices").select("organization_id, student_id").eq("id", req.params.invoiceId).maybeSingle();
    if (error) throw error;
    if (!inv || inv.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Invoice not found" } });
    }
    const { data: link } = await supabaseAdmin
      .from("parent_links").select("parent_user_id")
      .eq("parent_user_id", req.user!.id).eq("student_id", inv.student_id).maybeSingle();
    if (!link) {
      return res.status(403).json({ error: { code: "forbidden", message: "Not linked to this student" } });
    }

    const result = await resolveInvoicePaymentLink(orgId, req.params.invoiceId);
    if (!result.reused) {
      await writeAudit(orgId, req.user!.id, "invoice.payment_link.parent", "invoices", req.params.invoiceId, {
        linkId: result.linkId, amountPaise: result.amountPaise,
      });
    }
    res.json({ ok: true, shortUrl: result.shortUrl, reused: result.reused });
  } catch (err) { next(err); }
});

// Server-rendered invoice PDF (E6.5). One endpoint for staff and for the
// parent linked to the invoice's student — parents need the file for their
// records, staff for support. Students hit 403.
router.get("/invoices/:invoiceId/pdf", async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const role = req.user!.role;
    const STAFF_ROLES = new Set(["owner", "admin", "tutor", "frontdesk", "accountant"]);

    const { data: inv, error } = await supabaseAdmin.from("invoices").select("*").eq("id", req.params.invoiceId).maybeSingle();
    if (error) throw error;
    if (!inv || inv.organization_id !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Invoice not found" } });
    }

    if (role === "parent") {
      const { data: link } = await supabaseAdmin
        .from("parent_links").select("parent_user_id")
        .eq("parent_user_id", req.user!.id).eq("student_id", inv.student_id).maybeSingle();
      if (!link) {
        return res.status(403).json({ error: { code: "forbidden", message: "Not linked to this student" } });
      }
      // Tutors may only download their own invoices; admin-tier see all.
    } else if (role === "tutor") {
      if (inv.tutor_id !== req.user!.id) {
        return res.status(403).json({ error: { code: "forbidden", message: "Tutors can only download their own invoices" } });
      }
    } else if (!STAFF_ROLES.has(role || "")) {
      return res.status(403).json({ error: { code: "forbidden", message: "No access to invoice PDF" } });
    }

    const [{ data: org }, { data: gw }, { data: student }] = await Promise.all([
      supabaseAdmin.from("organizations").select("*").eq("id", orgId).maybeSingle(),
      supabaseAdmin.from("payment_gateways").select("tax").eq("organization_id", orgId).maybeSingle(),
      inv.student_id ? supabaseAdmin.from("students").select("*").eq("id", inv.student_id).maybeSingle() : Promise.resolve({ data: null }),
    ]);
    const tax = gw?.tax || {};

    const pdf = renderInvoicePdf({
      invoice: {
        invoiceNumber: inv.invoice_number || null,
        status: inv.status,
        createdAt: new Date(inv.created_at),
        dueDate: inv.due_date || null,
        subtotalPaise: inv.subtotal_paise ?? null,
        taxPaise: inv.tax_paise ?? null,
        discountPaise: inv.discount_paise ?? null,
        totalPaise: inv.total_paise ?? null,
        paidPaise: inv.paid_paise ?? null,
        items: inv.items || null,
        gstSnapshot: inv.gst_snapshot || null,
        totalAmount: inv.total_amount ?? null,
        subtotal: inv.subtotal ?? null,
      } as InvoicePdfInvoice,
      org: {
        name: tax.legalName || org?.name || "Tuition Center",
        address: org?.address || null,
        phone: org?.phone || null,
        email: org?.email || null,
        gstin: tax.gstin || null,
      },
      student: {
        name: student?.name || null,
        parentName: student?.parent_name || null,
        parentPhone: student?.parent_phone || null,
        parentEmail: student?.parent_email || null,
        address: student?.address || null,
      },
    });

    const filename = `${inv.invoice_number || "invoice-" + req.params.invoiceId}.pdf`;
    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
    res.setHeader("Content-Length", String(pdf.byteLength));
    res.setHeader("Cache-Control", "private, no-store");
    res.end(pdf);
  } catch (err) { next(err); }
});

// Manual refund (E6.6). Records an immutable refund entry, decrements the paid
// total, and re-derives the invoice status. Gateway refunds are initiated in
// the Razorpay dashboard for now; this keeps our ledger truthful either way.
router.post("/refunds", requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    const body = refundSchema.parse(req.body);
    const orgId = req.user!.organizationId!;

    const outcome = await withTransaction(async (client) => {
      const existing = await client.query(
        `select invoice_status from refunds where organization_id = $1 and idempotency_key = $2`,
        [orgId, body.idempotencyKey]
      );
      if ((existing.rowCount ?? 0) > 0) {
        return { duplicate: true, status: existing.rows[0].invoice_status as InvoiceStatus };
      }

      const invRes = await client.query(
        `select organization_id, student_id, paid_paise, total_paise from invoices where id = $1 for update`,
        [body.invoiceId]
      );
      if (invRes.rowCount === 0 || invRes.rows[0].organization_id !== orgId) {
        throw Object.assign(new Error("Invoice not found"), { status: 404, code: "not_found" });
      }
      const inv = invRes.rows[0];
      const paid = inv.paid_paise || 0;
      if (body.amountPaise > paid) {
        throw Object.assign(new Error("Refund exceeds amount paid"), { status: 422, code: "refund_too_large" });
      }
      const newPaid = paid - body.amountPaise;
      const status: InvoiceStatus = newPaid <= 0 ? "unpaid" : newPaid >= inv.total_paise ? "paid" : "partially_paid";

      await client.query(
        `insert into refunds (organization_id, invoice_id, student_id, amount_paise, reason, refunded_by, invoice_status, idempotency_key, at)
         values ($1, $2, $3, $4, $5, $6, $7, $8, now())`,
        [orgId, body.invoiceId, inv.student_id, body.amountPaise, body.reason || null, req.user!.id, status, body.idempotencyKey]
      );
      await client.query(
        `update invoices set paid_paise = $1, status = $2, last_refund_at = now() where id = $3`,
        [newPaid, status, body.invoiceId]
      );
      return { duplicate: false, status };
    });

    if (!outcome.duplicate) {
      await writeAudit(orgId, req.user!.id, "payment.refund", "invoices", body.invoiceId, { amountPaise: body.amountPaise });
    }
    res.status(outcome.duplicate ? 200 : 201).json({ ok: true, invoiceStatus: outcome.status, duplicate: outcome.duplicate });
  } catch (err) { next(err); }
});

// Reconciliation poll for missed webhooks (E6.3). Meant to be hit hourly by
// Cloud Scheduler (with an admin/service token). For each invoice carrying an
// open payment link, re-pull the link; if Razorpay shows it paid, settle it
// idempotently (keyed by link id) so a dropped webhook still reconciles.
router.post("/reconcile", requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    const orgId = req.user!.organizationId!;
    const creds = await getGatewayCreds(orgId);
    if (!creds) return res.status(422).json({ error: { code: "gateway_not_connected", message: "Connect Razorpay first" } });

    const openRes = await pool.query(
      `select id, payment_link from invoices where organization_id = $1 and status in ('sent','unpaid','partially_paid') limit 100`,
      [orgId]
    );

    let reconciled = 0;
    for (const row of openRes.rows) {
      const linkId = row.payment_link?.id;
      if (!linkId) continue;
      const link = await fetchPaymentLink(creds, linkId).catch(() => null);
      if (!link || link.status !== "paid") continue;

      const amountPaid = Number(link.amount_paid || 0);
      if (amountPaid <= 0) continue;
      const idempotencyKey = `rzp_link_${linkId}`;

      const settled = await withTransaction(async (client) => {
        const existing = await client.query(
          `select 1 from payments where organization_id = $1 and idempotency_key = $2`,
          [orgId, idempotencyKey]
        );
        if ((existing.rowCount ?? 0) > 0) return false;

        const invRes = await client.query(
          `select student_id, status, total_paise, paid_paise from invoices where id = $1 for update`,
          [row.id]
        );
        const inv = invRes.rows[0];
        const applied = applyPayment(
          { status: inv.status as InvoiceStatus, totalPaise: inv.total_paise, paidPaise: inv.paid_paise },
          amountPaid
        );
        await client.query(
          `insert into payments (organization_id, invoice_id, student_id, amount_paise, method, gateway, gateway_link_id, source, invoice_status, idempotency_key, at)
           values ($1, $2, $3, $4, 'upi', 'razorpay', $5, 'reconcile', $6, $7, now())`,
          [orgId, row.id, inv.student_id, amountPaid, linkId, applied.status, idempotencyKey]
        );
        await client.query(
          `update invoices set paid_paise = $1, status = $2, last_payment_at = now() where id = $3`,
          [applied.paidPaise, applied.status, row.id]
        );
        return true;
      });
      if (settled) {
        reconciled++;
        await writeAudit(orgId, req.user!.id, "payment.reconciled", "invoices", row.id, { linkId, amountPaise: amountPaid });
      }
    }
    res.json({ ok: true, scanned: openRes.rowCount, reconciled });
  } catch (err) { next(err); }
});

export default router;
