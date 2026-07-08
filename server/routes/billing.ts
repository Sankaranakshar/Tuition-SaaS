import express from "express";
import { z } from "zod";
import { adminDb } from "../firebaseAdmin.ts";
import { authenticateToken, requireRole, requireOrg, type AuthRequest } from "../middleware/auth.ts";
import { writeAudit } from "../utils/audit.ts";
import { applyPayment, type InvoiceStatus } from "../utils/invoiceStatus.ts";
import { allocateInvoiceNumber } from "../utils/invoiceNumber.ts";
import { getGatewayCreds, createPaymentLink, fetchPaymentLink } from "../utils/razorpay.ts";

const router = express.Router();
router.use(authenticateToken, requireOrg);

const CAN_MARK = ["owner", "admin", "tutor", "frontdesk"] as const;
const CAN_MONEY = ["owner", "admin", "frontdesk"] as const;

const attendanceSchema = z.object({
  sessionId: z.string().min(1),
  records: z.array(z.object({
    studentId: z.string().min(1),
    status: z.enum(["present", "absent", "late", "excused"]),
  })).min(1),
});

// Marks attendance for a session and settles per-session billing atomically.
// Idempotent: attendance doc IDs are `${sessionId}_${studentId}`, and billing
// only fires on the first transition into a billable status.
router.post("/attendance", requireRole(...CAN_MARK), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const { sessionId, records } = attendanceSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const actor = req.user!.id;

    const sessionRef = db.collection("class_sessions").doc(sessionId);
    const sessionSnap = await sessionRef.get();
    if (!sessionSnap.exists) {
      return res.status(404).json({ error: { code: "not_found", message: "Session not found" } });
    }
    const session = sessionSnap.data()!;
    if (session.organizationId !== orgId) {
      return res.status(403).json({ error: { code: "forbidden", message: "Session belongs to another organization" } });
    }
    // Tutors may only mark their own sessions; admin-tier roles may mark any.
    if (req.user!.role === "tutor" && session.tutorId !== actor) {
      return res.status(403).json({ error: { code: "forbidden", message: "Tutors can only mark their own sessions" } });
    }
    // Backdated marking allowed up to 7 days (audited); future sessions blocked.
    const start = new Date(session.startTime?.toDate ? session.startTime.toDate() : session.startTime);
    if (start.getTime() > Date.now()) {
      return res.status(422).json({ error: { code: "session_in_future", message: "Cannot mark attendance before the session starts" } });
    }
    if (Date.now() - start.getTime() > 7 * 24 * 3600 * 1000) {
      return res.status(422).json({ error: { code: "too_old", message: "Attendance can only be marked within 7 days of the session" } });
    }

    const templateSnap = await db.collection("class_templates").doc(session.templateId).get();
    const template = templateSnap.exists ? templateSnap.data()! : null;
    const perSession = template?.pricingModel === "PER_SESSION";
    const BILLABLE = new Set(["present", "late"]);

    // Pre-resolve wallet refs (reads before writes inside the transaction).
    const walletRefByStudent = new Map<string, FirebaseFirestore.DocumentReference>();
    if (perSession) {
      for (const r of records) {
        const ws = await db.collection("wallets")
          .where("organizationId", "==", orgId)
          .where("studentId", "==", r.studentId)
          .limit(1).get();
        if (!ws.empty) walletRefByStudent.set(r.studentId, ws.docs[0].ref);
      }
    }

    const result = await db.runTransaction(async (tx) => {
      const billed: string[] = [];
      const invoiced: string[] = [];

      // Read phase
      const attRefs = records.map((r) => db.collection("attendance_records").doc(`${sessionId}_${r.studentId}`));
      const attSnaps = await Promise.all(attRefs.map((ref) => tx.get(ref)));
      const walletSnaps = new Map<string, FirebaseFirestore.DocumentSnapshot>();
      for (const [studentId, ref] of walletRefByStudent) {
        walletSnaps.set(studentId, await tx.get(ref));
      }

      // Write phase
      records.forEach((r, i) => {
        const prev = attSnaps[i].exists ? attSnaps[i].data()! : null;
        const alreadyBilled = prev?.billed === true;
        const nowBillable = perSession && BILLABLE.has(r.status);
        const shouldBill = nowBillable && !alreadyBilled;

        tx.set(attRefs[i], {
          organizationId: orgId,
          sessionId,
          studentId: r.studentId,
          templateId: session.templateId,
          tutorId: session.tutorId,
          sessionStart: session.startTime,
          status: r.status,
          billed: alreadyBilled || shouldBill,
          markedBy: actor,
          markedAt: new Date(),
        }, { merge: true });

        if (shouldBill) {
          const feePaise = Math.round((template!.feeAmount || 0) * 100);
          const wSnap = walletSnaps.get(r.studentId);
          const w = wSnap?.exists ? wSnap.data()! : null;

          if (w && (w.balanceCredits || 0) >= 1) {
            tx.update(walletRefByStudent.get(r.studentId)!, { balanceCredits: (w.balanceCredits || 0) - 1 });
            tx.set(db.collection("wallet_ledger").doc(), {
              organizationId: orgId, studentId: r.studentId, type: "debit_credit",
              credits: -1, paise: 0, reason: "attendance", sessionId, at: new Date(), by: actor,
            });
            billed.push(r.studentId);
          } else if (w && Math.round((w.balanceCurrency || 0) * 100) >= feePaise) {
            tx.update(walletRefByStudent.get(r.studentId)!, { balanceCurrency: (Math.round((w.balanceCurrency || 0) * 100) - feePaise) / 100 });
            tx.set(db.collection("wallet_ledger").doc(), {
              organizationId: orgId, studentId: r.studentId, type: "debit_currency",
              credits: 0, paise: -feePaise, reason: "attendance", sessionId, at: new Date(), by: actor,
            });
            billed.push(r.studentId);
          } else {
            // Insufficient balance: accrue an unpaid invoice, exactly once
            // (guarded by the `billed` flag on the attendance record).
            const due = new Date(Date.now() + 7 * 24 * 3600 * 1000);
            tx.set(db.collection("invoices").doc(), {
              organizationId: orgId,
              tutorId: session.tutorId,
              studentId: r.studentId,
              subtotalPaise: feePaise,
              totalPaise: feePaise,
              taxPaise: 0,
              discountPaise: 0,
              // Legacy rupee fields kept until the frontend migrates.
              totalAmount: feePaise / 100,
              subtotal: feePaise / 100,
              status: "unpaid",
              dueDate: due.toISOString().split("T")[0],
              items: [{ description: `${template!.type} session on ${start.toISOString().split("T")[0]}`, amountPaise: feePaise, quantity: 1 }],
              source: { kind: "attendance", sessionId },
              createdAt: new Date(),
            });
            invoiced.push(r.studentId);
          }
        }
      });

      tx.update(sessionRef, { status: "completed", attendanceMarkedAt: new Date(), attendanceMarkedBy: actor });
      return { billed, invoiced };
    });

    await writeAudit(orgId, actor, "attendance.mark", "class_sessions", sessionId, {
      records: records.map((r) => `${r.studentId}:${r.status}`),
      ...result,
    });
    res.json({ ok: true, ...result });
  } catch (err) { next(err); }
});

const cancelSchema = z.object({ sessionId: z.string().min(1) });

router.post("/sessions/cancel", requireRole(...CAN_MARK), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const { sessionId } = cancelSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const ref = adminDb.collection("class_sessions").doc(sessionId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()!.organizationId !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Session not found" } });
    }
    if (req.user!.role === "tutor" && snap.data()!.tutorId !== req.user!.id) {
      return res.status(403).json({ error: { code: "forbidden", message: "Tutors can only cancel their own sessions" } });
    }
    await ref.update({ status: "cancelled", cancelledAt: new Date(), cancelledBy: req.user!.id });
    await writeAudit(orgId, req.user!.id, "session.cancel", "class_sessions", sessionId, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

const paymentSchema = z.object({
  invoiceId: z.string().min(1),
  amountPaise: z.number().int().positive(),
  method: z.enum(["cash", "upi", "bank_transfer", "cheque", "other"]),
  idempotencyKey: z.string().min(8).max(128),
  note: z.string().max(500).optional(),
});

// Record an offline payment against an invoice. Gateway payments arrive via
// webhooks (Stage 1 / Epic 6); both paths converge on the same ledger shape.
router.post("/payments/manual", requireRole(...CAN_MONEY), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const body = paymentSchema.parse(req.body);
    const orgId = req.user!.organizationId!;

    const payRef = db.collection("payments").doc(body.idempotencyKey);
    const invRef = db.collection("invoices").doc(body.invoiceId);

    const outcome = await db.runTransaction(async (tx) => {
      const [paySnap, invSnap] = await Promise.all([tx.get(payRef), tx.get(invRef)]);
      if (paySnap.exists) return { duplicate: true, status: paySnap.data()!.invoiceStatus };
      if (!invSnap.exists || invSnap.data()!.organizationId !== orgId) {
        throw Object.assign(new Error("Invoice not found"), { status: 404, code: "not_found" });
      }
      const inv = invSnap.data()!;
      const totalPaise = inv.totalPaise ?? Math.round((inv.totalAmount || 0) * 100);
      // Shared status machine: caps paid at total, reports overpayment, throws
      // on void/non-payable. Identical math to the gateway webhook path.
      const applied = applyPayment(
        { status: inv.status as InvoiceStatus, totalPaise, paidPaise: inv.paidPaise || 0 },
        body.amountPaise
      );

      tx.set(payRef, {
        organizationId: orgId,
        invoiceId: body.invoiceId,
        studentId: inv.studentId,
        amountPaise: body.amountPaise,
        method: body.method,
        note: body.note || null,
        recordedBy: req.user!.id,
        invoiceStatus: applied.status,
        at: new Date(),
      });
      tx.update(invRef, { paidPaise: applied.paidPaise, status: applied.status, lastPaymentAt: new Date() });

      // Overpayment (e.g. round cash) becomes wallet credit on the ledger.
      if (applied.overpaidPaise > 0 && inv.studentId) {
        tx.set(db.collection("wallet_ledger").doc(), {
          organizationId: orgId, studentId: inv.studentId, type: "credit_currency",
          credits: 0, paise: applied.overpaidPaise, reason: "overpayment", invoiceId: body.invoiceId,
          at: new Date(), by: req.user!.id,
        });
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
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const orgId = req.user!.organizationId!;
    const ref = adminDb.collection("invoices").doc(req.params.invoiceId);
    const snap = await ref.get();
    if (!snap.exists || snap.data()!.organizationId !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Invoice not found" } });
    }
    if (snap.data()!.status === "paid") {
      return res.status(422).json({ error: { code: "already_paid", message: "Paid invoices cannot be voided; issue a refund instead" } });
    }
    await ref.update({ status: "void", voidedAt: new Date(), voidedBy: req.user!.id });
    await writeAudit(orgId, req.user!.id, "invoice.void", "invoices", req.params.invoiceId, {});
    res.json({ ok: true });
  } catch (err) { next(err); }
});

// Finalize an invoice: assign a gap-free per-org number, snapshot GST/tax
// settings onto the immutable record, and move draft → sent. Idempotent: an
// already-numbered invoice returns its existing number untouched (E6.4).
router.post("/invoices/:invoiceId/finalize", requireRole(...CAN_MONEY), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const orgId = req.user!.organizationId!;

    const gwSnap = await db.collection("payment_gateways").doc(orgId).get();
    const tax = gwSnap.exists ? (gwSnap.data()!.tax || {}) : {};
    const slug: string = tax.invoicePrefix || orgId.slice(0, 6);

    const invRef = db.collection("invoices").doc(req.params.invoiceId);

    const out = await db.runTransaction(async (tx) => {
      const snap = await tx.get(invRef);
      if (!snap.exists || snap.data()!.organizationId !== orgId) {
        throw Object.assign(new Error("Invoice not found"), { status: 404, code: "not_found" });
      }
      const inv = snap.data()!;
      if (inv.status === "void") {
        throw Object.assign(new Error("Invoice is void"), { status: 422, code: "invoice_void" });
      }
      if (inv.invoiceNumber) {
        return { number: inv.invoiceNumber as string, alreadyFinalized: true };
      }
      const { number } = await allocateInvoiceNumber(db, tx, orgId, slug);
      tx.update(invRef, {
        invoiceNumber: number,
        status: inv.status === "draft" ? "sent" : inv.status,
        finalizedAt: new Date(),
        finalizedBy: req.user!.id,
        gstSnapshot: {
          legalName: tax.legalName || null,
          gstin: tax.gstin || null,
          placeOfSupply: tax.placeOfSupply || null,
        },
      });
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
async function resolveInvoicePaymentLink(db: FirebaseFirestore.Firestore, orgId: string, invoiceId: string) {
  const invRef = db.collection("invoices").doc(invoiceId);
  const snap = await invRef.get();
  if (!snap.exists || snap.data()!.organizationId !== orgId) {
    throw Object.assign(new Error("Invoice not found"), { status: 404, code: "not_found" });
  }
  const inv = snap.data()!;
  if (inv.status === "void" || inv.status === "paid") {
    throw Object.assign(new Error(`Invoice is ${inv.status}`), { status: 422, code: "not_payable" });
  }
  // Reuse a still-open link rather than minting duplicates.
  const existing = inv.paymentLink;
  if (existing?.shortUrl && ["created", "issued", "partially_paid"].includes(existing.status)) {
    return { shortUrl: existing.shortUrl as string, reused: true };
  }

  const creds = await getGatewayCreds(db, orgId);
  if (!creds) {
    throw Object.assign(new Error("Connect Razorpay in settings first"), { status: 422, code: "gateway_not_connected" });
  }

  const totalPaise = inv.totalPaise ?? Math.round((inv.totalAmount || 0) * 100);
  const outstanding = totalPaise - (inv.paidPaise || 0);
  if (outstanding <= 0) {
    throw Object.assign(new Error("Invoice has no outstanding balance"), { status: 422, code: "nothing_due" });
  }

  // Best-effort customer details for the hosted page.
  let customer: { name?: string; contact?: string; email?: string } = {};
  if (inv.studentId) {
    const st = await db.collection("students").doc(inv.studentId).get();
    if (st.exists) {
      const s = st.data()!;
      customer = { name: s.name || undefined, contact: s.parentPhone || s.phone || undefined, email: s.parentEmail || s.email || undefined };
    }
  }

  const link = await createPaymentLink(creds, {
    amountPaise: outstanding,
    referenceId: invoiceId,
    description: `${inv.invoiceNumber || "Invoice"} · ${inv.items?.[0]?.description || "Tuition fees"}`,
    customer,
    notes: { organizationId: orgId, invoiceId },
    callbackUrl: process.env.APP_URL ? `${process.env.APP_URL}/app/invoices` : undefined,
  });

  await invRef.update({
    paymentLink: { id: link.id, shortUrl: link.shortUrl, status: link.status, amountPaise: outstanding, createdAt: new Date() },
  });
  return { shortUrl: link.shortUrl as string, reused: false, linkId: link.id as string, amountPaise: outstanding };
}

router.post("/invoices/:invoiceId/payment-link", requireRole(...CAN_MONEY), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const orgId = req.user!.organizationId!;
    const result = await resolveInvoicePaymentLink(adminDb, orgId, req.params.invoiceId);
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
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const orgId = req.user!.organizationId!;
    if (req.user!.role !== "parent") {
      return res.status(403).json({ error: { code: "forbidden", message: "This endpoint is for parent accounts" } });
    }
    const invSnap = await db.collection("invoices").doc(req.params.invoiceId).get();
    if (!invSnap.exists || invSnap.data()!.organizationId !== orgId) {
      return res.status(404).json({ error: { code: "not_found", message: "Invoice not found" } });
    }
    const studentId = invSnap.data()!.studentId;
    const linkSnap = await db.collection("parent_links").doc(`${req.user!.id}_${studentId}`).get();
    if (!linkSnap.exists) {
      return res.status(403).json({ error: { code: "forbidden", message: "Not linked to this student" } });
    }

    const result = await resolveInvoicePaymentLink(db, orgId, req.params.invoiceId);
    if (!result.reused) {
      await writeAudit(orgId, req.user!.id, "invoice.payment_link.parent", "invoices", req.params.invoiceId, {
        linkId: result.linkId, amountPaise: result.amountPaise,
      });
    }
    res.json({ ok: true, shortUrl: result.shortUrl, reused: result.reused });
  } catch (err) { next(err); }
});

const refundSchema = z.object({
  invoiceId: z.string().min(1),
  amountPaise: z.number().int().positive(),
  reason: z.string().max(500).optional(),
  idempotencyKey: z.string().min(8).max(128),
});

// Manual refund (E6.6). Records an immutable refund entry, decrements the paid
// total, and re-derives the invoice status. Gateway refunds are initiated in
// the Razorpay dashboard for now; this keeps our ledger truthful either way.
router.post("/refunds", requireRole("owner", "admin"), async (req: AuthRequest, res, next) => {
  try {
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const body = refundSchema.parse(req.body);
    const orgId = req.user!.organizationId!;
    const refundRef = db.collection("refunds").doc(body.idempotencyKey);
    const invRef = db.collection("invoices").doc(body.invoiceId);

    const outcome = await db.runTransaction(async (tx) => {
      const [rSnap, iSnap] = await Promise.all([tx.get(refundRef), tx.get(invRef)]);
      if (rSnap.exists) return { duplicate: true, status: rSnap.data()!.invoiceStatus as InvoiceStatus };
      if (!iSnap.exists || iSnap.data()!.organizationId !== orgId) {
        throw Object.assign(new Error("Invoice not found"), { status: 404, code: "not_found" });
      }
      const inv = iSnap.data()!;
      const paid = inv.paidPaise || 0;
      if (body.amountPaise > paid) {
        throw Object.assign(new Error("Refund exceeds amount paid"), { status: 422, code: "refund_too_large" });
      }
      const newPaid = paid - body.amountPaise;
      const totalPaise = inv.totalPaise ?? Math.round((inv.totalAmount || 0) * 100);
      const status: InvoiceStatus = newPaid <= 0 ? "unpaid" : newPaid >= totalPaise ? "paid" : "partially_paid";

      tx.set(refundRef, {
        organizationId: orgId, invoiceId: body.invoiceId, studentId: inv.studentId || null,
        amountPaise: body.amountPaise, reason: body.reason || null, refundedBy: req.user!.id,
        invoiceStatus: status, at: new Date(),
      });
      tx.update(invRef, { paidPaise: newPaid, status, lastRefundAt: new Date() });
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
    if (!adminDb) throw new Error("Firebase Admin not initialized");
    const db = adminDb;
    const orgId = req.user!.organizationId!;
    const creds = await getGatewayCreds(db, orgId);
    if (!creds) return res.status(422).json({ error: { code: "gateway_not_connected", message: "Connect Razorpay first" } });

    const open = await db.collection("invoices")
      .where("organizationId", "==", orgId)
      .where("status", "in", ["sent", "unpaid", "partially_paid"])
      .limit(100).get();

    let reconciled = 0;
    for (const doc of open.docs) {
      const inv = doc.data();
      const linkId = inv.paymentLink?.id;
      if (!linkId) continue;
      const link = await fetchPaymentLink(creds, linkId).catch(() => null);
      if (!link || link.status !== "paid") continue;

      const amountPaid = Number(link.amount_paid || 0);
      if (amountPaid <= 0) continue;
      const payRef = db.collection("payments").doc(`rzp_link_${linkId}`);
      const invRef = db.collection("invoices").doc(doc.id);

      const settled = await db.runTransaction(async (tx) => {
        const [pSnap, iSnap] = await Promise.all([tx.get(payRef), tx.get(invRef)]);
        if (pSnap.exists) return false;
        const i = iSnap.data()!;
        const totalPaise = i.totalPaise ?? Math.round((i.totalAmount || 0) * 100);
        const applied = applyPayment(
          { status: i.status as InvoiceStatus, totalPaise, paidPaise: i.paidPaise || 0 },
          amountPaid
        );
        tx.set(payRef, {
          organizationId: orgId, invoiceId: doc.id, studentId: i.studentId || null,
          amountPaise: amountPaid, method: "upi", gateway: "razorpay",
          gatewayLinkId: linkId, source: "reconcile", invoiceStatus: applied.status, at: new Date(),
        });
        tx.update(invRef, { paidPaise: applied.paidPaise, status: applied.status, lastPaymentAt: new Date() });
        return true;
      });
      if (settled) {
        reconciled++;
        await writeAudit(orgId, req.user!.id, "payment.reconciled", "invoices", doc.id, { linkId, amountPaise: amountPaid });
      }
    }
    res.json({ ok: true, scanned: open.size, reconciled });
  } catch (err) { next(err); }
});

export default router;
